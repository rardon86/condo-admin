import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { get, patch } from '../lib/api';
import { dateLabel } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, PageHeader, Select, Table, Tone } from '../components/ui';
import type { Unit } from './Movements';

interface Resident { userId: string; fullName: string; email: string; phone: string | null; status: string; unitId: string | null; unitCode: string | null; since: string }
const STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendiente', tone: 'amber' },
  ACTIVE: { label: 'Aprobado', tone: 'green' },
  REJECTED: { label: 'Rechazado', tone: 'red' },
};

/** Aprobación de propietarios que se registran y asignación de su unidad. */
export function ResidentsPage() {
  const qc = useQueryClient();
  const [units, setUnits] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['residents'], queryFn: () => get<Resident[]>('/complexes/current/residents') });
  const unitsQ = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });
  const update = useMutation({
    mutationFn: ({ userId, ...b }: { userId: string; status?: string; unitId?: string | null }) => patch(`/complexes/current/residents/${userId}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['residents'] }),
  });
  const pending = list.data?.filter((r) => r.status === 'PENDING').length ?? 0;
  const unitOf = (r: Resident) => units[r.userId] ?? r.unitId ?? '';

  return (
    <div className="space-y-6">
      <PageHeader title="Propietarios" subtitle="Aprueba las solicitudes de registro y asigna la unidad de cada propietario" />
      {pending > 0 && <Alert tone="amber">{pending} solicitud(es) esperando aprobación.</Alert>}
      <Card>
        <Table rows={list.data ?? []} rowKey={(r) => r.userId} empty="Aún no hay propietarios registrados. Comparte el enlace de registro de la aplicación."
          columns={[
            { header: 'Propietario', cell: (r) => <><div className="font-medium">{r.fullName}</div><div className="text-xs text-slate-500">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div></> },
            { header: 'Solicitado', cell: (r) => <span className="whitespace-nowrap text-slate-500">{dateLabel(r.since.slice(0, 10))}</span> },
            { header: 'Unidad', cell: (r) => (
              <Select value={unitOf(r)} onChange={(e) => {
                setUnits({ ...units, [r.userId]: e.target.value });
                if (r.status === 'ACTIVE') update.mutate({ userId: r.userId, unitId: e.target.value || null });
              }}>
                <option value="">— Sin unidad —</option>
                {unitsQ.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </Select>
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
    </div>
  );
}
