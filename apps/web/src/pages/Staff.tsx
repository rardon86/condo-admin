import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { get } from '../lib/api';
import { dateTime, firstOfMonth, money, num, today } from '../lib/format';
import { Alert, Badge, Button, Card, Input, Modal, PageHeader, Select, Table } from '../components/ui';
import { ExcelButton } from '../components/ExcelButton';
import { downloadXlsx } from '../lib/xlsx';

interface Employee { id: string; fullName: string; documentId: string | null; position: string | null; phone: string | null; hourlyRate: string; userId: string | null; active: boolean }
interface Report {
  employees: { employeeId: string; fullName: string; position: string | null; hourlyRate: number; totalHours: number; laborCost: number; flaggedCount: number; shifts: { in: string; out: string | null; hours: number; flags: string[] }[] }[];
  totals: { hours: number; laborCost: number };
}
interface Entry {
  id: string; employeeId: string; employeeName: string; type: 'IN' | 'OUT'; serverTime: string; deviceTime: string | null; latitude: number | null; longitude: number | null;
  accuracyMeters: number | null; distanceMeters: number | null; withinGeofence: boolean | null; geofenceName: string | null; manual: boolean; notes: string | null;
  ip: string | null; userAgent: string | null; recordedByName: string | null;
}

/** Desfase entre el reloj del dispositivo y el servidor, en minutos (null si no hay dato). */
const skewMin = (e: Entry) => (e.deviceTime ? Math.round((new Date(e.deviceTime).getTime() - new Date(e.serverTime).getTime()) / 60_000) : null);
const device = (ua: string | null) => !ua ? '—' : /iphone|ipad/i.test(ua) ? 'iPhone/iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : 'Otro';

/** Empleados, reporte de horas trabajadas y bitácora de marcaciones con ubicación. */
export function StaffPage() {
  const [range, setRange] = useState({ from: firstOfMonth(), to: today(), employeeId: '' });
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [detail, setDetail] = useState<Report['employees'][number] | null>(null);

  const emps = useQuery({ queryKey: ['employees'], queryFn: () => get<Employee[]>('/employees') });
  const report = useQuery({ queryKey: ['hours', range], queryFn: () => get<Report>('/attendance/report', range) });
  const entries = useQuery({ queryKey: ['entries', range], queryFn: () => get<Entry[]>('/attendance/entries', range) });

  return (
    <div className="space-y-6">
      <PageHeader title="Empleados y horas" subtitle="Personal, horas trabajadas según marcación y costo de mano de obra"
        actions={<ExcelButton disabled={!report.data} onClick={() => report.data && downloadXlsx(`Horas y marcaciones ${range.from} a ${range.to}`, [
          {
            name: 'Horas', title: [`Horas trabajadas del ${range.from} al ${range.to}`],
            header: ['Empleado', 'Cargo', 'Tarifa/hora', 'Turnos', 'Horas', 'Costo', 'Turnos por revisar'],
            rows: report.data.employees.map((e) => [e.fullName, e.position, e.hourlyRate, e.shifts.length, e.totalHours, e.laborCost, e.flaggedCount]),
            money: [2, 5],
            totals: ['Total', null, null, null, report.data.totals.hours, report.data.totals.laborCost, null],
          },
          {
            name: 'Turnos', header: ['Empleado', 'Entrada', 'Salida', 'Horas', 'Observaciones'],
            rows: report.data.employees.flatMap((e) => e.shifts.map((s) => [e.fullName, dateTime(s.in), s.out ? dateTime(s.out) : '', s.hours, s.flags.join(', ')])),
          },
          {
            name: 'Marcaciones', header: ['Fecha y hora', 'Empleado', 'Tipo', 'Zona', 'Distancia (m)', 'Dentro de zona', 'Precisión (m)', 'Desfase reloj (min)', 'Latitud', 'Longitud', 'IP', 'Dispositivo', 'Manual', 'Notas'],
            rows: (entries.data ?? []).map((r) => [
              dateTime(r.serverTime), r.employeeName, r.type === 'IN' ? 'Entrada' : 'Salida', r.geofenceName, r.distanceMeters,
              r.withinGeofence === null ? '' : r.withinGeofence ? 'Sí' : 'No', r.accuracyMeters === null ? null : Math.round(r.accuracyMeters), skewMin(r),
              r.latitude, r.longitude, r.ip, device(r.userAgent), r.manual ? `Sí${r.recordedByName ? ` (${r.recordedByName})` : ''}` : 'No', r.notes,
            ]),
          },
        ])} />}
      />
      <Alert>El alta de empleados y su asignación a proyectos la realiza el superusuario de la plataforma. Aquí ves el personal asignado a este proyecto, sus horas y su costo.</Alert>

      <Card title="Empleados">
        <Table rows={emps.data ?? []} rowKey={(r) => r.id}
          columns={[
            { header: 'Nombre', cell: (r) => <><div className="font-medium">{r.fullName}</div><div className="text-xs text-slate-500">{r.position}</div></> },
            { header: 'Documento', cell: (r) => r.documentId ?? '—' },
            { header: 'Tarifa/hora', align: 'right', cell: (r) => money(r.hourlyRate) },
            { header: 'Usuario para marcar', cell: (r) => (r.userId ? <Badge tone="green">Vinculado</Badge> : <Badge tone="amber">Sin usuario</Badge>) },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activo' : 'Inactivo'}</Badge> },
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

      <Card title="Bitácora de marcaciones (detalle completo)" actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range.employeeId} onChange={(ev) => setRange({ ...range, employeeId: ev.target.value })}>
            <option value="">Todos los empleados</option>
            {emps.data?.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyFlagged} onChange={(ev) => setOnlyFlagged(ev.target.checked)} />Solo con observaciones</label>
        </div>
      }>
        <Table rows={[...(entries.data ?? [])].reverse().filter((r) => !onlyFlagged || r.withinGeofence === false || r.manual || !!r.notes)} rowKey={(r) => r.id} empty="Sin marcaciones"
          columns={[
            { header: 'Fecha y hora', cell: (r) => <span className="whitespace-nowrap">{dateTime(r.serverTime)}</span> },
            { header: 'Empleado', cell: (r) => r.employeeName },
            { header: 'Tipo', cell: (r) => <Badge tone={r.type === 'IN' ? 'green' : 'slate'}>{r.type === 'IN' ? 'Entrada' : 'Salida'}</Badge> },
            { header: 'Zona', cell: (r) => r.geofenceName ? (
              <span className="whitespace-nowrap">{r.geofenceName} · {r.distanceMeters} m {r.withinGeofence ? <Badge tone="green">Dentro</Badge> : <Badge tone="amber">Fuera de zona</Badge>}</span>
            ) : '—' },
            { header: 'Precisión', align: 'right', cell: (r) => (r.accuracyMeters ? `±${Math.round(r.accuracyMeters)} m` : '—') },
            { header: 'Mapa', cell: (r) => r.latitude !== null && (
              <a className="inline-flex items-center gap-1 text-link" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}><MapPin className="size-3.5" />Ver</a>
            ) },
            { header: 'Hora del dispositivo', cell: (r) => { const k = skewMin(r); return k === null ? '—' : <span className={Math.abs(k) > 5 ? 'text-amber-700' : 'text-slate-500'}>{k === 0 ? 'Sin desfase' : `${k > 0 ? '+' : ''}${k} min`}</span>; } },
            { header: 'Dispositivo / IP', cell: (r) => <span className="text-xs text-slate-500" title={r.userAgent ?? ''}>{device(r.userAgent)}{r.ip ? ` · ${r.ip}` : ''}</span> },
            { header: 'Notas', cell: (r) => <span className="text-xs text-slate-500">{[r.manual && `Manual${r.recordedByName ? ` por ${r.recordedByName}` : ''}`, r.notes].filter(Boolean).join(' · ')}</span> },
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

    </div>
  );
}
