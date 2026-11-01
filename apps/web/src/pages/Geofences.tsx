import { FormEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crosshair, MapPin, Plus, Trash2 } from 'lucide-react';
import { del, get, post } from '../lib/api';
import { Alert, Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Table } from '../components/ui';

interface Fence { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; active: boolean }

/** Zonas (geocercas) donde es válido marcar asistencia. */
export function GeofencesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const lat = useRef<HTMLInputElement>(null);
  const lng = useRef<HTMLInputElement>(null);
  const { data = [] } = useQuery({ queryKey: ['geofences'], queryFn: () => get<Fence[]>('/geofences') });
  const create = useMutation({ mutationFn: (b: unknown) => post('/geofences', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofences'] }); setOpen(false); } });
  const remove = useMutation({ mutationFn: (id: string) => del(`/geofences/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['geofences'] }) });

  function fillMyLocation() {
    setLocError(null);
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        if (lat.current) lat.current.value = p.coords.latitude.toFixed(6);
        if (lng.current) lng.current.value = p.coords.longitude.toFixed(6);
      },
      () => setLocError('No se pudo obtener la ubicación'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    create.mutate({ name: f.name, latitude: Number(f.latitude), longitude: Number(f.longitude), radiusMeters: Number(f.radiusMeters) });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Zonas de marcación" subtitle="Define los puntos (portería, casa club, etc.) y el radio dentro del cual el personal puede marcar"
        actions={<Button onClick={() => setOpen(true)}><Plus className="size-4" />Nueva zona</Button>} />
      <Alert>Si en Ajustes activas “Exigir geocerca”, las marcaciones fuera de zona se rechazan. Si no, se aceptan pero quedan señaladas para revisión.</Alert>
      <Card>
        <Table rows={data} rowKey={(r) => r.id} empty="Sin zonas definidas"
          columns={[
            { header: 'Nombre', cell: (r) => <strong>{r.name}</strong> },
            { header: 'Coordenadas', cell: (r) => (
              <a className="inline-flex items-center gap-1 text-link" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}>
                <MapPin className="size-3.5" />{r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
              </a>
            ) },
            { header: 'Radio', align: 'right', cell: (r) => `${r.radiusMeters} m` },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activa' : 'Inactiva'}</Badge> },
            { header: '', cell: (r) => r.active && <button title="Desactivar" onClick={() => remove.mutate(r.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button> },
          ]} />
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva zona de marcación">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nombre"><Input name="name" required placeholder="Portería principal" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitud"><Input ref={lat} name="latitude" type="number" step="any" required /></Field>
            <Field label="Longitud"><Input ref={lng} name="longitude" type="number" step="any" required /></Field>
          </div>
          <Button type="button" variant="secondary" onClick={fillMyLocation}><Crosshair className="size-4" />Usar mi ubicación actual</Button>
          {locError && <p className="text-xs text-red-600">{locError}</p>}
          <Field label="Radio (metros)" hint="Recomendado 50–150 m según el tamaño del área"><Input name="radiusMeters" type="number" min={10} max={5000} defaultValue={100} required /></Field>
          <ErrorText error={create.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={create.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
