import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { addMonths, lastNMonths, monthKey, monthRange, todayIn } from '../../common/dates';
import { forecastSeries, linearSlope } from '../../common/forecast';
import { fromCents, toCents } from '../../common/money';
import { DB, Db } from '../../db/client';
import { accounts, charges, complexes, employeeAssignments, movements, paymentAllocations, units } from '../../db/schema';
import { isGroupAccount, SYSTEM_ACCOUNTS } from '../ledger/chart-of-accounts';
import { AccountBalance, LedgerService } from '../ledger/ledger.service';

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : 0);
const change = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null);
const line = (b: AccountBalance) => ({ code: b.code, name: b.name, amount: fromCents(b.balance) });

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
  ) {}

  private async complex(complexId: string) {
    const [c] = await this.db.select().from(complexes).where(eq(complexes.id, complexId));
    return c;
  }

  // ───────────────────────── Informe mensual de gastos ─────────────────────────
  async monthlyExpenses(complexId: string, year: number, month: number) {
    const cur = monthRange(year, month);
    const p = addMonths(year, month, -1);
    const prev = monthRange(p.year, p.month);
    const ly = monthRange(year - 1, month);

    const [now, before, lastYear] = await Promise.all([
      this.ledger.balances(complexId, cur),
      this.ledger.balances(complexId, prev),
      this.ledger.balances(complexId, ly),
    ]);
    const exp = (rows: AccountBalance[]) => rows.filter((r) => r.type === 'EXPENSE');
    const total = exp(now).reduce((s, r) => s + r.balance, 0);
    const prevTotal = exp(before).reduce((s, r) => s + r.balance, 0);
    const lyTotal = exp(lastYear).reduce((s, r) => s + r.balance, 0);
    const income = now.filter((r) => r.type === 'INCOME').reduce((s, r) => s + r.balance, 0);

    const byCategory = exp(now)
      .filter((r) => r.balance !== 0)
      .sort((a, b) => b.balance - a.balance)
      .map((r) => {
        const prevAmt = exp(before).find((x) => x.accountId === r.accountId)?.balance ?? 0;
        return { code: r.code, name: r.name, amount: fromCents(r.balance), pct: pct(r.balance, total), previous: fromCents(prevAmt), changePct: change(r.balance, prevAmt) };
      });

    const base = and(eq(movements.complexId, complexId), eq(movements.kind, 'EXPENSE'), isNull(movements.voidedAt), gte(movements.date, cur.from), lte(movements.date, cur.to));
    const [byVendor, daily, largest] = await Promise.all([
      this.db
        .select({ vendor: sql<string>`coalesce(${movements.counterparty}, 'Sin proveedor')`, amount: sql<string>`sum(${movements.amount})`, count: sql<number>`count(*)::int` })
        .from(movements)
        .where(base)
        .groupBy(sql`1`)
        .orderBy(desc(sql`sum(${movements.amount})`))
        .limit(10),
      this.db
        .select({ date: movements.date, amount: sql<string>`sum(${movements.amount})` })
        .from(movements)
        .where(base)
        .groupBy(movements.date)
        .orderBy(movements.date),
      this.db
        .select({ id: movements.id, date: movements.date, amount: movements.amount, description: movements.description, counterparty: movements.counterparty, category: accounts.name })
        .from(movements)
        .innerJoin(accounts, eq(accounts.id, movements.accountId))
        .where(base)
        .orderBy(desc(movements.amount))
        .limit(10),
    ]);

    return {
      period: { year, month, ...cur },
      total: fromCents(total),
      income: fromCents(income),
      expenseToIncomePct: income ? pct(total, income) : null,
      previousMonth: { total: fromCents(prevTotal), changePct: change(total, prevTotal) },
      sameMonthLastYear: { total: fromCents(lyTotal), changePct: change(total, lyTotal) },
      byCategory,
      byVendor: byVendor.map((v) => ({ ...v, amount: Number(v.amount) })),
      daily: daily.map((d) => ({ date: d.date, amount: Number(d.amount) })),
      largest: largest.map((l) => ({ ...l, amount: Number(l.amount) })),
    };
  }

  // ───────────────────────── Estados financieros ─────────────────────────

  /** Estado de resultados (ingresos − gastos) para un periodo. */
  async incomeStatement(complexId: string, from: string, to: string) {
    const rows = (await this.ledger.balances(complexId, { from, to })).filter((r) => !isGroupAccount(r.code));
    const income = rows.filter((r) => r.type === 'INCOME' && r.balance !== 0);
    const expense = rows.filter((r) => r.type === 'EXPENSE' && r.balance !== 0);
    const ti = income.reduce((s, r) => s + r.balance, 0);
    const te = expense.reduce((s, r) => s + r.balance, 0);
    return {
      period: { from, to },
      income: { lines: income.map(line), total: fromCents(ti) },
      expenses: { lines: expense.map(line), total: fromCents(te) },
      netResult: fromCents(ti - te),
      marginPct: ti ? pct(ti - te, ti) : null,
    };
  }

  /** Balance general a una fecha. El resultado acumulado se presenta dentro del patrimonio. */
  async balanceSheet(complexId: string, asOf: string) {
    const rows = await this.ledger.balances(complexId, { to: asOf });
    const of = (t: AccountBalance['type']) => rows.filter((r) => r.type === t && r.balance !== 0);
    const sum = (xs: AccountBalance[]) => xs.reduce((s, r) => s + r.balance, 0);
    const assets = of('ASSET');
    const liabilities = of('LIABILITY');
    const equity = of('EQUITY');
    const result = sum(of('INCOME')) - sum(of('EXPENSE'));
    const ta = sum(assets);
    const tl = sum(liabilities);
    const te = sum(equity) + result;
    return {
      asOf,
      assets: { lines: assets.map(line), total: fromCents(ta) },
      liabilities: { lines: liabilities.map(line), total: fromCents(tl) },
      equity: { lines: [...equity.map(line), { code: '3900', name: 'Resultado del ejercicio y acumulados', amount: fromCents(result) }], total: fromCents(te) },
      /** Comprobación de la ecuación contable: Activo = Pasivo + Patrimonio. */
      balanced: ta === tl + te,
    };
  }

  /** Flujo de efectivo (método directo) a partir de los movimientos de caja. */
  async cashFlow(complexId: string, from: string, to: string) {
    const dayBefore = new Date(`${from}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const [opening, closing, period] = await Promise.all([
      this.ledger.cashBalance(complexId, dayBefore.toISOString().slice(0, 10)),
      this.ledger.cashBalance(complexId, to),
      this.ledger.balances(complexId, { from, to }),
    ]);
    const inflows = period.filter((r) => r.type === 'INCOME' && r.balance !== 0).map(line);
    const outflows = period.filter((r) => r.type === 'EXPENSE' && r.balance !== 0).map(line);
    const tin = inflows.reduce((s, l) => s + toCents(l.amount), 0);
    const tout = outflows.reduce((s, l) => s + toCents(l.amount), 0);
    const other = closing - opening - (tin - tout); // aportes, saldo inicial, etc.
    return {
      period: { from, to },
      openingCash: fromCents(opening),
      operating: { inflows, outflows, totalIn: fromCents(tin), totalOut: fromCents(tout), net: fromCents(tin - tout) },
      otherMovements: fromCents(other),
      closingCash: fromCents(closing),
    };
  }

  // ───────────────────────── Series, proyecciones y análisis ─────────────────────────

  async monthlySeries(complexId: string, endYear: number, endMonth: number, months: number) {
    const list = lastNMonths(endYear, endMonth, months);
    const from = monthRange(list[0].year, list[0].month).from;
    const to = monthRange(endYear, endMonth).to;
    const map = await this.ledger.monthlyTotals(complexId, from, to);
    return list.map(({ year, month }) => {
      const m = map.get(monthKey(year, month)) ?? { income: 0, expense: 0 };
      return { month: monthKey(year, month), income: fromCents(m.income), expense: fromCents(m.expense), net: fromCents(m.income - m.expense) };
    });
  }

  /**
   * Proyección mensual de ingresos y gastos (Holt; estacional con ≥24 meses de historia),
   * proyección anual (real a la fecha + proyectado) y autonomía de caja.
   */
  async projections(complexId: string, horizon = 6) {
    const c = await this.complex(complexId);
    const today = todayIn(c.timezone);
    const [y, m] = today.split('-').map(Number);
    const last = addMonths(y, m, -1); // último mes cerrado
    const history = await this.monthlySeries(complexId, last.year, last.month, 24);
    const firstWithData = history.findIndex((h) => h.income !== 0 || h.expense !== 0);
    const usable = firstWithData === -1 ? [] : history.slice(firstWithData);
    const startMonth0 = usable.length ? Number(usable[0].month.slice(5)) - 1 : 0;

    const inc = forecastSeries(usable.map((h) => h.income), horizon, startMonth0);
    const exp = forecastSeries(usable.map((h) => h.expense), horizon, startMonth0);
    const forecast = Array.from({ length: horizon }, (_, i) => {
      const k = addMonths(last.year, last.month, i + 1);
      const income = Math.round(inc.values[i] * 100) / 100;
      const expense = Math.round(exp.values[i] * 100) / 100;
      return { month: monthKey(k.year, k.month), income, expense, net: Math.round((income - expense) * 100) / 100 };
    });

    // Proyección anual del año en curso
    const ytd = await this.monthlySeries(complexId, y, m, m);
    const actualIncome = ytd.reduce((s, r) => s + r.income, 0);
    const actualExpense = ytd.reduce((s, r) => s + r.expense, 0);
    const remaining = 12 - m; // el mes actual se cuenta como real (parcial)
    const yearForecast = forecastSeries(usable.map((h) => h.income), remaining, startMonth0).values;
    const yearForecastExp = forecastSeries(usable.map((h) => h.expense), remaining, startMonth0).values;
    const projIncome = actualIncome + yearForecast.reduce((a, b) => a + b, 0);
    const projExpense = actualExpense + yearForecastExp.reduce((a, b) => a + b, 0);

    const cash = fromCents(await this.ledger.cashBalance(complexId, today));
    // Saldo de caja proyectado mes a mes
    let running = cash;
    const cashPath = forecast.map((f) => ({ month: f.month, cash: Math.round((running += f.net) * 100) / 100 }));
    const depletion = cashPath.find((p) => p.cash < 0)?.month ?? null;

    const netSlope = linearSlope(usable.slice(-6).map((h) => h.net));
    return {
      method: inc.method,
      monthsOfHistory: usable.length,
      history: usable,
      forecast,
      cashPath,
      cashDepletionMonth: depletion,
      trend: netSlope > 1 ? 'MEJORANDO' : netSlope < -1 ? 'DETERIORANDO' : 'ESTABLE',
      annual: {
        year: y,
        actual: { income: round(actualIncome), expense: round(actualExpense), net: round(actualIncome - actualExpense) },
        projected: { income: round(projIncome), expense: round(projExpense), net: round(projIncome - projExpense) },
      },
    };
  }

  /** Comparativo anual por mes y por categoría. */
  async annual(complexId: string, year: number) {
    const series = await this.monthlySeries(complexId, year, 12, 12);
    const prev = await this.monthlySeries(complexId, year - 1, 12, 12);
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const rows = (await this.ledger.balances(complexId, { from, to })).filter((r) => (r.type === 'INCOME' || r.type === 'EXPENSE') && r.balance !== 0);
    const tot = (xs: { income: number; expense: number }[]) => ({
      income: round(xs.reduce((s, r) => s + r.income, 0)),
      expense: round(xs.reduce((s, r) => s + r.expense, 0)),
    });
    const t = tot(series);
    const p = tot(prev);
    return {
      year,
      months: series.map((s, i) => ({ ...s, prevIncome: prev[i].income, prevExpense: prev[i].expense })),
      totals: { ...t, net: round(t.income - t.expense) },
      previousYear: { ...p, net: round(p.income - p.expense) },
      growth: { income: change(t.income, p.income), expense: change(t.expense, p.expense) },
      byCategory: rows.map((r) => ({ type: r.type, ...line(r) })),
    };
  }

  // ───────────────────────── Panel principal ─────────────────────────
  async dashboard(complexId: string) {
    const c = await this.complex(complexId);
    const today = todayIn(c.timezone);
    const [y, m] = today.split('-').map(Number);
    const cur = monthRange(y, m);

    const [cashCents, monthRows, series, unitAgg, empCount] = await Promise.all([
      this.ledger.cashBalance(complexId, today),
      this.ledger.balances(complexId, cur),
      this.monthlySeries(complexId, y, m, 6),
      this.db
        .select({ count: sql<number>`count(*)::int`, fees: sql<string>`coalesce(sum(${units.monthlyFee}), 0)` })
        .from(units)
        .where(and(eq(units.complexId, complexId), eq(units.active, true))),
      this.db.select({ count: sql<number>`count(*)::int` }).from(employeeAssignments).where(and(eq(employeeAssignments.complexId, complexId), eq(employeeAssignments.active, true))),
    ]);

    const income = monthRows.filter((r) => r.type === 'INCOME').reduce((s, r) => s + r.balance, 0);
    const expense = monthRows.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.balance, 0);
    // Cobranza del mes: cuotas emitidas del mes contra lo aplicado a ellas (módulo de cuotas).
    // Sin cuotas emitidas, se estima con la cuota de cada propiedad y lo ingresado en 4100.
    const [fee] = await this.db
      .select({
        expected: sql<string>`coalesce(sum(distinct_charges.amount), 0)`,
        collected: sql<string>`coalesce(sum(distinct_charges.paid), 0)`,
      })
      .from(
        this.db
          .select({
            amount: charges.amount,
            paid: sql<string>`coalesce(sum(${paymentAllocations.amount}) filter (where ${paymentAllocations.voidedAt} is null), 0)`.as('paid'),
          })
          .from(charges)
          .leftJoin(paymentAllocations, eq(paymentAllocations.chargeId, charges.id))
          .where(and(eq(charges.complexId, complexId), eq(charges.kind, 'CUOTA'), eq(charges.period, today.slice(0, 7)), isNull(charges.voidedAt)))
          .groupBy(charges.id)
          .as('distinct_charges'),
      );
    const useCharges = toCents(fee.expected) > 0;
    const collected = useCharges ? toCents(fee.collected) : (monthRows.find((r) => r.code === SYSTEM_ACCOUNTS.MAINTENANCE_FEES)?.balance ?? 0);
    const expected = useCharges ? toCents(fee.expected) : toCents(unitAgg[0].fees);
    const receivable = (await this.ledger.balances(complexId, { to: today })).find((r) => r.code === SYSTEM_ACCOUNTS.RECEIVABLE)?.balance ?? 0;
    const collectionRate = expected ? pct(collected, expected) : null;

    // Autonomía: meses que la caja cubre el gasto promedio de los últimos 3 meses cerrados.
    const closed = series.slice(0, -1).slice(-3).filter((s) => s.expense > 0);
    const avgExpense = closed.length ? closed.reduce((s, r) => s + r.expense, 0) / closed.length : fromCents(expense);
    const cash = fromCents(cashCents);
    const runwayMonths = avgExpense > 0 ? Math.round((cash / avgExpense) * 10) / 10 : null;

    const issues: string[] = [];
    if (cash < 0) issues.push('Saldo de caja negativo');
    if (runwayMonths !== null && runwayMonths < 1) issues.push('Autonomía menor a 1 mes');
    else if (runwayMonths !== null && runwayMonths < 3) issues.push('Autonomía menor a 3 meses');
    if (collectionRate !== null && collectionRate < 80) issues.push('Cobranza por debajo de la meta (80%)');
    if (income - expense < 0) issues.push('Balance mensual negativo');
    const health = cash < 0 || (runwayMonths !== null && runwayMonths < 1) ? 'CRITICA' : issues.length ? 'ATENCION' : 'BUENA';

    const slope = linearSlope(series.slice(0, -1).map((s) => s.net));
    return {
      asOf: today,
      currency: c.currency,
      openingBalanceConfigured: c.openingBalanceDate !== null,
      cashBalance: cash,
      month: { income: fromCents(income), expense: fromCents(expense), net: fromCents(income - expense) },
      collection: { rate: collectionRate, collected: fromCents(collected), expected: fromCents(expected), goal: 80, receivable: fromCents(receivable) },
      runwayMonths,
      avgMonthlyExpense: round(avgExpense),
      health: { level: health, issues },
      trend: slope > 1 ? 'MEJORANDO' : slope < -1 ? 'DETERIORANDO' : 'ESTABLE',
      series,
      counts: { units: unitAgg[0].count, employees: empCount[0].count },
    };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
