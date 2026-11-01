import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, LogIn, LogOut, MapPin, TriangleAlert } from 'lucide-react';
import { get, post } from '../lib/api';
import { dateTime } from '../lib/format';
import { Alert, Badge, Card, ErrorText, PageHeader, Spinner, cx } from '../components/ui';

interface Entry { id: string; type: 'IN' | 'OUT'; serverTime: string; withinGeofence: boolean | null; distanceMeters: number | null; accuracyMeters: number | null }
interface Me { employee: { id: string; fullName: string; position: string | null } | null; last: Entry | null; recent: Entry[] }
interface ClockResult extends Entry { geofenceName: string | null; flags: string[] }

/** Obtiene la ubicación con alta precisión; falla si el usuario la niega o no hay GPS. */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este dispositivo no permite obtener la ubicación'));
    navigator.geolocation.getCurrentPosition(resolve, (e) => {
      reject(new Error(e.code === e.PERMISSION_DENIED ? 'Debes permitir el acceso a tu ubicación para marcar' : 'No se pudo obtener la ubicación. Intenta al aire libre.'));
    }, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  });
}

/** Control de marcación (entrada / salida) con captura de ubicación GPS. Optimizado para celular. */
export function AttendancePage() {
  const qc = useQueryClient();
  const [locating, setLocating] = useState(false);
  const [result, setResult] = useState<ClockResult | null>(null);
  const me = useQuery({ queryKey: ['attendance-me'], queryFn: () => get<Me>('/attendance/me') });

  const clock = useMutation({
    mutationFn: async (type: 'IN' | 'OUT') => {
      setLocating(true);
      try {
        const pos = await getPosition();
        return await post<ClockResult>('/attendance/clock', {
          type,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          deviceTime: new Date().toISOString(),
        });
      } finally {
        setLocating(false);
      }
    },
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['attendance-me'] }); },
  });

  if (me.isLoading) return <Spinner />;
  const emp = me.data?.employee;
  const isIn = me.data?.last?.type === 'IN';
  const next: 'IN' | 'OUT' = isIn ? 'OUT' : 'IN';

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader title="Marcación" subtitle="Registra tu entrada y salida. Se captura tu ubicación al momento de marcar." />
      {!emp ? (
        <Alert tone="amber" icon={<TriangleAlert />}>Tu usuario no está vinculado a un empleado. Pide al administrador que te vincule en “Empleados y horas”.</Alert>
      ) : (
        <>
          <Card>
            <div className="text-center">
              <div className="text-sm text-slate-500">{emp.fullName}{emp.position ? ` · ${emp.position}` : ''}</div>
              <div className="mt-2 flex items-center justify-center gap-2">
                <span className={cx('size-2.5 rounded-full', isIn ? 'bg-emerald-500' : 'bg-slate-300')} />
                <span className="font-medium">{isIn ? 'En turno' : 'Fuera de turno'}</span>
              </div>
              {me.data?.last && <div className="mt-1 text-xs text-slate-500">Última marcación: {dateTime(me.data.last.serverTime)}</div>}
              <button
                onClick={() => { setResult(null); clock.mutate(next); }}
                disabled={clock.isPending}
                className={cx(
                  'mx-auto mt-6 flex size-44 flex-col items-center justify-center gap-2 rounded-full text-lg font-semibold text-white shadow-lg transition active:scale-95 disabled:opacity-60',
                  next === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700',
                )}
              >
                {next === 'IN' ? <LogIn className="size-8" /> : <LogOut className="size-8" />}
                {locating ? 'Ubicando…' : clock.isPending ? 'Enviando…' : next === 'IN' ? 'Marcar entrada' : 'Marcar salida'}
              </button>
              <p className="mt-4 flex items-center justify-center gap-1 text-xs text-slate-500"><MapPin className="size-3.5" />Se usará la ubicación GPS de este dispositivo</p>
            </div>
          </Card>

          <ErrorText error={clock.error} />
          {result && (
            <Alert tone={result.withinGeofence === false || result.flags.length ? 'amber' : 'green'} icon={<CheckCircle2 />}>
              <strong>{result.type === 'IN' ? 'Entrada' : 'Salida'} registrada</strong> a las {dateTime(result.serverTime)}.
              {result.geofenceName && <> {result.withinGeofence ? 'Dentro de' : 'Fuera de'} “{result.geofenceName}” ({result.distanceMeters} m).</>}
              {result.flags.length > 0 && <div className="mt-1 text-xs">Observaciones: {result.flags.join(', ')}</div>}
            </Alert>
          )}

          <Card title="Mis últimas marcaciones">
            <ul className="divide-y divide-slate-100">
              {me.data?.recent.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Clock className="size-4 text-slate-400" />
                  <span className="flex-1">{dateTime(r.serverTime)}</span>
                  <Badge tone={r.type === 'IN' ? 'green' : 'slate'}>{r.type === 'IN' ? 'Entrada' : 'Salida'}</Badge>
                  {r.withinGeofence === false && <Badge tone="amber">Fuera de zona</Badge>}
                </li>
              ))}
              {!me.data?.recent.length && <li className="py-4 text-center text-sm text-slate-500">Sin marcaciones</li>}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
