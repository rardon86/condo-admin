/** Fechas contables como 'YYYY-MM-DD' (sin zona horaria). */
export const pad = (n: number) => String(n).padStart(2, '0');

export function monthRange(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

export function addMonths(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;

/** Fecha de hoy en la zona horaria del complejo. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function lastNMonths(year: number, month: number, n: number) {
  return Array.from({ length: n }, (_, i) => addMonths(year, month, i - n + 1));
}

/** Desfase (ms) de una zona horaria respecto a UTC en un instante dado. */
function tzOffsetMs(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instant;
}

/** Instante UTC correspondiente a las 00:00 de una fecha local ('YYYY-MM-DD') en la zona del complejo. */
export function zonedStartOfDay(day: string, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMs(guess, timezone));
}
