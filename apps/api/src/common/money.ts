/** Utilidades de dinero: en memoria se trabaja en centavos enteros para evitar errores de punto flotante. */
export const toCents = (v: string | number | null | undefined): number =>
  v === null || v === undefined || v === '' ? 0 : Math.round(Number(v) * 100);

export const fromCents = (c: number): number => Math.round(c) / 100;

/** Formato para columnas NUMERIC(14,2). */
export const centsToDb = (c: number): string => (Math.round(c) / 100).toFixed(2);

export const sumCents = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
