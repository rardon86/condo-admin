import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Plus } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { dateLabel, firstOfMonth, METHODS, money, num, today } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table } from '../components/ui';
import type { Unit } from './Movements';

interface Service { id: string; name: string; description: string | null; category: string | null; unitLabel: string; unitCost: string; unitPrice: string; active: boolean }
interface ServiceRecord { id: string; date: string; serviceName: string; unitCode: string | null; providedBy: string | null; quantity: string; totalCost: string; totalPrice: string; incomeMovementId: string | null; costMovementId: string | null; voidedAt: string | null }
interface Summary { items: { serviceId: string; name: string; count: number; quantity: number; revenue: number; cost: number; margin: number; marginPct: number | null }[]; totals: { revenue: number; cost: number; margin: number } }

export function ServicesPage() {
  const { complex } = useAuth();
  const canWrite = can(complex?.role, 'finWrite');
  const qc = useQueryClient();
  const [range, setRange] = useState({ from: firstOfMonth(), to: today() });
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [recording, setRecording] = useState(false);

  const catalog = useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services') });
  const records = useQuery({ queryKey: ['service-records', range], queryFn: () => get<ServiceRecord[]>('/service-records', range) });
  const summary = useQuery({ queryKey: ['service-summary', range], queryFn: () => get<Summary>('/service-records/summary', range) });
  const unitsQ = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });

  const saveService = useMutation({
    mutationFn: (b: Record<string, unknown>) => (editing && editing !== 'new' ? patch(`/services/${editing.id}`, b) : post('/services', b)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); setEditing(null); },
  });
  const record = useMutation({
    mutationFn: (b: unknown) => post('/service-records', b),
    onSuccess: () => { qc.invalidateQueries(); setRecording(false); },
  });
  const voidRec = useMutation({
    mutationFn: (id: string) => post(`/service-records/${id}/void`, { reason: 'Anulado desde servicios' }),
    onSuccess: () => qc.invalidateQueries(),
  });

  function submitService(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    saveService.mutate({ ...f, unitCost: Number(f.unitCost), unitPrice: Number(f.unitPrice), category: f.category || null, active: f.active === 'true' });
  }
  function submitRecord(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    record.mutate({
      serviceId: f.serviceId, date: f.date, quantity: Number(f.quantity), unitId: f.unitId || null, providedBy: f.providedBy || null,
      unitCost: f.unitCost ? Number(f.unitCost) : undefined, unitPrice: f.unitPrice ? Number(f.unitPrice) : undefined,
      notes: f.notes || null, method: f.method, registerIncome: f.registerIncome === 'on', registerCost: f.registerCost === 'on',
    });
  }

  const svc = editing && editing !== 'new' ? editing : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Servicios del complejo"
        subtitle="Catálogo con costos y precios, registro de servicios brindados y su rentabilidad"
        actions={canWrite && (
          <>
            <Button variant="secondary" onClick={() => setEditing('new')}><Plus className="size-4" />Nuevo servicio</Button>
            <Button onClick={() => setRecording(true)} disabled={!catalog.data?.length}><Plus className="size-4" />Registrar servicio brindado</Button>
          </>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><div className="text-sm text-slate-500">Ingresos por servicios</div><div className="mt-1 text-2xl font-bold text-emerald-700">{money(summary.data?.totals.revenue)}</div></Card>
        <Card><div className="text-sm text-slate-500">Costo de servicios</div><div className="mt-1 text-2xl font-bold text-red-700">{money(summary.data?.totals.cost)}</div></Card>
        <Card><div className="text-sm text-slate-500">Margen</div><div className="mt-1 text-2xl font-bold">{money(summary.data?.totals.margin)}</div></Card>
      </div>

      <Card title="Catálogo">
        <Table rows={catalog.data ?? []} rowKey={(r) => r.id} empty="Aún no hay servicios. Ej.: alquiler de salón, limpieza de cisterna, acceso a piscina."
          columns={[
            { header: 'Servicio', cell: (r) => <><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.category}</div></> },
            { header: 'Unidad', cell: (r) => r.unitLabel },
            { header: 'Costo', align: 'right', cell: (r) => money(r.unitCost) },
            { header: 'Precio', align: 'right', cell: (r) => money(r.unitPrice) },
            { header: 'Margen', align: 'right', cell: (r) => money(Number(r.unitPrice) - Number(r.unitCost)) },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activo' : 'Inactivo'}</Badge> },
            { header: '', cell: (r) => canWrite && <button onClick={() => setEditing(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
          ]} />
      </Card>

      <Card title="Servicios brindados" actions={
        <div className="flex gap-2">
          <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
      }>
        <Table rows={records.data ?? []} rowKey={(r) => r.id}
          columns={[
            { header: 'Fecha', cell: (r) => dateLabel(r.date) },
            { header: 'Servicio', cell: (r) => <span className={r.voidedAt ? 'line-through text-slate-400' : ''}>{r.serviceName}</span> },
            { header: 'Unidad', cell: (r) => r.unitCode ?? '—' },
            { header: 'Brindado por', cell: (r) => r.providedBy ?? '—' },
            { header: 'Cant.', align: 'right', cell: (r) => num(Number(r.quantity), 2) },
            { header: 'Costo', align: 'right', cell: (r) => money(r.totalCost) },
            { header: 'Precio', align: 'right', cell: (r) => money(r.totalPrice) },
            { header: 'Contabilidad', cell: (r) => r.voidedAt ? <Badge tone="red">Anulado</Badge> : (
              <span className="flex gap-1">{r.incomeMovementId && <Badge tone="green">Ingreso</Badge>}{r.costMovementId && <Badge tone="amber">Costo</Badge>}</span>
            ) },
            { header: '', cell: (r) => canWrite && !r.voidedAt && <button title="Anular" onClick={() => confirm('¿Anular este servicio y sus asientos?') && voidRec.mutate(r.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Ban className="size-4" /></button> },
          ]} />
      </Card>

      {summary.data && summary.data.items.length > 0 && (
        <Card title="Rentabilidad por servicio">
          <Table rows={summary.data.items} rowKey={(r) => r.serviceId}
            columns={[
              { header: 'Servicio', cell: (r) => r.name },
              { header: 'Veces', align: 'right', cell: (r) => r.count },
              { header: 'Ingreso', align: 'right', cell: (r) => money(r.revenue) },
              { header: 'Costo', align: 'right', cell: (r) => money(r.cost) },
              { header: 'Margen', align: 'right', cell: (r) => `${money(r.margin)}${r.marginPct !== null ? ` (${num(r.marginPct)}%)` : ''}` },
            ]} />
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={svc ? 'Editar servicio' : 'Nuevo servicio'}>
        <form key={svc?.id ?? 'new'} onSubmit={submitService} className="space-y-4">
          <Field label="Nombre"><Input name="name" defaultValue={svc?.name} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoría"><Input name="category" defaultValue={svc?.category ?? ''} placeholder="Amenidades, Mantenimiento…" /></Field>
            <Field label="Se cobra por"><Input name="unitLabel" defaultValue={svc?.unitLabel ?? 'servicio'} required /></Field>
            <Field label="Costo unitario" hint="Lo que le cuesta al complejo"><Input name="unitCost" type="number" step="0.01" min="0" defaultValue={svc?.unitCost ?? '0'} required /></Field>
            <Field label="Precio unitario" hint="Lo que se cobra (0 si es gratuito)"><Input name="unitPrice" type="number" step="0.01" min="0" defaultValue={svc?.unitPrice ?? '0'} required /></Field>
          </div>
          <Field label="Descripción"><Input name="description" defaultValue={svc?.description ?? ''} /></Field>
          <Field label="Estado"><Select name="active" defaultValue={String(svc?.active ?? true)}><option value="true">Activo</option><option value="false">Inactivo</option></Select></Field>
          <ErrorText error={saveService.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={saveService.isPending}>Guardar</Button></div>
        </form>
      </Modal>

      <Modal open={recording} onClose={() => setRecording(false)} title="Registrar servicio brindado">
        <form onSubmit={submitRecord} className="space-y-4">
          <Field label="Servicio">
            <Select name="serviceId" required>
              {catalog.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} — costo {money(s.unitCost)} / precio {money(s.unitPrice)}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha"><Input name="date" type="date" defaultValue={today()} required /></Field>
            <Field label="Cantidad"><Input name="quantity" type="number" step="0.01" min="0.01" defaultValue="1" required /></Field>
            <Field label="Costo unitario" hint="Vacío = el del catálogo"><Input name="unitCost" type="number" step="0.01" min="0" /></Field>
            <Field label="Precio unitario" hint="Vacío = el del catálogo"><Input name="unitPrice" type="number" step="0.01" min="0" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unidad (opcional)">
              <Select name="unitId" defaultValue=""><option value="">—</option>{unitsQ.data?.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</Select>
            </Field>
            <Field label="Brindado por"><Input name="providedBy" placeholder="Empleado o proveedor" /></Field>
          </div>
          <Field label="Método de pago"><Select name="method" defaultValue="CASH">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="registerIncome" defaultChecked /> Registrar el cobro como ingreso (Servicios brindados)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="registerCost" /> Registrar el costo como egreso (Costo de servicios)</label>
          </div>
          <Field label="Notas"><Input name="notes" /></Field>
          <ErrorText error={record.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setRecording(false)}>Cancelar</Button><Button loading={record.isPending}>Registrar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
