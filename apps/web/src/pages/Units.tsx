import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table } from '../components/ui';

interface Unit { id: string; code: string; type: string; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null; areaM2: string | null; monthlyFee: string; active: boolean }
const TYPES: Record<string, string> = { HOUSE: 'Casa', APARTMENT: 'Apartamento', LOT: 'Lote', COMMERCIAL: 'Local comercial', OTHER: 'Otro' };

export function UnitsPage() {
  const { complex } = useAuth();
  const canManage = can(complex?.role, 'manage');
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Unit | 'new' | null>(null);
  const { data = [] } = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });
  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/units/${editing.id}`, b) : post('/units', b)),
    onSuccess: () => { qc.invalidateQueries(); setEditing(null); },
  });
  const u = editing && editing !== 'new' ? editing : null;
  const expected = data.filter((x) => x.active).reduce((s, x) => s + Number(x.monthlyFee), 0);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    save.mutate({
      code: f.code, type: f.type, ownerName: f.ownerName || null, ownerEmail: f.ownerEmail || null, ownerPhone: f.ownerPhone || null,
      areaM2: f.areaM2 ? Number(f.areaM2) : null, monthlyFee: Number(f.monthlyFee || 0), active: f.active === 'true',
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Unidades" subtitle={`${data.length} unidades · Cuota mensual esperada ${money(expected)}`}
        actions={canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" />Nueva unidad</Button>} />
      <Card>
        <Table rows={data} rowKey={(r) => r.id} empty="Registra las casas, apartamentos o lotes del complejo con su cuota mensual."
          columns={[
            { header: 'Código', cell: (r) => <strong>{r.code}</strong> },
            { header: 'Tipo', cell: (r) => TYPES[r.type] ?? r.type },
            { header: 'Propietario', cell: (r) => <><div>{r.ownerName ?? '—'}</div><div className="text-xs text-slate-500">{[r.ownerEmail, r.ownerPhone].filter(Boolean).join(' · ')}</div></> },
            { header: 'Cuota', align: 'right', cell: (r) => money(r.monthlyFee) },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activa' : 'Inactiva'}</Badge> },
            { header: '', cell: (r) => canManage && <button onClick={() => setEditing(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
          ]} />
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={u ? `Unidad ${u.code}` : 'Nueva unidad'}>
        <form key={u?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Código"><Input name="code" defaultValue={u?.code} required placeholder="C-01" /></Field>
            <Field label="Tipo"><Select name="type" defaultValue={u?.type ?? 'HOUSE'}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Cuota mensual (USD)"><Input name="monthlyFee" type="number" step="0.01" min="0" defaultValue={u?.monthlyFee ?? '0'} /></Field>
            <Field label="Área (m²)"><Input name="areaM2" type="number" step="0.01" min="0" defaultValue={u?.areaM2 ?? ''} /></Field>
          </div>
          <Field label="Propietario"><Input name="ownerName" defaultValue={u?.ownerName ?? ''} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Correo"><Input name="ownerEmail" type="email" defaultValue={u?.ownerEmail ?? ''} /></Field>
            <Field label="Teléfono"><Input name="ownerPhone" defaultValue={u?.ownerPhone ?? ''} /></Field>
          </div>
          <Field label="Estado"><Select name="active" defaultValue={String(u?.active ?? true)}><option value="true">Activa</option><option value="false">Inactiva</option></Select></Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
