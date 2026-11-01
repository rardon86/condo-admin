const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export interface Fence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/** Devuelve la geocerca más cercana y si el punto está dentro (considerando la precisión del GPS). */
export function nearestFence(lat: number, lng: number, fences: Fence[], accuracy = 0) {
  let best: { fence: Fence; distance: number } | null = null;
  for (const f of fences) {
    const d = haversineMeters(lat, lng, f.latitude, f.longitude);
    if (!best || d < best.distance) best = { fence: f, distance: d };
  }
  if (!best) return null;
  // Tolerancia: se acepta si el círculo de precisión toca la geocerca, con tope de 50 m extra.
  const tolerance = Math.min(Math.max(accuracy, 0), 50);
  return { ...best, within: best.distance <= best.fence.radiusMeters + tolerance };
}
