/**
 * Reglas puras del módulo de cuotas (en centavos). Sin acceso a BD para poder probarlas.
 */
import { pad } from './dates';

export type ChargeStatus = 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'VENCIDO' | 'ANULADO';

/** Estado de un cargo a una fecha: vencido = pasó su fecha de vencimiento sin pagarse completo. */
export function chargeStatus(amountCents: number, paidCents: number, dueDate: string, today: string, voided = false): ChargeStatus {
  if (voided) return 'ANULADO';
  if (paidCents >= amountCents) return 'PAGADO';
  if (dueDate < today) return 'VENCIDO';
  return paidCents > 0 ? 'PARCIAL' : 'PENDIENTE';
}

/** Fecha de vencimiento de la cuota de un mes ('YYYY-MM') con el día configurado (se ajusta a meses cortos). */
export function dueDateFor(period: string, day: number): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${pad(Math.min(Math.max(day, 1), last))}`;
}

/** Suma días a una fecha 'YYYY-MM-DD'. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Recargo por mora: monto fijo o porcentaje del cargo original. */
export function lateFeeCents(type: 'NONE' | 'FIXED' | 'PERCENT', valueCents: number, chargeCents: number): number {
  if (type === 'FIXED') return Math.max(valueCents, 0);
  // En PERCENT el valor se guarda como NUMERIC(14,2): 5.00 = 5 %, que en centavos es 500
  if (type === 'PERCENT') return Math.max(Math.round((chargeCents * valueCents) / 10_000), 0);
  return 0;
}

export interface Pending {
  id: string;
  outstandingCents: number;
}

/**
 * Aplica un monto a los cargos pendientes en el orden recibido (más antiguos primero).
 * Devuelve qué se aplicó a cada cargo y el sobrante (saldo a favor).
 */
export function allocateFifo(pending: Pending[], amountCents: number) {
  let left = amountCents;
  const allocations: { chargeId: string; cents: number }[] = [];
  for (const p of pending) {
    if (left <= 0) break;
    const cents = Math.min(left, p.outstandingCents);
    if (cents <= 0) continue;
    allocations.push({ chargeId: p.id, cents });
    left -= cents;
  }
  return { allocations, excessCents: left };
}

/**
 * Cruza fuentes de saldo a favor (pagos con sobrante) con cargos pendientes, ambos ya ordenados por antigüedad.
 */
export function matchCredit(sources: { movementId: string; availableCents: number }[], pending: Pending[]) {
  const out: { chargeId: string; movementId: string; cents: number }[] = [];
  const left = pending.map((p) => ({ ...p }));
  for (const s of sources) {
    let avail = s.availableCents;
    for (const p of left) {
      if (avail <= 0) break;
      const cents = Math.min(avail, p.outstandingCents);
      if (cents <= 0) continue;
      out.push({ chargeId: p.id, movementId: s.movementId, cents });
      p.outstandingCents -= cents;
      avail -= cents;
    }
  }
  return out;
}
