import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, allocateFifo, chargeStatus, dueDateFor, lateFeeCents, matchCredit } from '../src/common/fees';
import { buildStatement } from '../src/common/statement';

test('cuotas: vencimiento por día configurado, ajustado a meses cortos', () => {
  assert.equal(dueDateFor('2026-03', 10), '2026-03-10');
  assert.equal(dueDateFor('2026-02', 31), '2026-02-28');
  assert.equal(dueDateFor('2028-02', 30), '2028-02-29');
  assert.equal(addDays('2026-12-30', 5), '2027-01-04');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('cuotas: estado del cargo según pago y vencimiento', () => {
  assert.equal(chargeStatus(7500, 7500, '2026-01-10', '2026-03-01'), 'PAGADO');
  assert.equal(chargeStatus(7500, 3000, '2026-04-10', '2026-04-02'), 'PARCIAL');
  assert.equal(chargeStatus(7500, 3000, '2026-04-10', '2026-04-11'), 'VENCIDO');
  assert.equal(chargeStatus(7500, 0, '2026-04-10', '2026-04-10'), 'PENDIENTE');
  assert.equal(chargeStatus(7500, 0, '2026-04-10', '2026-05-01', true), 'ANULADO');
});

test('cuotas: el pago se aplica a los cargos más antiguos y el sobrante queda a favor', () => {
  const pending = [{ id: 'ene', outstandingCents: 7500 }, { id: 'feb', outstandingCents: 7500 }, { id: 'mar', outstandingCents: 7500 }];
  assert.deepEqual(allocateFifo(pending, 10000), { allocations: [{ chargeId: 'ene', cents: 7500 }, { chargeId: 'feb', cents: 2500 }], excessCents: 0 });
  assert.deepEqual(allocateFifo(pending.slice(0, 1), 10000), { allocations: [{ chargeId: 'ene', cents: 7500 }], excessCents: 2500 });
  assert.deepEqual(allocateFifo([], 5000), { allocations: [], excessCents: 5000 });
});

test('cuotas: saldo a favor de varios pagos cubre cargos en orden', () => {
  const m = matchCredit(
    [{ movementId: 'p1', availableCents: 2500 }, { movementId: 'p2', availableCents: 10000 }],
    [{ id: 'abr', outstandingCents: 7500 }, { id: 'may', outstandingCents: 7500 }],
  );
  assert.deepEqual(m, [
    { chargeId: 'abr', movementId: 'p1', cents: 2500 },
    { chargeId: 'abr', movementId: 'p2', cents: 5000 },
    { chargeId: 'may', movementId: 'p2', cents: 5000 },
  ]);
});

test('cuotas: recargo fijo o porcentual', () => {
  assert.equal(lateFeeCents('FIXED', 500, 7500), 500);
  assert.equal(lateFeeCents('PERCENT', 1000, 7500), 750); // 10 % de $75
  assert.equal(lateFeeCents('PERCENT', 250, 7500), 188); // 2.5 % redondeado
  assert.equal(lateFeeCents('NONE', 500, 7500), 0);
});

test('estado de cuenta: saldo anterior, cargos, abonos y fechas de aplicación', () => {
  const s = buildStatement({
    openingCents: 7500,
    today: '2026-03-15',
    from: '2026-02-01',
    charges: [
      { id: 'feb', issueDate: '2026-02-01', dueDate: '2026-02-10', description: 'Cuota febrero', amountCents: 7500, applications: [{ date: '2026-03-05', cents: 7500, receiptNumber: '102' }] },
      { id: 'mar', issueDate: '2026-03-01', dueDate: '2026-03-10', description: 'Cuota marzo', amountCents: 7500, applications: [] },
    ],
    payments: [{ id: 'p', date: '2026-03-05', cents: 15000, receiptNumber: '102', concept: 'Pago' }],
  });
  assert.deepEqual(s.lines.map((l) => [l.kind, l.balanceCents]), [['SALDO', 7500], ['CARGO', 15000], ['CARGO', 22500], ['ABONO', 7500]]);
  assert.equal(s.balanceCents, 7500);
  assert.deepEqual(s.charges.map((c) => c.status), ['PAGADO', 'VENCIDO']);
  assert.equal(s.charges[0].applications[0].date, '2026-03-05');
});
