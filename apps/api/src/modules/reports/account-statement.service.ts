import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { monthRange, todayIn } from '../../common/dates';
import { fromCents, toCents } from '../../common/money';
import { buildStatement, monthsBetween, StatementPayment } from '../../common/statement';
import { DB, Db } from '../../db/client';
import { accounts, complexes, memberships, movements, units, users } from '../../db/schema';
import { SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** Máximo de meses por consulta (evita estados de cuenta gigantes). */
export const MAX_STATEMENT_MONTHS = 36;

const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato YYYY-MM');
/** Periodo del estado de cuenta en meses ('YYYY-MM'). */
export const statementQ = z.object({ from: zMonth.optional(), to: zMonth.optional() });
export type PeriodQuery = z.infer<typeof statementQ>;

/**
 * Estado de cuenta por unidad/propietario: cuotas del periodo contra pagos de cuotas (4100)
 * registrados a la unidad. Ver `common/statement.ts` para las reglas de aplicación.
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
    let months = monthsBetween(from, to);
    if (months.length > MAX_STATEMENT_MONTHS) months = months.slice(-MAX_STATEMENT_MONTHS);
    const [ty, tm] = to.split('-').map(Number);
    const lastDay = to === current ? today : monthRange(ty, tm).to;
    return { complex: c, today, current, from: months[0], to, months, range: { from: `${months[0]}-01`, to: lastDay } };
  }

  private async feesAccountId(complexId: string) {
    const [a] = await this.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.complexId, complexId), eq(accounts.code, SYSTEM_ACCOUNTS.MAINTENANCE_FEES)));
    return a?.id ?? null;
  }

  /** Cuotas cobradas en el periodo sin unidad asignada: no se pueden acreditar a ninguna cuenta. */
  private async unassignedFees(complexId: string, range: { from: string; to: string }) {
    const accountId = await this.feesAccountId(complexId);
    if (!accountId) return { count: 0, amount: '0' };
    const [r] = await this.db
      .select({ count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${movements.amount}), 0)` })
      .from(movements)
      .where(and(
        eq(movements.complexId, complexId),
        eq(movements.kind, 'INCOME'),
        eq(movements.accountId, accountId),
        isNull(movements.voidedAt),
        isNull(movements.unitId),
        gte(movements.date, range.from),
        lte(movements.date, range.to),
      ));
    return r;
  }

  /** Pagos de cuotas (no anulados) en el periodo; opcionalmente de una sola unidad. */
  private async feePayments(complexId: string, range: { from: string; to: string }, unitId?: string) {
    const accountId = await this.feesAccountId(complexId);
    if (!accountId) return [];
    return this.db
      .select({ id: movements.id, unitId: movements.unitId, date: movements.date, amount: movements.amount, description: movements.description, reference: movements.reference })
      .from(movements)
      .where(and(
        eq(movements.complexId, complexId),
        eq(movements.kind, 'INCOME'),
        eq(movements.accountId, accountId),
        isNull(movements.voidedAt),
        unitId ? eq(movements.unitId, unitId) : isNotNull(movements.unitId),
        gte(movements.date, range.from),
        lte(movements.date, range.to),
      ));
  }

  /** Propietarios registrados (portal) de un conjunto de unidades. */
  private async residents(complexId: string, unitIds: string[]) {
    if (!unitIds.length) return [];
    return this.db
      .select({ unitId: memberships.unitId, fullName: users.fullName, email: users.email, phone: users.phone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.complexId, complexId), eq(memberships.role, 'RESIDENT'), eq(memberships.status, 'ACTIVE'), inArray(memberships.unitId, unitIds)));
  }

  private toPayment = (p: { id: string; date: string; amount: string; description: string | null; reference: string | null }): StatementPayment => ({
    id: p.id, date: p.date, cents: toCents(p.amount), concept: p.description || 'Pago de cuota de mantenimiento', reference: p.reference,
  });

  /** Resumen de todas las unidades activas: cargos, pagos, saldo y meses en mora. */
  async summary(complexId: string, q: PeriodQuery) {
    const p = await this.period(complexId, q);
    const list = await this.db.select().from(units).where(and(eq(units.complexId, complexId), eq(units.active, true))).orderBy(asc(units.code));
    const [pays, res, unassigned] = await Promise.all([
      this.feePayments(complexId, p.range),
      this.residents(complexId, list.map((u) => u.id)),
      this.unassignedFees(complexId, p.range),
    ]);

    const rows = list.map((u) => {
      const s = buildStatement(p.months, toCents(u.monthlyFee), pays.filter((x) => x.unitId === u.id).map(this.toPayment), p.current, monthName);
      return {
        unitId: u.id,
        code: u.code,
        ownerName: u.ownerName ?? res.find((r) => r.unitId === u.id)?.fullName ?? null,
        monthlyFee: fromCents(toCents(u.monthlyFee)),
        charges: fromCents(s.chargesCents),
        paid: fromCents(s.paidCents),
        balance: fromCents(s.balanceCents),
        overdueMonths: s.overdueMonths,
        overdue: fromCents(s.overdueCents),
      };
    });

    const sum = (k: 'charges' | 'paid' | 'balance' | 'overdue') => fromCents(rows.reduce((t, r) => t + toCents(r[k]), 0));
    return {
      complex: { name: p.complex.name, currency: p.complex.currency },
      period: { from: p.from, to: p.to, months: p.months.length, asOf: p.today },
      totals: {
        units: rows.length,
        charges: sum('charges'),
        paid: sum('paid'),
        balance: sum('balance'),
        overdue: sum('overdue'),
        unitsInArrears: rows.filter((r) => r.overdueMonths > 0).length,
      },
      unassigned: { count: unassigned.count, amount: fromCents(toCents(unassigned.amount)) },
      rows,
    };
  }

  /** Estado de cuenta detallado de una unidad (también lo usa el portal del propietario con su propia unidad). */
  async unit(complexId: string, unitId: string, q: PeriodQuery) {
    const [u] = await this.db.select().from(units).where(and(eq(units.id, unitId), eq(units.complexId, complexId)));
    if (!u) throw new NotFoundException('Unidad no encontrada');
    const p = await this.period(complexId, q);

    const [pays, res, others] = await Promise.all([
      this.feePayments(complexId, p.range, u.id),
      this.residents(complexId, [u.id]),
      // Otros ingresos de la unidad (alquileres, servicios, recargos): informativos, no abonan a cuotas
      this.db
        .select({ id: movements.id, date: movements.date, amount: movements.amount, concept: accounts.name, description: movements.description, reference: movements.reference })
        .from(movements)
        .innerJoin(accounts, eq(accounts.id, movements.accountId))
        .where(and(
          eq(movements.complexId, complexId),
          eq(movements.kind, 'INCOME'),
          eq(movements.unitId, u.id),
          isNull(movements.voidedAt),
          ne(accounts.code, SYSTEM_ACCOUNTS.MAINTENANCE_FEES),
          gte(movements.date, p.range.from),
          lte(movements.date, p.range.to),
        ))
        .orderBy(asc(movements.date)),
    ]);

    const s = buildStatement(p.months, toCents(u.monthlyFee), pays.map(this.toPayment), p.current, monthName);
    return {
      complex: { name: p.complex.name, currency: p.complex.currency },
      period: { from: p.from, to: p.to, months: p.months.length, asOf: p.today },
      unit: { id: u.id, code: u.code, type: u.type, monthlyFee: fromCents(toCents(u.monthlyFee)), active: u.active },
      owner: { name: u.ownerName, email: u.ownerEmail, phone: u.ownerPhone },
      residents: res.map(({ fullName, email, phone }) => ({ fullName, email, phone })),
      summary: {
        charges: fromCents(s.chargesCents),
        paid: fromCents(s.paidCents),
        balance: fromCents(s.balanceCents),
        overdueMonths: s.overdueMonths,
        overdue: fromCents(s.overdueCents),
      },
      months: s.months.map((m) => ({ month: m.month, label: monthName(m.month), charge: fromCents(m.chargeCents), paid: fromCents(m.paidCents), status: m.status, overdue: m.overdue })),
      lines: s.lines.map((l) => ({ date: l.date, kind: l.kind, concept: l.concept, charge: fromCents(l.chargeCents), payment: fromCents(l.paymentCents), balance: fromCents(l.balanceCents), reference: l.reference ?? null })),
      otherPayments: others.map((o) => ({ id: o.id, date: o.date, concept: o.description || o.concept, category: o.concept, amount: fromCents(toCents(o.amount)), reference: o.reference })),
    };
  }
}

