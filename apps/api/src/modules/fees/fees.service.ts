import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { todayIn } from '../../common/dates';
import { addDays, allocateFifo, chargeStatus, dueDateFor, lateFeeCents, matchCredit } from '../../common/fees';
import { centsToDb, fromCents, toCents } from '../../common/money';
import { assertReceiptFree } from '../../common/receipts';
import { zDate, zMoney, zUuid } from '../../common/zod.pipe';
import { DB, Db, Tx } from '../../db/client';
import { accounts, charges, complexes, movements, paymentAllocations, units } from '../../db/schema';
import { isGroupAccount, SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';
import { LedgerService } from '../ledger/ledger.service';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Total aplicado vigente (usar con leftJoin de payment_allocations + groupBy). */
const allocatedSum = sql<string>`coalesce(sum(${paymentAllocations.amount}) filter (where ${paymentAllocations.voidedAt} is null), 0)`;

export const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

const zPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato YYYY-MM');

export const generateSchema = z.object({ period: zPeriod });

export const chargeSchema = z.object({
  kind: z.enum(['EXTRAORDINARIA', 'OTRO']),
  /** Cuenta de ingreso (4xxx) que reconoce el cargo. */
  accountId: zUuid,
  description: z.string().trim().min(3).max(300),
  amount: zMoney.refine((v) => v > 0, 'El monto debe ser mayor a 0'),
  issueDate: zDate,
  dueDate: zDate,
  /** Propiedades a cargar; vacío + allUnits = todas las activas. */
  unitIds: z.array(zUuid).max(2000).optional(),
  allUnits: z.boolean().optional(),
});

export const paymentSchema = z.object({
  unitId: zUuid,
  date: zDate,
  amount: zMoney.refine((v) => v > 0, 'El monto debe ser mayor a 0'),
  method: z.enum(['CASH', 'TRANSFER', 'CARD', 'CHECK', 'OTHER']).default('CASH'),
  receiptNumber: z.string().trim().min(1, 'Indique el N.º de recibo').max(40),
  reference: z.string().max(80).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
});

export const chargeListSchema = z.object({
  period: zPeriod.optional(),
  unitId: zUuid.optional(),
  status: z.enum(['PENDIENTES', 'VENCIDOS', 'PAGADOS', 'ANULADOS']).optional(),
  kind: z.enum(['CUOTA', 'EXTRAORDINARIA', 'RECARGO', 'OTRO']).optional(),
});

export const paymentListSchema = z.object({ from: zDate.optional(), to: zDate.optional(), unitId: zUuid.optional() });

/**
 * Cuotas y cobranza (contabilidad de devengo):
 *  - Emitir cargo:            Debe 1200 Cuotas por cobrar / Haber 4xxx (4100 cuotas, 4400 recargos…)
 *  - Pago de cuotas:          Debe 1100 Caja / Haber 1200 (lo aplicado) y Haber 2200 (sobrante = saldo a favor)
 *  - Aplicar saldo a favor:   Debe 2200 / Haber 1200
 *  - Anular cargo pagado:     reverso del cargo + Debe 1200 / Haber 2200 (lo pagado vuelve a saldo a favor)
 *  - Anular pago:             Debe 1200 (lo aplicado vigente) + Debe 2200 (sobrante) / Haber 1100
 * Los pagos se aplican a los cargos más antiguos primero. Todo bajo un candado por proyecto.
 */
@Injectable()
export class FeesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Serializa las operaciones de cobranza del proyecto (evita aplicar dos veces el mismo saldo). */
  private async lock(tx: Tx, complexId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fees:${complexId}`}))`);
  }

  private async complex(complexId: string, tx: Tx = this.db) {
    const [c] = await tx.select().from(complexes).where(eq(complexes.id, complexId));
    if (!c) throw new NotFoundException('Proyecto no encontrado');
    return c;
  }

  async today(complexId: string) {
    return todayIn((await this.complex(complexId)).timezone);
  }

  /** ¿El ingreso es un pago de cuotas (cuenta 1200)? */
  async isFeePayment(tx: Tx, complexId: string, accountId: string) {
    const acc = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.RECEIVABLE, tx);
    return acc.id === accountId;
  }

  /** Cargos vigentes de una propiedad con su pendiente, más antiguos primero. */
  private async pendingCharges(tx: Tx, complexId: string, unitId: string) {
    const rows = await tx
      .select({ c: charges, paid: sql<string>`coalesce(sum(${paymentAllocations.amount}) filter (where ${paymentAllocations.voidedAt} is null), 0)` })
      .from(charges)
      .leftJoin(paymentAllocations, eq(paymentAllocations.chargeId, charges.id))
      .where(and(eq(charges.complexId, complexId), eq(charges.unitId, unitId), isNull(charges.voidedAt)))
      .groupBy(charges.id)
      .orderBy(asc(charges.dueDate), asc(charges.issueDate), asc(charges.createdAt));
    return rows
      .map((r) => ({ charge: r.c, outstandingCents: toCents(r.c.amount) - toCents(r.paid) }))
      .filter((r) => r.outstandingCents > 0);
  }

  /** Pagos de la propiedad con sobrante sin aplicar (saldo a favor), más antiguos primero. */
  private async creditSources(tx: Tx, complexId: string, unitId: string) {
    const receivable = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.RECEIVABLE, tx);
    const rows = await tx
      .select({ id: movements.id, amount: movements.amount, allocated: allocatedSum })
      .from(movements)
      .leftJoin(paymentAllocations, eq(paymentAllocations.movementId, movements.id))
      .where(and(eq(movements.complexId, complexId), eq(movements.kind, 'INCOME'), eq(movements.unitId, unitId), eq(movements.accountId, receivable.id), isNull(movements.voidedAt)))
      .groupBy(movements.id)
      .orderBy(asc(movements.date), asc(movements.createdAt));
    return rows.map((r) => ({ movementId: r.id, availableCents: toCents(r.amount) - toCents(r.allocated) })).filter((r) => r.availableCents > 0);
  }

  /** Aplica el saldo a favor de la propiedad a sus cargos pendientes. */
  private async applyCredit(tx: Tx, complexId: string, unitId: string, date: string, userId: string | null) {
    const [sources, pending] = await Promise.all([this.creditSources(tx, complexId, unitId), this.pendingCharges(tx, complexId, unitId)]);
    if (!sources.length || !pending.length) return 0;
    const matches = matchCredit(sources, pending.map((p) => ({ id: p.charge.id, outstandingCents: p.outstandingCents })));
    const total = matches.reduce((s, m) => s + m.cents, 0);
    if (!total) return 0;
    const [advances, receivable] = await Promise.all([
      this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.ADVANCES, tx),
      this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.RECEIVABLE, tx),
    ]);
    const entryId = await this.ledger.post(tx, {
      complexId, date, description: 'Aplicación de saldo a favor a cuotas', sourceType: 'CREDIT_APPLY', createdBy: userId ?? undefined,
      lines: [{ accountId: advances.id, debit: total }, { accountId: receivable.id, credit: total }],
    });
    await tx.insert(paymentAllocations).values(matches.map((m) => ({ complexId, chargeId: m.chargeId, movementId: m.movementId, amount: centsToDb(m.cents), appliedAt: date, journalEntryId: entryId })));
    return total;
  }

  /** Inserta un cargo y su asiento (Debe 1200 / Haber cuenta de ingreso). Devuelve null si ya existía (índices únicos). */
  private async issue(tx: Tx, complexId: string, userId: string | null, v: Omit<typeof charges.$inferInsert, 'complexId' | 'createdBy'>) {
    const [ch] = await tx.insert(charges).values({ ...v, complexId, createdBy: userId }).onConflictDoNothing().returning();
    if (!ch) return null;
    const receivable = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.RECEIVABLE, tx);
    const cents = toCents(ch.amount);
    const entryId = await this.ledger.post(tx, {
      complexId, date: ch.issueDate, description: `Cargo: ${ch.description}`, sourceType: 'CHARGE', sourceId: ch.id, createdBy: userId ?? undefined,
      lines: [{ accountId: receivable.id, debit: cents }, { accountId: ch.accountId, credit: cents }],
    });
    await tx.update(charges).set({ journalEntryId: entryId }).where(eq(charges.id, ch.id));
    return ch;
  }

  // ───────────────────────── Generación ─────────────────────────

  /** Cuotas mensuales de un mes para todas las propiedades activas con cuota. Idempotente. */
  async generateMonthly(complexId: string, period: string, userId: string | null) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, complexId);
      const c = await this.complex(complexId, tx);
      const fees = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.MAINTENANCE_FEES, tx);
      const list = await tx.select().from(units).where(and(eq(units.complexId, complexId), eq(units.active, true), sql`${units.monthlyFee} > 0`)).orderBy(asc(units.code));
      const issueDate = `${period}-01`;
      const dueDate = dueDateFor(period, c.feeDueDay);
      let created = 0;
      for (const u of list) {
        const ch = await this.issue(tx, complexId, userId, {
          unitId: u.id, kind: 'CUOTA', accountId: fees.id, period, description: `Cuota de mantenimiento ${monthName(period)}`,
          issueDate, dueDate, amount: u.monthlyFee,
        });
        if (!ch) continue;
        created++;
        await this.applyCredit(tx, complexId, u.id, issueDate, userId);
      }
      if (created) await this.audit.log({ complexId, userId: userId ?? undefined, action: 'GENERATE_FEES', entity: 'charge', data: { period, created } }, tx);
      return { period, created, existing: list.length - created };
    });
  }

  /** Cargos extraordinarios u otros (p. ej. saldo anterior) a una o varias propiedades. */
  async createCharges(complexId: string, userId: string, b: z.infer<typeof chargeSchema>) {
    if (b.dueDate < b.issueDate) throw new BadRequestException('El vencimiento no puede ser anterior a la emisión');
    return this.db.transaction(async (tx) => {
      await this.lock(tx, complexId);
      const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, b.accountId), eq(accounts.complexId, complexId)));
      if (!acc || acc.type !== 'INCOME' || isGroupAccount(acc.code) || !acc.active) throw new BadRequestException('Seleccione una cuenta de ingreso válida');
      const conds: SQL[] = [eq(units.complexId, complexId), eq(units.active, true)];
      if (!b.allUnits) {
        if (!b.unitIds?.length) throw new BadRequestException('Seleccione al menos una propiedad');
        conds.push(inArray(units.id, b.unitIds));
      }
      const list = await tx.select({ id: units.id }).from(units).where(and(...conds));
      if (!b.allUnits && list.length !== new Set(b.unitIds).size) throw new BadRequestException('Propiedad inválida o inactiva');
      for (const u of list) {
        await this.issue(tx, complexId, userId, {
          unitId: u.id, kind: b.kind, accountId: acc.id, description: b.description, issueDate: b.issueDate, dueDate: b.dueDate, amount: centsToDb(toCents(b.amount)),
        });
        await this.applyCredit(tx, complexId, u.id, b.issueDate, userId);
      }
      await this.audit.log({ complexId, userId, action: 'CREATE_CHARGES', entity: 'charge', data: { ...b, count: list.length } }, tx);
      return { created: list.length };
    });
  }

  /** Recargos por mora de cargos vencidos (una vez por cargo). */
  async generateLateFees(complexId: string, userId: string | null) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, complexId);
      const c = await this.complex(complexId, tx);
      const value = toCents(c.lateFeeValue);
      if (c.lateFeeType === 'NONE' || value <= 0) return { created: 0 };
      const today = todayIn(c.timezone);
      const limit = addDays(today, -c.lateFeeGraceDays); // vencidos antes de esta fecha
      const lateAcc = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.LATE_FEES, tx);
      const rows = await tx
        .select({ c: charges, paid: sql<string>`coalesce(sum(${paymentAllocations.amount}) filter (where ${paymentAllocations.voidedAt} is null), 0)` })
        .from(charges)
        .leftJoin(paymentAllocations, eq(paymentAllocations.chargeId, charges.id))
        .where(and(
          eq(charges.complexId, complexId), isNull(charges.voidedAt), inArray(charges.kind, ['CUOTA', 'EXTRAORDINARIA']), sql`${charges.dueDate} < ${limit}`,
          // Texto constante: las subconsultas correlacionadas necesitan la tabla explícita
          sql`not exists (select 1 from charges r where r.parent_charge_id = "charges"."id" and r.kind = 'RECARGO' and r.voided_at is null)`,
        ))
        .groupBy(charges.id);
      let created = 0;
      for (const r of rows) {
        if (toCents(r.c.amount) - toCents(r.paid) <= 0) continue;
        const cents = lateFeeCents(c.lateFeeType, value, toCents(r.c.amount));
        if (cents <= 0) continue;
        const ch = await this.issue(tx, complexId, userId, {
          unitId: r.c.unitId, kind: 'RECARGO', accountId: lateAcc.id, description: `Recargo por mora · ${r.c.description}`,
          issueDate: today, dueDate: today, amount: centsToDb(cents), parentChargeId: r.c.id,
        });
        if (!ch) continue;
        created++;
        await this.applyCredit(tx, complexId, r.c.unitId, today, userId);
      }
      if (created) await this.audit.log({ complexId, userId: userId ?? undefined, action: 'GENERATE_LATE_FEES', entity: 'charge', data: { created } }, tx);
      return { created };
    });
  }

  /** Anula un cargo. Lo que ya se le había pagado pasa a saldo a favor y se aplica a otros pendientes. */
  async voidCharge(complexId: string, userId: string, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, complexId);
      const [ch] = await tx.select().from(charges).where(and(eq(charges.id, id), eq(charges.complexId, complexId)));
      if (!ch) throw new NotFoundException();
      if (ch.voidedAt) throw new BadRequestException('Ya está anulado');
      const today = todayIn((await this.complex(complexId, tx)).timezone);
      if (ch.journalEntryId) await this.ledger.reverse(tx, ch.journalEntryId, { date: ch.issueDate, description: `Anulación de cargo: ${reason}`, createdBy: userId });

      const allocs = await tx.select().from(paymentAllocations).where(and(eq(paymentAllocations.chargeId, id), isNull(paymentAllocations.voidedAt)));
      const paid = allocs.reduce((s, a) => s + toCents(a.amount), 0);
      if (paid > 0) {
        const [receivable, advances] = await Promise.all([
          this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.RECEIVABLE, tx),
          this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.ADVANCES, tx),
        ]);
        await this.ledger.post(tx, {
          complexId, date: today, description: `Saldo a favor por anulación de cargo: ${ch.description}`, sourceType: 'CHARGE_VOID', sourceId: id, createdBy: userId,
          lines: [{ accountId: receivable.id, debit: paid }, { accountId: advances.id, credit: paid }],
        });
        await tx.update(paymentAllocations).set({ voidedAt: new Date() }).where(inArray(paymentAllocations.id, allocs.map((a) => a.id)));
      }
      const [row] = await tx.update(charges).set({ voidedAt: new Date(), voidReason: reason, updatedAt: new Date() }).where(eq(charges.id, id)).returning();
      await this.applyCredit(tx, complexId, ch.unitId, today, userId);
      await this.audit.log({ complexId, userId, action: 'VOID', entity: 'charge', entityId: id, data: { reason, releasedCents: paid } }, tx);
      return row;
    });
  }

  // ───────────────────────── Pagos ─────────────────────────

  /** Registra un pago de cuotas con su recibo y lo aplica a los cargos más antiguos. */
  async registerPayment(complexId: string, userId: string, b: z.infer<typeof paymentSchema>) {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, complexId);
      const [unit] = await tx.select().from(units).where(and(eq(units.id, b.unitId), eq(units.complexId, complexId)));
      if (!unit) throw new BadRequestException('Propiedad inválida');
      await assertReceiptFree(tx, complexId, b.receiptNumber);
      const [cash, receivable, advances] = await Promise.all([
        this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.CASH, tx),
        this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.RECEIVABLE, tx),
        this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.ADVANCES, tx),
      ]);
      const cents = toCents(b.amount);
      const [mov] = await tx
        .insert(movements)
        .values({
          complexId, kind: 'INCOME', date: b.date, accountId: receivable.id, unitId: unit.id, amount: centsToDb(cents), method: b.method,
          receiptNumber: b.receiptNumber, reference: b.reference ?? null, description: b.description || `Pago de cuotas · ${unit.code}`, createdBy: userId,
        })
        .returning();

      const pending = await this.pendingCharges(tx, complexId, unit.id);
      const { allocations, excessCents } = allocateFifo(pending.map((p) => ({ id: p.charge.id, outstandingCents: p.outstandingCents })), cents);
      const applied = cents - excessCents;
      const entryId = await this.ledger.post(tx, {
        complexId, date: b.date, description: `Pago de cuotas ${unit.code} · Recibo ${b.receiptNumber}`, sourceType: 'MOVEMENT', sourceId: mov.id, createdBy: userId,
        lines: [{ accountId: cash.id, debit: cents }, { accountId: receivable.id, credit: applied }, { accountId: advances.id, credit: excessCents }],
      });
      await tx.update(movements).set({ journalEntryId: entryId }).where(eq(movements.id, mov.id));
      if (allocations.length) {
        await tx.insert(paymentAllocations).values(allocations.map((a) => ({ complexId, chargeId: a.chargeId, movementId: mov.id, amount: centsToDb(a.cents), appliedAt: b.date })));
      }
      await this.audit.log({ complexId, userId, action: 'CREATE', entity: 'fee_payment', entityId: mov.id, data: b }, tx);
      const byId = new Map(pending.map((p) => [p.charge.id, p.charge]));
      return {
        movementId: mov.id,
        receiptNumber: b.receiptNumber,
        amount: fromCents(cents),
        applied: allocations.map((a) => ({ chargeId: a.chargeId, description: byId.get(a.chargeId)?.description, amount: fromCents(a.cents) })),
        credit: fromCents(excessCents),
      };
    });
  }

  /**
   * Asiento de anulación de un pago de cuotas, según su aplicación vigente (lo usa MovementsService.void).
   * Los cargos que cubría vuelven a quedar pendientes.
   */
  async voidPayment(tx: Tx, mov: typeof movements.$inferSelect, userId: string, reason: string) {
    await this.lock(tx, mov.complexId);
    const allocs = await tx.select().from(paymentAllocations).where(and(eq(paymentAllocations.movementId, mov.id), isNull(paymentAllocations.voidedAt)));
    const applied = allocs.reduce((s, a) => s + toCents(a.amount), 0);
    const cents = toCents(mov.amount);
    const [cash, receivable, advances] = await Promise.all([
      this.ledger.accountByCode(mov.complexId, SYSTEM_ACCOUNTS.CASH, tx),
      this.ledger.accountByCode(mov.complexId, SYSTEM_ACCOUNTS.RECEIVABLE, tx),
      this.ledger.accountByCode(mov.complexId, SYSTEM_ACCOUNTS.ADVANCES, tx),
    ]);
    await this.ledger.post(tx, {
      complexId: mov.complexId, date: mov.date, description: `Anulación pago de cuotas · Recibo ${mov.receiptNumber ?? '—'}: ${reason}`, sourceType: 'REVERSAL', sourceId: mov.journalEntryId ?? undefined, createdBy: userId,
      lines: [{ accountId: receivable.id, debit: applied }, { accountId: advances.id, debit: cents - applied }, { accountId: cash.id, credit: cents }],
    });
    if (allocs.length) await tx.update(paymentAllocations).set({ voidedAt: new Date() }).where(inArray(paymentAllocations.id, allocs.map((a) => a.id)));
  }

  /** Tras anular un pago, otros saldos a favor de la propiedad pueden cubrir los cargos liberados. */
  async afterPaymentVoid(tx: Tx, complexId: string, unitId: string | null, userId: string) {
    if (!unitId) return;
    await this.applyCredit(tx, complexId, unitId, todayIn((await this.complex(complexId, tx)).timezone), userId);
  }

  // ───────────────────────── Consultas ─────────────────────────

  async listCharges(complexId: string, q: z.infer<typeof chargeListSchema>) {
    const today = await this.today(complexId);
    const conds: SQL[] = [eq(charges.complexId, complexId)];
    if (q.period) conds.push(eq(charges.period, q.period));
    if (q.unitId) conds.push(eq(charges.unitId, q.unitId));
    if (q.kind) conds.push(eq(charges.kind, q.kind));
    if (q.status === 'ANULADOS') conds.push(sql`${charges.voidedAt} is not null`);
    else conds.push(isNull(charges.voidedAt));
    const rows = await this.db
      .select({
        c: charges, unitCode: units.code, ownerName: units.ownerName, accountName: accounts.name,
        paid: sql<string>`coalesce(sum(${paymentAllocations.amount}) filter (where ${paymentAllocations.voidedAt} is null), 0)`,
        lastApplied: sql<string | null>`max(${paymentAllocations.appliedAt}) filter (where ${paymentAllocations.voidedAt} is null)`,
      })
      .from(charges)
      .innerJoin(units, eq(units.id, charges.unitId))
      .innerJoin(accounts, eq(accounts.id, charges.accountId))
      .leftJoin(paymentAllocations, eq(paymentAllocations.chargeId, charges.id))
      .where(and(...conds))
      .groupBy(charges.id, units.code, units.ownerName, accounts.name)
      .orderBy(desc(charges.issueDate), asc(units.code))
      .limit(3000);
    const items = rows
      .map((r) => {
        const amount = toCents(r.c.amount);
        const paid = toCents(r.paid);
        return {
          id: r.c.id, unitId: r.c.unitId, unitCode: r.unitCode, ownerName: r.ownerName, kind: r.c.kind, period: r.c.period,
          description: r.c.description, accountName: r.accountName, issueDate: r.c.issueDate, dueDate: r.c.dueDate,
          amount: fromCents(amount), paid: fromCents(paid), outstanding: fromCents(amount - paid), lastApplied: r.lastApplied,
          status: chargeStatus(amount, paid, r.c.dueDate, today, !!r.c.voidedAt), voidReason: r.c.voidReason,
        };
      })
      .filter((x) =>
        q.status === 'PENDIENTES' ? x.outstanding > 0 : q.status === 'VENCIDOS' ? x.status === 'VENCIDO' : q.status === 'PAGADOS' ? x.status === 'PAGADO' : true,
      );
    const sum = (k: 'amount' | 'paid' | 'outstanding') => fromCents(items.reduce((s, x) => s + toCents(x[k]), 0));
    return { today, items, totals: { count: items.length, amount: sum('amount'), paid: sum('paid'), outstanding: sum('outstanding') } };
  }

  /** Pendientes y saldo a favor de una propiedad (para registrar un pago). */
  async unitPending(complexId: string, unitId: string) {
    const [unit] = await this.db.select().from(units).where(and(eq(units.id, unitId), eq(units.complexId, complexId)));
    if (!unit) throw new NotFoundException('Propiedad no encontrada');
    const today = await this.today(complexId);
    const [pending, credit] = await Promise.all([this.pendingCharges(this.db, complexId, unitId), this.creditSources(this.db, complexId, unitId)]);
    const total = pending.reduce((s, p) => s + p.outstandingCents, 0);
    return {
      unit: { id: unit.id, code: unit.code, ownerName: unit.ownerName, monthlyFee: fromCents(toCents(unit.monthlyFee)) },
      charges: pending.map((p) => ({
        id: p.charge.id, description: p.charge.description, kind: p.charge.kind, dueDate: p.charge.dueDate,
        amount: fromCents(toCents(p.charge.amount)), outstanding: fromCents(p.outstandingCents),
        overdue: p.charge.dueDate < today,
      })),
      totalPending: fromCents(total),
      overdue: fromCents(pending.filter((p) => p.charge.dueDate < today).reduce((s, p) => s + p.outstandingCents, 0)),
      credit: fromCents(credit.reduce((s, c) => s + c.availableCents, 0)),
    };
  }

  async listPayments(complexId: string, q: z.infer<typeof paymentListSchema>) {
    const receivable = await this.ledger.accountByCode(complexId, SYSTEM_ACCOUNTS.RECEIVABLE);
    const conds: SQL[] = [eq(movements.complexId, complexId), eq(movements.kind, 'INCOME'), eq(movements.accountId, receivable.id)];
    if (q.from) conds.push(gte(movements.date, q.from));
    if (q.to) conds.push(lte(movements.date, q.to));
    if (q.unitId) conds.push(eq(movements.unitId, q.unitId));
    const rows = await this.db
      .select({
        id: movements.id, date: movements.date, amount: movements.amount, method: movements.method, receiptNumber: movements.receiptNumber,
        reference: movements.reference, description: movements.description, voidedAt: movements.voidedAt, voidReason: movements.voidReason,
        unitId: units.id, unitCode: units.code, ownerName: units.ownerName,
        applied: allocatedSum,
      })
      .from(movements)
      .leftJoin(units, eq(units.id, movements.unitId))
      .leftJoin(paymentAllocations, eq(paymentAllocations.movementId, movements.id))
      .where(and(...conds))
      .groupBy(movements.id, units.id)
      .orderBy(desc(movements.date), desc(movements.createdAt))
      .limit(2000);
    const items = rows.map((r) => ({
      ...r, amount: fromCents(toCents(r.amount)), applied: fromCents(toCents(r.applied)),
      credit: r.voidedAt ? 0 : fromCents(toCents(r.amount) - toCents(r.applied)),
    }));
    return { items, total: fromCents(items.filter((i) => !i.voidedAt).reduce((s, i) => s + toCents(i.amount), 0)) };
  }

  /** Para el planificador: proyectos con generación automática. */
  async autoComplexes() {
    return this.db.select({ id: complexes.id, timezone: complexes.timezone }).from(complexes).where(and(eq(complexes.active, true), eq(complexes.autoGenerateFees, true)));
  }
}
