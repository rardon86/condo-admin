/**
 * Estado de cuenta de una propiedad (lógica pura, en centavos).
 * Saldo = saldo anterior + cargos del periodo − pagos del periodo (positivo = debe; negativo = saldo a favor).
 */
import { chargeStatus, ChargeStatus } from './fees';

export interface StatementCharge {
  id: string;
  issueDate: string;
  dueDate: string;
  description: string;
  amountCents: number;
  /** Aplicaciones vigentes de pagos a este cargo. */
  applications: { date: string; cents: number; receiptNumber: string | null }[];
}

export interface StatementPayment {
  id: string;
  date: string;
  cents: number;
  receiptNumber: string | null;
  concept: string;
}

export interface StatementLine {
  date: string;
  kind: 'SALDO' | 'CARGO' | 'ABONO';
  concept: string;
  chargeCents: number;
  paymentCents: number;
  balanceCents: number;
  receiptNumber: string | null;
}

export function buildStatement(input: { openingCents: number; charges: StatementCharge[]; payments: StatementPayment[]; today: string; from: string }) {
  const charges = input.charges.map((c) => {
    const paidCents = c.applications.reduce((s, a) => s + a.cents, 0);
    const status: ChargeStatus = chargeStatus(c.amountCents, paidCents, c.dueDate, input.today);
    return { ...c, paidCents, outstandingCents: c.amountCents - paidCents, status, applications: [...c.applications].sort((a, b) => a.date.localeCompare(b.date)) };
  });

  const events = [
    ...charges.map((c) => ({ date: c.issueDate, order: 0, kind: 'CARGO' as const, concept: c.description, cents: c.amountCents, receiptNumber: null })),
    ...input.payments.map((p) => ({ date: p.date, order: 1, kind: 'ABONO' as const, concept: p.concept, cents: p.cents, receiptNumber: p.receiptNumber })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  let balance = input.openingCents;
  const lines: StatementLine[] = [
    { date: input.from, kind: 'SALDO', concept: 'Saldo anterior', chargeCents: 0, paymentCents: 0, balanceCents: balance, receiptNumber: null },
  ];
  for (const e of events) {
    balance += e.kind === 'CARGO' ? e.cents : -e.cents;
    lines.push({
      date: e.date, kind: e.kind, concept: e.concept, receiptNumber: e.receiptNumber, balanceCents: balance,
      chargeCents: e.kind === 'CARGO' ? e.cents : 0, paymentCents: e.kind === 'ABONO' ? e.cents : 0,
    });
  }

  const chargesCents = charges.reduce((s, c) => s + c.amountCents, 0);
  const paidCents = input.payments.reduce((s, p) => s + p.cents, 0);
  return { openingCents: input.openingCents, chargesCents, paidCents, balanceCents: input.openingCents + chargesCents - paidCents, charges, lines };
}
