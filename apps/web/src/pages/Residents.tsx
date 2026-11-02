import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { del, get, patch, post, put } from '../lib/api';
import { dateLabel } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Table, Tone } from '../components/ui';
import type { Unit } from './Movements';

interface Resident {
  userId: string; fullName: string; email: string | null; phone: string | null; username: string | null; status: string; since: string;
  properties: { id: string; code: string; address: string | null }[]; requestedUnit: string | null;
}
const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendiente', tone: 'amber' },
  ACTIVE: { label: 'Activo', tone: 'green' },
  REJECTED: { label: 'Desactivado', tone: 'slate' },
};

/**
 * Propietarios: alta por la administración (ingresan con su teléfono), aprobación de solicitudes y
 * asignación de una o varias propiedades a cada uno.
 */
export function ResidentsPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Resident | null>(null);
  const [removing, setRemoving] = useState<Resident | null>(null);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['residents'], queryFn: () => get<Resident[]>('/complexes/current/residents') });
  const done = () => { qc.invalidateQueries({ queryKey: ['residents'] }); qc.invalidateQueries({ queryKey: ['units'] }); };
  const setStatus = useMutation({ mutationFn: ({ userId, status }: { userId: string; status: string }) => patch(`/complexes/current/residents/${userId}`, { status }), onSuccess: done });
  const remove = useMutation({ mutationFn: (userId: string) => del(`/complexes/current/residents/${userId}`), onSuccess: () => { done(); setRemoving(null); } });
  const pending = list.data?.filter((r) => r.status === 'PENDING').length ?? 0;
  const rows = (list.data ?? []).filter((r) => !q || `${r.fullName} ${r.phone ?? ''} ${r.email ?? ''} ${r.properties.map((p) => p.code).join(' ')}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeader title="Propietarios" subtitle={`${list.data?.length ?? 0} propietarios · Cada uno ingresa al portal con su número de teléfono`}
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" />Agregar propietario</Button>} />
      {pending > 0 && <Alert tone="amber">{pending} solicitud(es) esperando aprobación. Revisa la propiedad que indicaron y apruébalas.</Alert>}
      <Card>
        <div className="mb-4 max-w-sm"><Input placeholder="Buscar por nombre, teléfono, correo o propiedad" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Table rows={rows} rowKey={(r) => r.userId} empty="Aún no hay propietarios. Agrégalos aquí o comparte el enlace de registro de la aplicación."
          columns={[
            { header: 'Propietario', cell: (r) => <><div className="font-medium">{r.fullName}</div><div className="text-xs text-slate-500">Desde {dateLabel(r.since.slice(0, 10))}</div></> },
            { header: 'Usuario (teléfono)', cell: (r) => <><div>{r.phone ?? r.username ?? '—'}</div>{r.email && <div className="text-xs text-slate-500">{r.email}</div>}</> },
            { header: 'Propiedades', cell: (r) => (
              <div className="flex flex-wrap gap-1">
                {r.properties.map((p) => <span key={p.id} title={p.address ?? ''}><Badge tone="blue">{p.code}</Badge></span>)}
                {!r.properties.length && (r.requestedUnit ? <span className="text-xs text-amber-700">Pidió {r.requestedUnit}</span> : <span className="text-xs text-slate-400">Sin propiedades</span>)}
              </div>
            ) },
            { header: 'Estado', cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
            { header: '', cell: (r) => (
              <div className="flex justify-end gap-1">
                {r.status === 'PENDING' && <Button variant="secondary" onClick={() => setStatus.mutate({ userId: r.userId, status: 'ACTIVE' })}><Check className="size-4" />Aprobar</Button>}
                <button title="Editar datos y propiedades" onClick={() => setEditing(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button>
                {r.status !== 'PENDING' && (
                  <button title={r.status === 'ACTIVE' ? 'Desactivar acceso' : 'Reactivar acceso'}
                    onClick={() => (r.status === 'REJECTED' || confirm(`¿Desactivar el acceso de ${r.fullName}? Conserva sus propiedades y su historia.`)) && setStatus.mutate({ userId: r.userId, status: r.status === 'ACTIVE' ? 'REJECTED' : 'ACTIVE' })}
                    className={`rounded p-1 hover:bg-slate-100 ${r.status === 'ACTIVE' ? 'text-slate-400' : 'text-emerald-600'}`}><Power className="size-4" /></button>
                )}
                <button title="Eliminar del proyecto" onClick={() => { remove.reset(); setRemoving(r); }} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
              </div>
            ) },
          ]} />
        <ErrorText error={setStatus.error} />
      </Card>

      {adding && <ResidentModal onClose={() => setAdding(false)} onDone={() => { done(); setAdding(false); }} />}
      {editing && <ResidentModal resident={editing} onClose={() => setEditing(null)} onDone={() => { done(); setEditing(null); }} />}

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={`Eliminar a ${removing?.fullName ?? ''}`}>
        <div className="space-y-4 text-sm text-slate-600">
          <p>Se desvincula de {removing?.properties.length ? removing.properties.map((p) => p.code).join(', ') : 'sus propiedades'} y pierde el acceso al portal de este proyecto.
            Sus pagos y consultas se conservan. Si no tiene acceso a otro proyecto, su cuenta queda desactivada.</p>
          <p>Para suspenderlo temporalmente usa mejor <strong>Desactivar</strong> (ícono de encendido).</p>
          <ErrorText error={remove.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.userId)}>Eliminar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Alta o edición de un propietario y de sus propiedades. */
function ResidentModal({ resident, onClose, onDone }: { resident?: Resident; onClose: () => void; onDone: () => void }) {
  const unitsQ = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });
  const [selected, setSelected] = useState<string[]>(resident?.properties.map((p) => p.id) ?? []);
  const [filter, setFilter] = useState('');
  const save = useMutation({
    mutationFn: async (f: Record<string, string>) => {
      if (!resident) {
        return post('/complexes/current/residents', { fullName: f.fullName, phone: f.phone, email: f.email || null, temporaryPassword: f.temporaryPassword, unitIds: selected });
      }
      await patch(`/complexes/current/residents/${resident.userId}`, { fullName: f.fullName, phone: f.phone, email: f.email || null });
      return put(`/complexes/current/residents/${resident.userId}/units`, { unitIds: selected });
    },
    onSuccess: onDone,
  });
  const units = (unitsQ.data ?? []).filter((u) => (u.active || selected.includes(u.id)) && (!filter || u.code.toLowerCase().includes(filter.toLowerCase())));

  return (
    <Modal open onClose={onClose} title={resident ? `Propietario · ${resident.fullName}` : 'Agregar propietario'} wide>
      <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); save.mutate(formData(e)); }} className="space-y-4">
        <Field label="Nombre completo"><Input name="fullName" defaultValue={resident?.fullName} required minLength={2} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Teléfono (usuario de ingreso)" hint="Con él entra al portal. Ej. 7123-4567">
            <Input name="phone" type="tel" defaultValue={resident?.phone ?? ''} required minLength={7} inputMode="tel" />
          </Field>
          <Field label="Correo (opcional)"><Input name="email" type="email" defaultValue={resident?.email ?? ''} /></Field>
        </div>
        {!resident && (
          <Field label="Contraseña temporal" hint="Mínimo 8 caracteres. Entrégasela por un medio privado; podrá cambiarla en Mi cuenta. Si ya tiene cuenta en otro proyecto, conserva la suya.">
            <Input name="temporaryPassword" type="text" minLength={8} required />
          </Field>
        )}
        <Field label={`Propiedades (${selected.length} seleccionadas)`} hint="Opcional: puedes asignarlas después. Una propiedad puede tener varios dueños.">
          <div className="space-y-2">
            <Input placeholder="Filtrar por código" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm sm:grid-cols-4">
              {units.map((u) => (
                <label key={u.id} className="flex items-center gap-2" title={u.ownerName ? `Dueño(s): ${u.ownerName}` : 'Sin propietario'}>
                  <input type="checkbox" checked={selected.includes(u.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} />
                  {u.code}{u.ownerName && !selected.includes(u.id) && <span className="size-1.5 rounded-full bg-slate-400" title="Ya tiene propietario" />}
                </label>
              ))}
              {!units.length && <span className="col-span-full text-slate-400">Sin propiedades. Créalas en Propiedades.</span>}
            </div>
          </div>
        </Field>
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending}>{resident ? 'Guardar' : 'Agregar'}</Button></div>
      </form>
    </Modal>
  );
}
