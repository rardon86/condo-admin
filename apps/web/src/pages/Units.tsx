import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { useCatalog } from '../lib/catalogs';
import { money } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table } from '../components/ui';
import { ExcelButton } from '../components/ExcelButton';
import { downloadXlsx } from '../lib/xlsx';

interface Property {
  id: string; code: string; type: string; address: string | null; ownerUserId: string | null; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null;
  areaM2: string | null; monthlyFee: string; active: boolean;
}

interface Owner { userId: string; fullName: string; email: string; status: string; unitCode: string | null }
/** Valor del selector para conservar un propietario escrito a mano antes (sin cuenta en el portal). */
const KEEP = '__keep';

/** Propiedades del complejo (casas, apartamentos, lotes) con su dirección y cuota mensual. */
export function PropertiesPage() {
  const { complex } = useAuth();
  const canManage = can(complex?.role, 'manage');
  const qc = useQueryClient();
  const types = useCatalog('PROPERTY_TYPE');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Property | 'new' | null>(null);
  const { data = [] } = useQuery({ queryKey: ['units'], queryFn: () => get<Property[]>('/units') });
  const owners = useQuery({ queryKey: ['residents'], queryFn: () => get<Owner[]>('/complexes/current/residents'), enabled: canManage });
  const ownerOptions = (owners.data ?? []).filter((o) => o.status !== 'REJECTED');
  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/units/${editing.id}`, b) : post('/units', b)),
    onSuccess: () => { qc.invalidateQueries(); setEditing(null); },
  });
  const u = editing && editing !== 'new' ? editing : null;
  const expected = data.filter((x) => x.active).reduce((s, x) => s + Number(x.monthlyFee), 0);
  const rows = data.filter((x) => !q || `${x.code} ${x.ownerName ?? ''} ${x.address ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    save.mutate({
      code: f.code, type: f.type, address: f.address || null,
      ...(f.ownerUserId === KEEP ? {} : { ownerUserId: f.ownerUserId || null }),
      areaM2: f.areaM2 ? Number(f.areaM2) : null, monthlyFee: Number(f.monthlyFee || 0), active: f.active === 'true',
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Propiedades" subtitle={`${data.length} propiedades · Cuota mensual esperada ${money(expected)}`}
        actions={
          <>
            {canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" />Nueva propiedad</Button>}
            <ExcelButton disabled={!data.length} onClick={() => downloadXlsx('Propiedades', [{
              name: 'Propiedades', title: [`${complex?.name ?? ''} — Propiedades`],
              header: ['Código', 'Tipo', 'Dirección', 'Propietario', 'Correo', 'Teléfono', 'Área (m²)', 'Cuota mensual', 'Estado'],
              rows: data.map((r) => [r.code, types.label(r.type), r.address, r.ownerName ?? 'Sin propietario', r.ownerEmail, r.ownerPhone, r.areaM2 ? Number(r.areaM2) : null, Number(r.monthlyFee), r.active ? 'Activa' : 'Inactiva']),
              money: [7],
              totals: ['Total', `${data.length} propiedades`, null, null, null, null, null, expected, null],
            }])} />
          </>
        } />
      <Card>
        <div className="mb-4 max-w-sm"><Input placeholder="Buscar por código, propietario o dirección" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Table rows={rows} rowKey={(r) => r.id} empty="Registra las casas, apartamentos o lotes del complejo con su cuota mensual."
          columns={[
            { header: 'Código', cell: (r) => <Link className="font-semibold text-link hover:underline" to={`/informes/estado-cuenta/${r.id}`} title="Ver estado de cuenta">{r.code}</Link> },
            { header: 'Tipo', cell: (r) => types.label(r.type) },
            { header: 'Dirección', cell: (r) => <span className="text-sm">{r.address ?? <span className="text-slate-400">—</span>}</span> },
            { header: 'Propietario', cell: (r) => r.ownerName
              ? <><div>{r.ownerName}</div><div className="text-xs text-slate-500">{[r.ownerEmail, r.ownerPhone].filter(Boolean).join(' · ')}</div></>
              : <Badge>Sin propietario</Badge> },
            { header: 'Cuota', align: 'right', cell: (r) => money(r.monthlyFee) },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activa' : 'Inactiva'}</Badge> },
            { header: '', cell: (r) => canManage && <button onClick={() => setEditing(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
          ]} />
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={u ? `Propiedad ${u.code}` : 'Nueva propiedad'} wide>
        <form key={u?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Código"><Input name="code" defaultValue={u?.code} required placeholder="C-01" /></Field>
            <Field label="Tipo" hint="Se administran en Catálogos">
              <Select name="type" defaultValue={u?.type ?? types.options[0]?.code}>
                {types.options.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                {u && !types.options.some((t) => t.code === u.type) && <option value={u.type}>{types.label(u.type)}</option>}
              </Select>
            </Field>
          </div>
          <Field label="Dirección exacta"><Input name="address" defaultValue={u?.address ?? ''} maxLength={500} placeholder="Pasaje A, casa #12, Residencial…, municipio, departamento" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cuota mensual (USD)"><Input name="monthlyFee" type="number" step="0.01" min="0" defaultValue={u?.monthlyFee ?? '0'} /></Field>
            <Field label="Área (m²)"><Input name="areaM2" type="number" step="0.01" min="0" defaultValue={u?.areaM2 ?? ''} /></Field>
          </div>
          <Field label="Propietario" hint="Solo propietarios registrados en el proyecto. ¿No aparece? Agrégalo primero en Propietarios.">
            <Select name="ownerUserId" defaultValue={u?.ownerUserId ?? (u?.ownerName ? KEEP : '')}>
              <option value="">— Sin propietario —</option>
              {u && !u.ownerUserId && u.ownerName && <option value={KEEP}>{u.ownerName} (registro anterior, sin cuenta)</option>}
              {ownerOptions.map((o) => (
                <option key={o.userId} value={o.userId}>
                  {o.fullName} · {o.email}{o.status === 'PENDING' ? ' (pendiente)' : ''}{o.unitCode && o.unitCode !== u?.code ? ` · ya tiene ${o.unitCode}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado"><Select name="active" defaultValue={String(u?.active ?? true)}><option value="true">Activa</option><option value="false">Inactiva</option></Select></Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
