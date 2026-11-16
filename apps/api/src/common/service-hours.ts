/**
 * Horario de servicio opcional (SERVICE_HOURS="09:00-18:00"): fuera de él la API responde 503 con un
 * aviso y la web muestra "Fuera de horario". Sin valor, el servicio es 24 h.
 */
export interface ServiceHours { start: number; end: number; timeZone: string }

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (s: string) => {
  const m = HHMM.exec(s.trim());
  if (!m) throw new Error(`Hora inválida "${s}" (usa HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

export function parseServiceHours(spec: string | undefined, timeZone: string): ServiceHours | null {
  if (!spec?.trim()) return null;
  const [a, b, extra] = spec.split('-');
  if (!b || extra !== undefined) throw new Error(`SERVICE_HOURS inválido "${spec}" (ejemplo: 09:00-18:00)`);
  const start = toMinutes(a);
  const end = toMinutes(b);
  if (start === end) throw new Error('SERVICE_HOURS: la hora de inicio y fin no pueden ser iguales');
  return { start, end, timeZone };
}

/** Minutos desde la medianoche en la zona indicada. */
function minutesIn(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/** Admite horarios que cruzan la medianoche (p. ej. 22:00-06:00). */
export function isOpen(h: ServiceHours | null, now = new Date()): boolean {
  if (!h) return true;
  const m = minutesIn(h.timeZone, now);
  return h.start < h.end ? m >= h.start && m < h.end : m >= h.start || m < h.end;
}

const label = (min: number) => {
  const h = Math.floor(min / 60);
  const suffix = h < 12 ? 'a.m.' : 'p.m.';
  return `${h % 12 || 12}:${String(min % 60).padStart(2, '0')} ${suffix}`;
};

export function closedMessage(h: ServiceHours): string {
  const zone = h.timeZone === 'America/El_Salvador' ? 'hora de El Salvador' : h.timeZone;
  return `El sistema está fuera de horario. Disponible de ${label(h.start)} a ${label(h.end)} (${zone}).`;
}
