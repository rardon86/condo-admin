import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatement, monthsBetween } from '../src/common/statement';

const name = (m: string) => m;
const pay = (id: string, date: string, cents: number) => ({ id, date, cents, concept: 'Pago' });

test('estado de cuenta: meses del periodo, cruzando año', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthsBetween('2026-03', '2026-03'), ['2026-03']);
  assert.deepEqual(monthsBetween('2026-04', '2026-03'), []);
});

test('estado de cuenta: abonos se aplican a los meses más antiguos (FIFO) y la mora excluye el mes en curso', () => {
  const s = buildStatement(['2026-01', '2026-02', '2026-03', '2026-04'], 7500, [pay('a', '2026-03-05', 7500), pay('b', '2026-04-02', 3000)], '2026-04', name);
  assert.equal(s.chargesCents, 30000);
  assert.equal(s.paidCents, 10500);
  assert.equal(s.balanceCents, 19500);
  assert.deepEqual(s.months.map((m) => m.status), ['PAGADO', 'PARCIAL', 'PENDIENTE', 'PENDIENTE']);
  // Abril es el mes en curso: pendiente pero aún no vencido
  assert.deepEqual(s.months.map((m) => m.overdue), [false, true, true, false]);
  assert.equal(s.overdueMonths, 2);
  assert.equal(s.overdueCents, 4500 + 7500);
});

test('estado de cuenta: saldo acumulado cronológico y saldo a favor', () => {
  const s = buildStatement(['2026-01', '2026-02'], 7500, [pay('b', '2026-02-10', 10000), pay('a', '2026-01-15', 10000)], '2026-02', name);
  // Cargo de enero, abono 15-ene, cargo de febrero, abono 10-feb
  assert.deepEqual(s.lines.map((l) => l.kind), ['CARGO', 'ABONO', 'CARGO', 'ABONO']);
  assert.deepEqual(s.lines.map((l) => l.balanceCents), [7500, -2500, 5000, -5000]);
  assert.equal(s.balanceCents, -5000);
  assert.equal(s.overdueMonths, 0);
  assert.ok(s.months.every((m) => m.status === 'PAGADO'));
});

test('estado de cuenta: unidad sin cuota no genera cargos ni mora', () => {
  const s = buildStatement(['2026-01', '2026-02'], 0, [], '2026-03', name);
  assert.equal(s.lines.length, 0);
  assert.equal(s.overdueMonths, 0);
  assert.ok(s.months.every((m) => m.status === 'SIN_CARGO'));
});
