import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedMessage, isOpen, parseServiceHours } from '../src/common/service-hours';

const SV = 'America/El_Salvador'; // UTC-6 todo el año
const at = (utc: string) => new Date(`2026-11-16T${utc}:00Z`);

test('horario: sin valor = 24 h', () => {
  assert.equal(parseServiceHours(undefined, SV), null);
  assert.equal(parseServiceHours('  ', SV), null);
  assert.equal(isOpen(null, at('03:00')), true);
});

test('horario: 09:00-18:00 en hora de El Salvador', () => {
  const h = parseServiceHours('09:00-18:00', SV);
  assert.equal(isOpen(h, at('14:59')), false); // 8:59 SV
  assert.equal(isOpen(h, at('15:00')), true); // 9:00 SV
  assert.equal(isOpen(h, at('23:59')), true); // 17:59 SV
  assert.equal(isOpen(h, at('00:00')), false); // 18:00 SV
});

test('horario: cruza la medianoche', () => {
  const h = parseServiceHours('22:00-06:00', SV);
  assert.equal(isOpen(h, at('04:30')), true); // 22:30 SV
  assert.equal(isOpen(h, at('13:00')), false); // 7:00 SV
});

test('horario: rechaza formatos inválidos', () => {
  assert.throws(() => parseServiceHours('9-18', SV));
  assert.throws(() => parseServiceHours('09:00', SV));
  assert.throws(() => parseServiceHours('09:00-09:00', SV));
  assert.throws(() => parseServiceHours('25:00-18:00', SV));
});

test('horario: mensaje legible', () => {
  assert.equal(
    closedMessage(parseServiceHours('09:00-18:00', SV)!),
    'El sistema está fuera de horario. Disponible de 9:00 a.m. a 6:00 p.m. (hora de El Salvador).',
  );
});
