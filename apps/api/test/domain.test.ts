import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMeters, nearestFence } from '../src/common/geo';
import { holtForecast, forecastSeries, linearSlope } from '../src/common/forecast';
import { centsToDb, toCents } from '../src/common/money';
import { monthRange, addMonths, zonedStartOfDay } from '../src/common/dates';
import { pairShifts } from '../src/common/shifts';

test('haversine: San Salvador → Santa Tecla ≈ 7 km', () => {
  const d = haversineMeters(13.6929, -89.2182, 13.6769, -89.2797);
  assert.ok(d > 6000 && d < 8000, `distancia ${d}`);
});

test('geocerca: dentro, fuera y tolerancia por precisión GPS', () => {
  const fence = { id: 'f', name: 'Portería', latitude: 13.6929, longitude: -89.2182, radiusMeters: 100 };
  assert.equal(nearestFence(13.6929, -89.2182, [fence])!.within, true);
  // ~130 m al norte
  const far = nearestFence(13.69407, -89.2182, [fence], 0)!;
  assert.equal(far.within, false);
  assert.equal(nearestFence(13.69407, -89.2182, [fence], 40)!.within, true);
  assert.equal(nearestFence(0, 0, []), null);
});

test('dinero en centavos sin errores de punto flotante', () => {
  assert.equal(toCents('0.1') + toCents('0.2'), 30);
  assert.equal(centsToDb(toCents(19.99) * 3), '59.97');
});

test('Holt proyecta tendencia creciente y nunca negativa', () => {
  const f = holtForecast([100, 110, 120, 130, 140], 3);
  assert.ok(f[0] > 140 && f[2] > f[0]);
  assert.ok(holtForecast([50, 20, 5, 1], 6).every((v) => v >= 0));
  assert.deepEqual(holtForecast([], 2), [0, 0]);
  assert.equal(forecastSeries(Array(30).fill(100), 2, 0).method, 'holt-estacional');
  assert.ok(linearSlope([1, 2, 3, 4]) > 0.99);
});

test('fechas: rangos de mes y zonas horarias', () => {
  assert.deepEqual(monthRange(2024, 2), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(addMonths(2026, 1, -2), { year: 2025, month: 11 });
  // El Salvador es UTC-6 → 00:00 local = 06:00 UTC
  assert.equal(zonedStartOfDay('2026-10-31', 'America/El_Salvador').toISOString(), '2026-10-31T06:00:00.000Z');
});

test('marcación: empareja turnos y marca anomalías', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
  const shifts = pairShifts([
    { type: 'IN', serverTime: t(8), withinGeofence: true, manual: false, notes: null },
    { type: 'OUT', serverTime: t(17), withinGeofence: false, manual: false, notes: null },
    { type: 'IN', serverTime: t(20), withinGeofence: true, manual: true, notes: null },
  ]);
  assert.equal(shifts.length, 2);
  assert.equal(shifts[0].hours, 9);
  assert.deepEqual(shifts[0].flags, ['Fuera de geocerca']);
  assert.ok(shifts[1].flags.includes('Registro manual') && shifts[1].out === null);
});
