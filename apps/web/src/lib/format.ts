const currency = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' });
export const money = (v: number | string | null | undefined) => currency.format(Number(v ?? 0));
export const num = (v: number, d = 1) => new Intl.NumberFormat('es-SV', { maximumFractionDigits: d }).format(v);

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-03' → 'mar 26' */
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
/** '2026-03-17' → '17 mar 2026' */
export const dateLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
export const dateTime = (d: string | Date) => new Date(d).toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'short' });

export const today = () => new Date().toLocaleDateString('en-CA');
export const firstOfMonth = () => today().slice(0, 8) + '01';

export const METHODS: Record<string, string> = { CASH: 'Efectivo', TRANSFER: 'Transferencia', CARD: 'Tarjeta', CHECK: 'Cheque', OTHER: 'Otro' };
export const ROLES: Record<string, string> = { OWNER: 'Propietario', ADMIN: 'Administrador', ACCOUNTANT: 'Contador', STAFF: 'Personal', VIEWER: 'Consulta' };
export const COMPLEX_TYPES: Record<string, string> = { RESIDENTIAL: 'Residencial', RECREATIONAL: 'Recreativo', MIXED: 'Mixto' };
