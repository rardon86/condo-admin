/**
 * Estado de cuenta de una unidad (lógica pura, en centavos).
 *
 * Mientras no exista el módulo de cuotas (cargos en 1200 por cobrar), los cargos se derivan
 * de la cuota mensual vigente de la unidad y los abonos son los ingresos de cuotas (4100)
 * registrados a esa unidad. Los abonos se aplican a los meses más antiguos primero (FIFO).
 */
import { addMonths, monthKey } from './dates';

export type MonthStatus = 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'SIN_CARGO';

export interface StatementMonth {
  month: string; // 'YYYY-MM'
  chargeCents: number;
  paidCents: number;
  status: MonthStatus;
  /** El mes ya cerró sin pagarse completo. */
  overdue: boolean;
}

export interface StatementLine {
  date: string;
  kind: 'CARGO' | 'ABONO';
  concept: string;
  chargeCents: number;
  paymentCents: number;
  balanceCents: number;
  movementId?: string;
  reference?: string | null;
}

export interface StatementPayment {
  id: string;
  date: string;
  cents: number;
  concept: string;
  reference?: string | null;
}

/** Meses 'YYYY-MM' entre dos meses inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out: string[] = [];
  for (let cur = { year: fy, month: fm }; cur.year * 12 + cur.month <= ty * 12 + tm; cur = addMonths(cur.year, cur.month, 1)) {
    out.push(monthKey(cur.year, cur.month));
  }
  return out;
}

/**
 * Arma el estado de cuenta.
 * @param months meses del periodo (ya recortados a hoy)
 * @param feeCents cuota mensual de la unidad
 * @param currentMonth mes en curso ('YYYY-MM'): no cuenta como vencido
 */
export function buildStatement(months: string[], feeCents: number, payments: StatementPayment[], currentMonth: string, monthName: (m: string) => string) {
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const chargesCents = feeCents * months.length;
  const paidCents = sorted.reduce((s, p) => s + p.cents, 0);

  // Aplicación FIFO de los abonos a los meses
  let pool = paidCents;
  const byMonth: StatementMonth[] = months.map((month) => {
    const applied = Math.min(pool, feeCents);
    pool -= applied;
    const status: MonthStatus = feeCents === 0 ? 'SIN_CARGO' : applied >= feeCents ? 'PAGADO' : applied > 0 ? 'PARCIAL' : 'PENDIENTE';
    return { month, chargeCents: feeCents, paidCents: applied, status, overdue: month < currentMonth && (status === 'PARCIAL' || status === 'PENDIENTE') };
  });

  // Movimientos en orden cronológico con saldo acumulado (cargo el día 1 de cada mes)
  const events = [
    ...(feeCents > 0 ? months.map((m) => ({ date: `${m}-01`, order: 0, kind: 'CARGO' as const, concept: `Cuota de mantenimiento ${monthName(m)}`, cents: feeCents })) : []),
    ...sorted.map((p) => ({ date: p.date, order: 1, kind: 'ABONO' as const, concept: p.concept, cents: p.cents, id: p.id, reference: p.reference })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  let balance = 0;
  const lines: StatementLine[] = events.map((e) => {
    balance += e.kind === 'CARGO' ? e.cents : -e.cents;
    return {
      date: e.date,
      kind: e.kind,
      concept: e.concept,
      chargeCents: e.kind === 'CARGO' ? e.cents : 0,
      paymentCents: e.kind === 'ABONO' ? e.cents : 0,
      balanceCents: balance,
      ...('id' in e ? { movementId: e.id, reference: e.reference ?? null } : {}),
    };
  });

  const overdue = byMonth.filter((m) => m.overdue);
  return {
    chargesCents,
    paidCents,
    /** Positivo = saldo pendiente; negativo = saldo a favor. */
    balanceCents: chargesCents - paidCents,
    overdueMonths: overdue.length,
    overdueCents: overdue.reduce((s, m) => s + m.chargeCents - m.paidCents, 0),
    months: byMonth,
    lines,
  };
}
