import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { monthRange, todayIn } from '../../common/dates';
import { fromCents, toCents } from '../../common/money';
import { buildStatement } from '../../common/statement';
import { DB, Db } from '../../db/client';
import { accounts, charges, complexes, memberships, movements, paymentAllocations, units, users } from '../../db/schema';
import { SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';

const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato YYYY-MM');
/** Periodo del estado de cuenta en meses ('YYYY-MM'). */
export const statementQ = z.object({ from: zMonth.optional(), to: zMonth.optional() });
export type PeriodQuery = z.infer<typeof statementQ>;

/** Máximo de meses por consulta. */
export const MAX_STATEMENT_MONTHS = 36;

const monthsDiff = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * Estado de cuenta por propiedad/propietario a partir del módulo de cuotas:
 * cargos emitidos (1200) contra pagos de cuotas registrados con recibo. Los anulados no cuentan.
 */
@Injectable()
export class AccountStatementService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Periodo efectivo: por defecto enero del año en curso → mes actual; nunca meses futuros. */
  private async period(complexId: string, q: PeriodQuery) {
    const [c] = await this.db.select({ name: complexes.name, currency: complexes.currency, timezone: complexes.timezone }).from(complexes).where(eq(complexes.id, complexId));
    const today = todayIn(c.timezone);
    const current = today.slice(0, 7);
    const to = !q.to || q.to > current ? current : q.to;
    const from = q.from ?? `${current.slice(0, 4)}-01`;
    if (from > to) throw new BadRequestException('El mes inicial no puede ser posterior al final');
    if (monthsDiff(from, to) >= MAX_STATEMENT_MONTHS) throw new BadRequestException(`El periodo no puede superar ${MAX_STATEMENT_MONTHS} meses`);
    const [ty, tm] = to.split('-').map(Number);
    const lastDay = to === current ? today : monthRange(ty, tm).to;
    return { complex: c, today, from, to, months: monthsDiff(from, to) + 1, range: { from: `${from}-01`, to: lastDay } };
  }

  private async receivableId(complexId: string) {
    const [a] = await this.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.complexId, complexId), eq(accounts.code, SYSTEM_ACCOUNTS.RECEIVABLE)));
    if (!a) throw new NotFoundException('Falta la cuenta 1200');
    return a.id;
  }

  /** Suma de cargos por propiedad con filtro de fecha de emisión. */
  private chargeTotals(complexId: string, cond: SQL, unitId?: string) {
    return this.db
      .select({ unitId: charges.unitId, cents: sql<string>`coalesce(sum(${charges.amount}), 0)` })
      .from(charges)
      .where(and(eq(charges.complexId, complexId), isNull(charges.voidedAt), cond, unitId ? eq(charges.unitId, unitId) : undefined))
      .groupBy(charges.unitId);
  }

  /** Suma de pagos de cuotas por propiedad con filtro de fecha. */
  private paymentTotals(complexId: string, receivableId: string, cond: SQL, unitId?: string) {
    return this.db
      .select({ unitId: movements.unitId, cents: sql<string>`coalesce(sum(${movements.amount}), 0)` })
      .from(movements)
      .where(and(eq(movements.complexId, complexId), eq(movements.kind, 'INCOME'), eq(movements.accountId, receivableId), isNull(movements.voidedAt), cond, unitId ? eq(movements.unitId, unitId) : undefined))
      .groupBy(movements.unitId);
  }

  /** Lo vencido hoy (cargos con vencimiento pasado y saldo pendiente) por propiedad. */
  private async overdue(complexId: string, today: string, unitId?: string) {
    const rows = await this.db
      .select({
        unitId: charges.unitId, amount: charges.amount,
        paid: sql<string>`coalesce(sum(${paymentAllocations.amount}) filter (where ${paymentAllocations.voidedAt} is null), 0)`,
      })
      .from(charges)
      .leftJoin(paymentAllocations, eq(paymentAllocations.chargeId, charges.id))
      .where(and(eq(charges.complexId, complexId), isNull(charges.voidedAt), lt(charges.dueDate, today), unitId ? eq(charges.unitId, unitId) : undefined))
      .groupBy(charges.id);
    const map = new Map<string, { cents: number; count: number }>();
    for (const r of rows) {
      const left = toCents(r.amount) - toCents(r.paid);
      if (left <= 0) continue;
      const cur = map.get(r.unitId) ?? { cents: 0, count: 0 };
      map.set(r.unitId, { cents: cur.cents + left, count: cur.count + 1 });
    }
    return map;
  }

  /** Propietarios registrados (portal) de un conjunto de propiedades. */
  private async residents(complexId: string, unitIds: string[]) {
    if (!unitIds.length) return [];
    return this.db
      .select({ unitId: memberships.unitId, fullName: users.fullName, email: users.email, phone: users.phone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.complexId, complexId), eq(memberships.role, 'RESIDENT'), eq(memberships.status, 'ACTIVE'), inArray(memberships.unitId, unitIds)));
  }

  /** Resumen de todas las propiedades activas: saldo anterior, cargos, pagos, saldo y mora. */
  async summary(complexId: string, q: PeriodQuery) {
    const p = await this.period(complexId, q);
    const rec = await this.receivableId(complexId);
    const list = await this.db.select().from(units).where(and(eq(units.complexId, complexId), eq(units.active, true))).orderBy(asc(units.code));
    const [chBefore, chIn, payBefore, payIn, late, res] = await Promise.all([
      this.chargeTotals(complexId, lt(charges.issueDate, p.range.from)),
      this.chargeTotals(complexId, and(gte(charges.issueDate, p.range.from), lte(charges.issueDate, p.range.to))!),
      this.paymentTotals(complexId, rec, lt(movements.date, p.range.from)),
      this.paymentTotals(complexId, rec, and(gte(movements.date, p.range.from), lte(movements.date, p.range.to))!),
      this.overdue(complexId, p.today),
      this.residents(complexId, list.map((u) => u.id)),
    ]);
    const get = (rows: { unitId: string | null; cents: string }[], id: string) => toCents(rows.find((r) => r.unitId === id)?.cents ?? 0);

    const rows = list.map((u) => {
      const opening = get(chBefore, u.id) - get(payBefore, u.id);
      const ch = get(chIn, u.id);
      const paid = get(payIn, u.id);
      const od = late.get(u.id) ?? { cents: 0, count: 0 };
      return {
        unitId: u.id, code: u.code, address: u.address,
        ownerName: u.ownerName || res.find((r) => r.unitId === u.id)?.fullName || null,
        monthlyFee: fromCents(toCents(u.monthlyFee)),
        opening: fromCents(opening), charges: fromCents(ch), paid: fromCents(paid), balance: fromCents(opening + ch - paid),
        overdue: fromCents(od.cents), overdueCount: od.count,
      };
    });
    const sum = (k: 'opening' | 'charges' | 'paid' | 'balance' | 'overdue') => fromCents(rows.reduce((t, r) => t + toCents(r[k]), 0));
    return {
      complex: { name: p.complex.name, currency: p.complex.currency },
      period: { from: p.from, to: p.to, months: p.months, asOf: p.today },
      totals: {
        units: rows.length, opening: sum('opening'), charges: sum('charges'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue'),
        unitsInArrears: rows.filter((r) => r.overdue > 0).length,
      },
      rows,
    };
  }

  /** Estado de cuenta detallado de una propiedad (también lo usa el portal con la propiedad del propietario). */
  async unit(complexId: string, unitId: string, q: PeriodQuery) {
    const [u] = await this.db.select().from(units).where(and(eq(units.id, unitId), eq(units.complexId, complexId)));
    if (!u) throw new NotFoundException('Propiedad no encontrada');
    const p = await this.period(complexId, q);
    const rec = await this.receivableId(complexId);
    const inRange = (col: typeof charges.issueDate | typeof movements.date) => and(gte(col, p.range.from), lte(col, p.range.to))!;

    const [chBefore, payBefore, chargeRows, payRows, res, others, late] = await Promise.all([
      this.chargeTotals(complexId, lt(charges.issueDate, p.range.from), u.id),
      this.paymentTotals(complexId, rec, lt(movements.date, p.range.from), u.id),
      this.db.select().from(charges).where(and(eq(charges.complexId, complexId), eq(charges.unitId, u.id), isNull(charges.voidedAt), inRange(charges.issueDate))).orderBy(asc(charges.issueDate), asc(charges.dueDate)),
      this.db
        .select({ id: movements.id, date: movements.date, amount: movements.amount, receiptNumber: movements.receiptNumber, description: movements.description, method: movements.method })
        .from(movements)
        .where(and(eq(movements.complexId, complexId), eq(movements.kind, 'INCOME'), eq(movements.accountId, rec), eq(movements.unitId, u.id), isNull(movements.voidedAt), inRange(movements.date)))
        .orderBy(asc(movements.date)),
      this.residents(complexId, [u.id]),
      // Otros ingresos de la propiedad (alquileres, servicios): informativos, no abonan a cuotas
      this.db
        .select({ id: movements.id, date: movements.date, amount: movements.amount, concept: accounts.name, description: movements.description, receiptNumber: movements.receiptNumber })
        .from(movements)
        .innerJoin(accounts, eq(accounts.id, movements.accountId))
        .where(and(eq(movements.complexId, complexId), eq(movements.kind, 'INCOME'), eq(movements.unitId, u.id), isNull(movements.voidedAt), ne(movements.accountId, rec), inRange(movements.date)))
        .orderBy(asc(movements.date)),
      this.overdue(complexId, p.today, u.id),
    ]);

    // Aplicaciones vigentes de pagos a los cargos del periodo (con su recibo)
    const apps = chargeRows.length
      ? await this.db
          .select({ chargeId: paymentAllocations.chargeId, appliedAt: paymentAllocations.appliedAt, amount: paymentAllocations.amount, receiptNumber: movements.receiptNumber })
          .from(paymentAllocations)
          .innerJoin(movements, eq(movements.id, paymentAllocations.movementId))
          .where(and(inArray(paymentAllocations.chargeId, chargeRows.map((c) => c.id)), isNull(paymentAllocations.voidedAt)))
      : [];

    const opening = toCents(chBefore[0]?.cents ?? 0) - toCents(payBefore[0]?.cents ?? 0);
    const s = buildStatement({
      openingCents: opening,
      today: p.today,
      from: p.range.from,
      charges: chargeRows.map((c) => ({
        id: c.id, issueDate: c.issueDate, dueDate: c.dueDate, description: c.description, amountCents: toCents(c.amount),
        applications: apps.filter((a) => a.chargeId === c.id).map((a) => ({ date: a.appliedAt, cents: toCents(a.amount), receiptNumber: a.receiptNumber })),
      })),
      payments: payRows.map((x) => ({ id: x.id, date: x.date, cents: toCents(x.amount), receiptNumber: x.receiptNumber, concept: x.description || 'Pago de cuotas' })),
    });
    const od = late.get(u.id) ?? { cents: 0, count: 0 };
    const kinds = new Map(chargeRows.map((c) => [c.id, c.kind]));

    return {
      complex: { name: p.complex.name, currency: p.complex.currency },
      period: { from: p.from, to: p.to, months: p.months, asOf: p.today },
      unit: { id: u.id, code: u.code, type: u.type, address: u.address, monthlyFee: fromCents(toCents(u.monthlyFee)), active: u.active },
      owner: { name: u.ownerName, email: u.ownerEmail, phone: u.ownerPhone },
      residents: res.map(({ fullName, email, phone }) => ({ fullName, email, phone })),
      summary: {
        opening: fromCents(s.openingCents), charges: fromCents(s.chargesCents), paid: fromCents(s.paidCents), balance: fromCents(s.balanceCents),
        overdue: fromCents(od.cents), overdueCount: od.count,
      },
      charges: s.charges.map((c) => ({
        id: c.id, kind: kinds.get(c.id), description: c.description, issueDate: c.issueDate, dueDate: c.dueDate,
        amount: fromCents(c.amountCents), paid: fromCents(c.paidCents), outstanding: fromCents(c.outstandingCents), status: c.status,
        applications: c.applications.map((a) => ({ date: a.date, amount: fromCents(a.cents), receiptNumber: a.receiptNumber })),
      })),
      lines: s.lines.map((l) => ({ date: l.date, kind: l.kind, concept: l.concept, charge: fromCents(l.chargeCents), payment: fromCents(l.paymentCents), balance: fromCents(l.balanceCents), receiptNumber: l.receiptNumber })),
      otherPayments: others.map((o) => ({ id: o.id, date: o.date, concept: o.description || o.concept, category: o.concept, amount: fromCents(toCents(o.amount)), receiptNumber: o.receiptNumber })),
    };
  }

  /** Saldo actual de una propiedad (portal y listados). */
  async balance(complexId: string, unitId: string) {
    const [c] = await this.db.select({ tz: complexes.timezone }).from(complexes).where(eq(complexes.id, complexId));
    const today = todayIn(c.tz);
    const rec = await this.receivableId(complexId);
    const [ch, pay, late] = await Promise.all([
      this.chargeTotals(complexId, lte(charges.issueDate, today), unitId),
      this.paymentTotals(complexId, rec, lte(movements.date, today), unitId),
      this.overdue(complexId, today, unitId),
    ]);
    const od = late.get(unitId) ?? { cents: 0, count: 0 };
    return { balance: fromCents(toCents(ch[0]?.cents ?? 0) - toCents(pay[0]?.cents ?? 0)), overdue: fromCents(od.cents), overdueCount: od.count, asOf: today };
  }
}
