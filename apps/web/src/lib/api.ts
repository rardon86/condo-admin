/** Cliente HTTP: agrega token y complejo activo, y renueva la sesión automáticamente ante un 401. */
const BASE = import.meta.env.VITE_API_URL ?? '/api';

const store = {
  get access() { return localStorage.getItem('accessToken'); },
  get refresh() { return localStorage.getItem('refreshToken'); },
  get complex() { return localStorage.getItem('complexId'); },
  setTokens(t: { accessToken: string; refreshToken: string }) {
    localStorage.setItem('accessToken', t.accessToken);
    localStorage.setItem('refreshToken', t.refreshToken);
  },
  setComplex(id: string) { localStorage.setItem('complexId', id); },
  clear() { ['accessToken', 'refreshToken', 'complexId'].forEach((k) => localStorage.removeItem(k)); },
};
export const session = store;

/** Horario de servicio: fuera de él la API está apagada (ver SERVICE_HOURS en infra/lib/residencial-stack.ts). */
export const SERVICE_HOURS = { start: 9, end: 18 };
export const OFFLINE_MESSAGE = `El sistema está fuera de horario. Disponible de ${SERVICE_HOURS.start}:00 a.m. a ${SERVICE_HOURS.end - 12}:00 p.m. (hora de El Salvador).`;
/** El ALB responde 502/503/504 cuando no hay tareas de la API encendidas. */
const isOffline = (status: number) => status >= 502 && status <= 504;

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string[]>) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!store.refresh) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: store.refresh }),
  })
    .then(async (r) => {
      // Fuera de horario no se cierra la sesión: el token sigue sirviendo al volver
      if (isOffline(r.status)) throw new ApiError(r.status, OFFLINE_MESSAGE);
      if (!r.ok) return false;
      store.setTokens(await r.json());
      return true;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}, retry = true): Promise<T> {
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString()
    : '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (store.access) headers.Authorization = `Bearer ${store.access}`;
  if (store.complex) headers['X-Complex-Id'] = store.complex;

  const res = await fetch(`${BASE}${path}${qs}`, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return api<T>(path, opts, false);
    store.clear();
    window.location.assign('/login');
  }
  if (isOffline(res.status)) throw new ApiError(res.status, OFFLINE_MESSAGE);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join(', ') : 'Error inesperado';
    throw new ApiError(res.status, msg, body.errors);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const get = <T,>(path: string, query?: Record<string, unknown>) => api<T>(path, { query });
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
