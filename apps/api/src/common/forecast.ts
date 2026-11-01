/**
 * Modelos de proyección simples y explicables (adecuados para series mensuales cortas de un condominio).
 *  - Holt (suavizado exponencial doble): nivel + tendencia.
 *  - Con ≥ 24 meses se aplica un índice estacional multiplicativo por mes.
 */
export function holtForecast(values: number[], horizon: number, alpha = 0.5, beta = 0.3): number[] {
  const n = values.length;
  if (n === 0) return Array(horizon).fill(0);
  if (n < 3) {
    const mean = values.reduce((a, b) => a + b, 0) / n;
    return Array(horizon).fill(Math.max(0, mean));
  }
  let level = values[0];
  let trend = values[1] - values[0];
  for (let i = 1; i < n; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return Array.from({ length: horizon }, (_, h) => Math.max(0, level + (h + 1) * trend));
}

/** Índices estacionales (12 valores, promedio = 1). Requiere al menos 24 observaciones. */
export function seasonalIndices(values: number[], startMonth: number): number[] | null {
  if (values.length < 24) return null;
  const sums = Array(12).fill(0);
  const counts = Array(12).fill(0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  values.forEach((v, i) => {
    const m = (startMonth + i) % 12;
    sums[m] += v / mean;
    counts[m] += 1;
  });
  return sums.map((s, m) => (counts[m] ? s / counts[m] : 1));
}

export function forecastSeries(values: number[], horizon: number, startMonth: number) {
  const idx = seasonalIndices(values, startMonth);
  if (!idx) return { method: 'holt', values: holtForecast(values, horizon) };
  const deseasonalized = values.map((v, i) => v / (idx[(startMonth + i) % 12] || 1));
  const base = holtForecast(deseasonalized, horizon);
  const nextMonth = startMonth + values.length;
  return { method: 'holt-estacional', values: base.map((v, h) => Math.max(0, v * idx[(nextMonth + h) % 12])) };
}

/** Pendiente de regresión lineal (unidades por periodo). */
export function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  return den === 0 ? 0 : num / den;
}
