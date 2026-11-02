import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { dateLabel } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table, Tone } from '../components/ui';
import type { Unit } from './Movements';
import { PropertySelect } from './Fees';

interface Resident { userId: string; fullName: string; email: string; phone: string | null; status: string; unitId: string | null; unitCode: string | null; unitAddress: string | null; since: string }
const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendiente', tone: 'amber' },
  ACTIVE: { label: 'Aprobado', tone: 'green' },
  REJECTED: { label: 'Rechazado', tone: 'red' },
};

/** Propietarios: alta por la administración, aprobación de solicitudes y asignación de su propiedad. */
export function ResidentsPage() {
  const qc = useQueryClient();
  const [units, setUnits] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['residents'], queryFn: () => get<Resident[]>('/complexes/current/residents') });
  const unitsQ = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });
  const update = useMutation({
    mutationFn: ({ userId, ...b }: { userId: string; status?: string; unitId?: string | null }) => patch(`/complexes/current/residents/${userId}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['residents'] }),
  });
  const create = useMutation({
    mutationFn: (b: unknown) => post('/complexes/current/members', b),
    onSuccess: () => { qc.invalidateQueries(); setAdding(false); },
  });
  const pending = list.data?.filter((r) => r.status === 'PENDING').length ?? 0;
  const unitOf = (r: Resident) => units[r.userId] ?? r.unitId ?? '';

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    create.mutate({ role: 'RESIDENT', fullName: f.fullName, email: f.email, phone: f.phone || null, unitId: f.unitId, temporaryPassword: f.temporaryPassword });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Propietarios" subtitle="Registra propietarios, aprueba solicitudes y asigna la propiedad de cada uno"
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" />Agregar propietario</Button>} />
      {pending > 0 && <Alert tone="amber">{pending} solicitud(es) esperando aprobación.</Alert>}
      <Card>
        <Table rows={list.data ?? []} rowKey={(r) => r.userId} empty="Aún no hay propietarios. Agrégalos aquí o comparte el enlace de registro de la aplicación."
          columns={[
            { header: 'Propietario', cell: (r) => <><div className="font-medium">{r.fullName}</div><div className="text-xs text-slate-500">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div></> },
            { header: 'Desde', cell: (r) => <span className="whitespace-nowrap text-slate-500">{dateLabel(r.since.slice(0, 10))}</span> },
            { header: 'Propiedad', cell: (r) => (
              <div className="min-w-40">
                <Select value={unitOf(r)} onChange={(e) => {
                  setUnits({ ...units, [r.userId]: e.target.value });
                  if (r.status === 'ACTIVE') update.mutate({ userId: r.userId, unitId: e.target.value || null });
                }}>
                  <option value="">— Sin propiedad —</option>
                  {unitsQ.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </Select>
                {r.unitAddress && <div className="mt-1 truncate text-xs text-slate-500" title={r.unitAddress}>{r.unitAddress}</div>}
              </div>
            ) },
            { header: 'Estado', cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
            { header: '', cell: (r) => (
              <div className="flex justify-end gap-1">
                {r.status !== 'ACTIVE' && (
                  <Button variant="secondary" onClick={() => update.mutate({ userId: r.userId, status: 'ACTIVE', unitId: unitOf(r) || null })}><Check className="size-4" />Aprobar</Button>
                )}
                {r.status !== 'REJECTED' && (
                  <Button variant="ghost" onClick={() => confirm(`¿${r.status === 'ACTIVE' ? 'Quitar el acceso' : 'Rechazar la solicitud'} de ${r.fullName}?`) && update.mutate({ userId: r.userId, status: 'REJECTED' })}><X className="size-4" /></Button>
                )}
              </div>
            ) },
          ]} />
        <ErrorText error={update.error} />
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Agregar propietario">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nombre completo"><Input name="fullName" required minLength={2} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Correo"><Input name="email" type="email" required /></Field>
            <Field label="Teléfono"><Input name="phone" /></Field>
          </div>
          <Field label="Propiedad"><PropertySelect units={unitsQ.data} name="unitId" required /></Field>
          <Field label="Contraseña temporal" hint="Con ella entra al portal; puede cambiarla en Mi cuenta. Si el correo ya existe, solo se le da acceso."><Input name="temporaryPassword" type="text" minLength={8} required /></Field>
          <ErrorText error={create.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancelar</Button><Button loading={create.isPending}>Agregar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
