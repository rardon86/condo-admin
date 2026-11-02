import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { centsToDb, toCents } from '../../common/money';
import { assertReceiptFree } from '../../common/receipts';
import { zDate, zMoney, zUuid } from '../../common/zod.pipe';
import { DB, Db, Tx } from '../../db/client';
import { accounts, movements, units } from '../../db/schema';
import { isGroupAccount, SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';
import { LedgerService } from '../ledger/ledger.service';
import { FeesService } from '../fees/fees.service';

export type Kind = 'INCOME' | 'EXPENSE';

export const movementSchema = z.object({
  date: zDate,
  accountId: zUuid,
  amount: zMoney.refine((v) => v > 0, 'El monto debe ser mayor a 0'),
  unitId: zUuid.nullable().optional(),
  /** Proveedor (egresos). */
  counterparty: z.string().max(150).nullable().optional(),
  /** N.º de recibo físico (ingresos). */
  receiptNumber: z.string().trim().max(40).nullable().optional(),
  method: z.enum(['CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER']).default('TRANSFER'),
  reference: z.string().max(80).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  receiptUrl: z.string().url().nullable().optional(),
});
export type MovementInput = z.infer<typeof movementSchema> & { serviceRecordId?: string };

export const listSchema = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  accountId: zUuid.optional(),
  unitId: zUuid.optional(),
  includeVoided: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const label = (k: Kind) => (k === 'INCOME' ? 'Ingreso' : 'Egreso');

/**
 * Ingresos y egresos. Cada registro genera su asiento:
 *   Ingreso: Debe Caja y bancos / Haber cuenta de ingreso
 *   Egreso:  Debe cuenta de gasto / Haber Caja y bancos
 */
@Injectable()
export class MovementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly fees: FeesService,
  ) {}

  async list(complexId: string, kind: Kind, q: z.infer<typeof listSchema>) {
    const conds: SQL[] = [eq(movements.complexId, complexId), eq(movements.kind, kind)];
    if (q.from) conds.push(gte(movements.date, q.from));
    if (q.to) conds.push(lte(movements.date, q.to));
    if (q.accountId) conds.push(eq(movements.accountId, q.accountId));
    if (q.unitId) conds.push(eq(movements.unitId, q.unitId));
    if (q.includeVoided !== 'true') conds.push(isNull(movements.voidedAt));

    const where = and(...conds);
    const [rows, [{ total, count }]] = await Promise.all([
      this.db
        .select({
          id: movements.id,
          date: movements.date,
          amount: movements.amount,
          method: movements.method,
          reference: movements.reference,
          description: movements.description,
          counterparty: movements.counterparty,
          receiptNumber: movements.receiptNumber,
          receiptUrl: movements.receiptUrl,
          voidedAt: movements.voidedAt,
          voidReason: movements.voidReason,
          serviceRecordId: movements.serviceRecordId,
          accountId: accounts.id,
          accountCode: accounts.code,
          accountName: accounts.name,
          unitId: units.id,
          unitCode: units.code,
          createdAt: movements.createdAt,
        })
        .from(movements)
        .innerJoin(accounts, eq(accounts.id, movements.accountId))
        .leftJoin(units, eq(units.id, movements.unitId))
        .where(where)
        .orderBy(desc(movements.date), desc(movements.createdAt))
        .limit(q.limit)
        .offset(q.offset),
      this.db
        .select({ total: sql<string>`coalesce(sum(${movements.amount}) filter (where ${movements.voidedAt} is null), 0)`, count: sql<number>`count(*)::int` })
        .from(movements)
        .where(where),
    ]);
    return { items: rows, total: Number(total), count };
  }

  async create(complexId: string, userId: string, kind: Kind, input: MovementInput) {
    return this.db.transaction((tx) => this.createInTx(tx, complexId, userId, kind, input));
  }

  /** Usable dentro de otra transacción (p. ej. al registrar un servicio brindado). */
  async createInTx(tx: Tx, complexId: string, userId: string, kind: Kind, input: MovementInput) {
    const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.complexId, complexId)));
    if (!acc) throw new BadRequestException('Categoría inválida');
    if (acc.type !== kind || isGroupAccount(acc.code)) throw new BadRequestException(`La categoría no corresponde a un ${label(kind).toLowerCase()}`);
    if (!acc.active) throw new BadRequestException('La categoría está desactivada');
    // Las cuotas se cobran contra cuentas por cobrar (módulo de cuotas) para que cuadre el estado de cuenta
    if (kind === 'INCOME' && acc.code === SYSTEM_ACCOUNTS.MAINTENANCE_FEES) {
      throw new BadRequestException('Las cuotas de mantenimiento se cobran en Cuotas → Registrar pago');
    }
    if (kind === 'INCOME') await assertReceiptFree(tx, complexId, input.receiptNumber);
    if (input.unitId) {
      const [u] = await tx.select({ id: units.id }).from(units).where(and(eq(units.id, input.unitId), eq(units.complexId, complexId)));
      if (!u) throw new BadRequestException('Propiedad inválida');
    }

    const cents = toCents(input.amount);
    const [mov] = await tx
      .insert(movements)
      .values({ ...input, receiptNumber: kind === 'INCOME' ? input.receiptNumber || null : null, complexId, kind, amount: centsToDb(cents), createdBy: userId })
      .returning();

    const cash = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.CASH, tx);
    const entryId = await this.ledger.post(tx, {
      complexId,
      date: input.date,
      description: `${label(kind)}: ${input.description || acc.name}`,
      sourceType: 'MOVEMENT',
      sourceId: mov.id,
      createdBy: userId,
      lines:
        kind === 'INCOME'
          ? [{ accountId: cash.id, debit: cents }, { accountId: acc.id, credit: cents }]
          : [{ accountId: acc.id, debit: cents }, { accountId: cash.id, credit: cents }],
    });
    await tx.update(movements).set({ journalEntryId: entryId }).where(eq(movements.id, mov.id));
    await this.audit.log({ complexId, userId, action: 'CREATE', entity: kind.toLowerCase(), entityId: mov.id, data: input }, tx);
    return { ...mov, journalEntryId: entryId };
  }

  /** Los registros contables no se editan ni borran: se anulan con asiento de reversión. */
  async void(complexId: string, userId: string, kind: Kind, id: string, reason: string, tx?: Tx) {
    const run = async (t: Tx) => {
      const [mov] = await t.select().from(movements).where(and(eq(movements.id, id), eq(movements.complexId, complexId), eq(movements.kind, kind)));
      if (!mov) throw new NotFoundException();
      if (mov.voidedAt) throw new BadRequestException('Ya está anulado');
      const feePayment = kind === 'INCOME' && (await this.fees.isFeePayment(t, complexId, mov.accountId));
      if (feePayment) {
        // Pago de cuotas: el asiento depende de cómo está aplicado hoy (no es un reverso simple)
        await this.fees.voidPayment(t, mov, userId, reason);
      } else if (mov.journalEntryId) {
        await this.ledger.reverse(t, mov.journalEntryId, { date: mov.date, description: `Anulación ${label(kind).toLowerCase()}: ${reason}`, createdBy: userId });
      }
      const [row] = await t.update(movements).set({ voidedAt: new Date(), voidReason: reason, updatedAt: new Date() }).where(eq(movements.id, id)).returning();
      if (feePayment) await this.fees.afterPaymentVoid(t, complexId, mov.unitId, userId);
      await this.audit.log({ complexId, userId, action: 'VOID', entity: kind.toLowerCase(), entityId: id, data: { reason } }, t);
      return row;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }
}
