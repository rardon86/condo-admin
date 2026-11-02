import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { useCatalog } from '../lib/catalogs';
import { money } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table } from '../components/ui';
import { ExcelButton } from '../components/ExcelButton';
import { downloadXlsx } from '../lib/xlsx';

export interface PropertyOwner { userId: string; fullName: string; phone: string | null; email: string | null }
interface Property {
  id: string; code: string; type: string; address: string | null; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null;
  areaM2: string | null; monthlyFee: string; active: boolean; owners: PropertyOwner[];
}
interface Resident { userId: string; fullName: string; phone: string | null; status: string; properties: { code: string }[] }

/**
 * Propiedades del complejo (casas, apartamentos, lotes) con su dirección y cuota mensual.
 * Se crean sin propietario; los dueños se vinculan después (pueden ser varios por propiedad).
 */
export function PropertiesPage() {
  const { complex } = useAuth();
  const canManage = can(complex?.role, 'manage');
  const qc = useQueryClient();
  const types = useCatalog('PROPERTY_TYPE');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [removing, setRemoving] = useState<Property | null>(null);
  const { data = [] } = useQuery({ queryKey: ['units'], queryFn: () => get<Property[]>('/units') });
  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/units/${editing}`, b) : post<Property>('/units', b)),
    onSuccess: (r) => {
      qc.invalidateQueries();
      // Al crear, el formulario sigue abierto para vincular propietarios
      setEditing(editing === 'new' && r ? (r as Property).id : null);
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/units/${id}`), onSuccess: () => { qc.invalidateQueries(); setRemoving(null); } });
  const u = editing && editing !== 'new' ? data.find((x) => x.id === editing) ?? null : null;
  const expected = data.filter((x) => x.active).reduce((s, x) => s + Number(x.monthlyFee), 0);
  const rows = data.filter((x) => !q || `${x.code} ${x.ownerName ?? ''} ${x.address ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    save.mutate({
      code: f.code, type: f.type, address: f.address || null,
      areaM2: f.areaM2 ? Number(f.areaM2) : null, monthlyFee: Number(f.monthlyFee || 0), active: f.active === 'true',
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Propiedades" subtitle={`${data.length} propiedades · Cuota mensual esperada ${money(expected)}`}
        actions={
          <>
            {canManage && <Button onClick={() => { save.reset(); setEditing('new'); }}><Plus className="size-4" />Nueva propiedad</Button>}
            <ExcelButton disabled={!data.length} onClick={() => downloadXlsx('Propiedades', [{
              name: 'Propiedades', title: [`${complex?.name ?? ''} — Propiedades`],
              header: ['Código', 'Tipo', 'Dirección', 'Propietarios', 'Teléfonos', 'Correos', 'Área (m²)', 'Cuota mensual', 'Estado'],
              rows: data.map((r) => [
                r.code, types.label(r.type), r.address,
                r.owners.length ? r.owners.map((o) => o.fullName).join(', ') : 'Sin propietario',
                r.owners.map((o) => o.phone).filter(Boolean).join(', '), r.owners.map((o) => o.email).filter(Boolean).join(', '),
                r.areaM2 ? Number(r.areaM2) : null, Number(r.monthlyFee), r.active ? 'Activa' : 'Inactiva',
              ]),
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
            { header: 'Propietarios', cell: (r) => r.owners.length
              ? r.owners.map((o) => <div key={o.userId}>{o.fullName} <span className="text-xs text-slate-500">{o.phone}</span></div>)
              : <Badge>Sin propietario</Badge> },
            { header: 'Cuota', align: 'right', cell: (r) => money(r.monthlyFee) },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activa' : 'Inactiva'}</Badge> },
            { header: '', cell: (r) => canManage && (
              <div className="flex justify-end gap-1">
                <button title="Editar" onClick={() => { save.reset(); setEditing(r.id); }} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button>
                <button title="Eliminar" onClick={() => { remove.reset(); setRemoving(r); }} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
              </div>
            ) },
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
          <Field label="Estado" hint="Una propiedad inactiva no recibe cuotas nuevas y conserva su historia">
            <Select name="active" defaultValue={String(u?.active ?? true)}><option value="true">Activa</option><option value="false">Inactiva</option></Select>
          </Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>{u ? 'Cerrar' : 'Cancelar'}</Button>
            <Button loading={save.isPending}>{u ? 'Guardar cambios' : 'Crear propiedad'}</Button>
          </div>
        </form>
        {u ? <OwnersEditor property={u} /> : <p className="mt-4 text-xs text-slate-500">Después de crearla podrás vincular uno o varios propietarios.</p>}
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={`Eliminar propiedad ${removing?.code ?? ''}`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Solo se pueden eliminar propiedades <strong>sin cargos, pagos ni servicios</strong> registrados (por ejemplo, una creada por error).
            Si ya tiene historia, márcala como <strong>Inactiva</strong> desde Editar: deja de recibir cuotas y se conserva su estado de cuenta.
          </p>
          {removing && removing.owners.length > 0 && <p className="text-sm text-slate-600">Se desvinculará de: {removing.owners.map((o) => o.fullName).join(', ')}.</p>}
          <ErrorText error={remove.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>Eliminar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Vincula o desvincula propietarios de una propiedad. */
function OwnersEditor({ property }: { property: Property }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const residents = useQuery({ queryKey: ['residents'], queryFn: () => get<Resident[]>('/complexes/current/residents') });
  const done = () => { qc.invalidateQueries({ queryKey: ['units'] }); qc.invalidateQueries({ queryKey: ['residents'] }); };
  const link = useMutation({ mutationFn: (userId: string) => post(`/units/${property.id}/owners`, { userId }), onSuccess: () => { setPick(''); done(); } });
  const unlink = useMutation({ mutationFn: (userId: string) => del(`/units/${property.id}/owners/${userId}`), onSuccess: done });
  const options = (residents.data ?? []).filter((r) => r.status !== 'REJECTED' && !property.owners.some((o) => o.userId === r.userId));

  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <div className="mb-2 text-sm font-semibold">Propietarios</div>
      {property.owners.length === 0 && <p className="mb-2 text-sm text-slate-500">Sin propietario.</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        {property.owners.map((o) => (
          <span key={o.userId} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 py-1 pl-3 pr-1 text-sm">
            {o.fullName}<span className="text-xs text-slate-500">{o.phone}</span>
            <button title="Desvincular" onClick={() => unlink.mutate(o.userId)} className="rounded-full p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="size-3.5" /></button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-56 flex-1">
          <Select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— Elegir propietario del proyecto —</option>
            {options.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.fullName}{r.phone ? ` · ${r.phone}` : ''}{r.status === 'PENDING' ? ' (pendiente)' : ''}{r.properties.length ? ` · tiene ${r.properties.map((p) => p.code).join(', ')}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="secondary" disabled={!pick} loading={link.isPending} onClick={() => link.mutate(pick)}><UserPlus className="size-4" />Vincular</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">¿No aparece? Regístralo primero en Propietarios. Una propiedad puede tener varios dueños y un dueño varias propiedades.</p>
      <ErrorText error={link.error ?? unlink.error} />
    </div>
  );
}
