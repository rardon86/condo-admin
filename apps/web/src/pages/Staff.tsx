import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { dateTime, firstOfMonth, money, num, today } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table } from '../components/ui';

interface Employee { id: string; fullName: string; documentId: string | null; position: string | null; phone: string | null; hourlyRate: string; userId: string | null; active: boolean }
interface Member { userId: string; fullName: string; email: string; role: string }
interface Report {
  employees: { employeeId: string; fullName: string; position: string | null; hourlyRate: number; totalHours: number; laborCost: number; flaggedCount: number; shifts: { in: string; out: string | null; hours: number; flags: string[] }[] }[];
  totals: { hours: number; laborCost: number };
}
interface Entry { id: string; employeeName: string; type: 'IN' | 'OUT'; serverTime: string; latitude: number | null; longitude: number | null; accuracyMeters: number | null; distanceMeters: number | null; withinGeofence: boolean | null; geofenceName: string | null; manual: boolean; notes: string | null }

/** Empleados, reporte de horas trabajadas y bitácora de marcaciones con ubicación. */
export function StaffPage() {
  const { complex } = useAuth();
  const canManage = can(complex?.role, 'manage');
  const qc = useQueryClient();
  const [range, setRange] = useState({ from: firstOfMonth(), to: today() });
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [detail, setDetail] = useState<Report['employees'][number] | null>(null);

  const emps = useQuery({ queryKey: ['employees'], queryFn: () => get<Employee[]>('/employees') });
  const members = useQuery({ queryKey: ['members'], queryFn: () => get<Member[]>('/complexes/current/members'), enabled: canManage });
  const report = useQuery({ queryKey: ['hours', range], queryFn: () => get<Report>('/attendance/report', range) });
  const entries = useQuery({ queryKey: ['entries', range], queryFn: () => get<Entry[]>('/attendance/entries', range) });

  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/employees/${editing.id}`, b) : post('/employees', b)),
    onSuccess: () => { qc.invalidateQueries(); setEditing(null); },
  });
  const e = editing && editing !== 'new' ? editing : null;

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = formData(ev);
    save.mutate({
      fullName: f.fullName, position: f.position || null, documentId: f.documentId || null, phone: f.phone || null,
      hourlyRate: Number(f.hourlyRate || 0), userId: f.userId || null, active: f.active === 'true',
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Empleados y horas" subtitle="Personal, horas trabajadas según marcación y costo de mano de obra"
        actions={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" />Nuevo empleado</Button>} />

      <Card title="Empleados">
        <Table rows={emps.data ?? []} rowKey={(r) => r.id}
          columns={[
            { header: 'Nombre', cell: (r) => <><div className="font-medium">{r.fullName}</div><div className="text-xs text-slate-500">{r.position}</div></> },
            { header: 'Documento', cell: (r) => r.documentId ?? '—' },
            { header: 'Tarifa/hora', align: 'right', cell: (r) => money(r.hourlyRate) },
            { header: 'Usuario para marcar', cell: (r) => (r.userId ? <Badge tone="green">Vinculado</Badge> : <Badge tone="amber">Sin usuario</Badge>) },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activo' : 'Inactivo'}</Badge> },
            { header: '', cell: (r) => canManage && <button onClick={() => setEditing(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
          ]} />
      </Card>

      <Card title={`Horas trabajadas · ${num(report.data?.totals.hours ?? 0, 2)} h · ${money(report.data?.totals.laborCost)}`} actions={
        <div className="flex gap-2">
          <Input type="date" value={range.from} onChange={(ev) => setRange({ ...range, from: ev.target.value })} />
          <Input type="date" value={range.to} onChange={(ev) => setRange({ ...range, to: ev.target.value })} />
        </div>
      }>
        <Table rows={report.data?.employees ?? []} rowKey={(r) => r.employeeId} empty="Sin marcaciones en el periodo"
          columns={[
            { header: 'Empleado', cell: (r) => r.fullName },
            { header: 'Turnos', align: 'right', cell: (r) => r.shifts.length },
            { header: 'Horas', align: 'right', cell: (r) => num(r.totalHours, 2) },
            { header: 'Costo', align: 'right', cell: (r) => money(r.laborCost) },
            { header: 'Observaciones', cell: (r) => (r.flaggedCount ? <Badge tone="amber">{r.flaggedCount} por revisar</Badge> : <Badge tone="green">OK</Badge>) },
            { header: '', cell: (r) => <Button variant="ghost" onClick={() => setDetail(r)}>Ver turnos</Button> },
          ]} />
      </Card>

      <Card title="Bitácora de marcaciones">
        <Table rows={[...(entries.data ?? [])].reverse()} rowKey={(r) => r.id} empty="Sin marcaciones"
          columns={[
            { header: 'Fecha y hora', cell: (r) => <span className="whitespace-nowrap">{dateTime(r.serverTime)}</span> },
            { header: 'Empleado', cell: (r) => r.employeeName },
            { header: 'Tipo', cell: (r) => <Badge tone={r.type === 'IN' ? 'green' : 'slate'}>{r.type === 'IN' ? 'Entrada' : 'Salida'}</Badge> },
            { header: 'Zona', cell: (r) => r.geofenceName ? <span className={r.withinGeofence ? '' : 'text-amber-700'}>{r.geofenceName} · {r.distanceMeters} m</span> : '—' },
            { header: 'Precisión', align: 'right', cell: (r) => (r.accuracyMeters ? `±${Math.round(r.accuracyMeters)} m` : '—') },
            { header: 'Mapa', cell: (r) => r.latitude !== null && (
              <a className="inline-flex items-center gap-1 text-brand-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}><MapPin className="size-3.5" />Ver</a>
            ) },
            { header: 'Notas', cell: (r) => <span className="text-xs text-slate-500">{[r.manual && 'Manual', r.notes].filter(Boolean).join(' · ')}</span> },
          ]} />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Turnos · ${detail?.fullName ?? ''}`} wide>
        <Table rows={detail?.shifts ?? []} rowKey={(s) => s.in}
          columns={[
            { header: 'Entrada', cell: (s) => dateTime(s.in) },
            { header: 'Salida', cell: (s) => (s.out ? dateTime(s.out) : '—') },
            { header: 'Horas', align: 'right', cell: (s) => num(s.hours, 2) },
            { header: 'Observaciones', cell: (s) => s.flags.map((f) => <span key={f} className="mr-1"><Badge tone="amber">{f}</Badge></span>) },
          ]} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={e ? 'Editar empleado' : 'Nuevo empleado'}>
        <form key={e?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <Field label="Nombre completo"><Input name="fullName" defaultValue={e?.fullName} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cargo"><Input name="position" defaultValue={e?.position ?? ''} placeholder="Vigilante, jardinero…" /></Field>
            <Field label="DUI / documento"><Input name="documentId" defaultValue={e?.documentId ?? ''} /></Field>
            <Field label="Teléfono"><Input name="phone" defaultValue={e?.phone ?? ''} /></Field>
            <Field label="Tarifa por hora (USD)"><Input name="hourlyRate" type="number" step="0.01" min="0" defaultValue={e?.hourlyRate ?? '0'} /></Field>
          </div>
          <Field label="Usuario con el que marca" hint="Crea el usuario del empleado en Ajustes → Usuarios (rol Personal)">
            <Select name="userId" defaultValue={e?.userId ?? ''}>
              <option value="">— Sin usuario —</option>
              {members.data?.map((m) => <option key={m.userId} value={m.userId}>{m.fullName} · {m.email}</option>)}
            </Select>
          </Field>
          <Field label="Estado"><Select name="active" defaultValue={String(e?.active ?? true)}><option value="true">Activo</option><option value="false">Inactivo</option></Select></Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
