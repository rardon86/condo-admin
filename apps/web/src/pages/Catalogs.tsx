import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { Catalog, CatalogItem, useCatalogs } from '../lib/catalogs';
import { METHODS, TICKET_TYPES } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Spinner, Table } from '../components/ui';

interface AccountRow { id: string; code: string; name: string; type: string; isSystem: boolean; active: boolean; postable: boolean }
const ACCOUNT_TYPES: Record<string, string> = { ASSET: 'Activo', LIABILITY: 'Pasivo', EQUITY: 'Patrimonio', INCOME: 'Ingreso', EXPENSE: 'Gasto' };

/** Mantenimiento de catálogos del proyecto. */
export function CatalogsPage() {
  const { complex } = useAuth();
  const canManage = can(complex?.role, 'manage');
  const canFin = can(complex?.role, 'finWrite');
  const catalogs = useCatalogs();

  return (
    <div className="space-y-6">
      <PageHeader title="Catálogos" subtitle="Listas de valores que usa el sistema en este proyecto" />
      {catalogs.isLoading ? <Spinner /> : catalogs.data?.map((c) => <CatalogCard key={c.key} catalog={c} canEdit={canManage} />)}
      <AccountsCard canEdit={canFin} />
      <Card title="Otros catálogos">
        <ul className="space-y-2 text-sm">
          <li><strong>Servicios del complejo</strong> (costo y precio): se mantienen en <Link className="text-link hover:underline" to="/servicios">Servicios</Link>.</li>
          <li><strong>Tipos de cargo</strong>: cuota mensual, extraordinaria, recargo por mora y otro cargo. La cuenta de ingreso de cada cargo sale del catálogo de cuentas.</li>
          <li><strong>Métodos de pago</strong>: {Object.values(METHODS).join(', ')} (fijos).</li>
          <li><strong>Tipos de consulta</strong>: {Object.values(TICKET_TYPES).join(', ')} (fijos).</li>
        </ul>
      </Card>
    </div>
  );
}

function CatalogCard({ catalog, canEdit }: { catalog: Catalog; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const save = useMutation({
    mutationFn: (b: Record<string, unknown>) => (editing && editing !== 'new' ? patch(`/catalogs/${editing.id}`, b) : post('/catalogs', { ...b, catalog: catalog.key })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['catalogs'] }); setEditing(null); },
  });
  const toggle = useMutation({ mutationFn: (i: CatalogItem) => patch(`/catalogs/${i.id}`, { active: !i.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['catalogs'] }) });
  const item = editing && editing !== 'new' ? editing : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    save.mutate(item ? { name: f.name, sortOrder: Number(f.sortOrder || 0) } : { code: f.code, name: f.name, sortOrder: Number(f.sortOrder || 0) });
  }

  return (
    <Card title={catalog.label} actions={canEdit && <Button variant="secondary" onClick={() => setEditing('new')}><Plus className="size-4" />Agregar</Button>}>
      <Table rows={catalog.items} rowKey={(i) => i.id} empty="Sin valores"
        columns={[
          { header: 'Nombre', cell: (i) => <span className={i.active ? '' : 'text-slate-400 line-through'}>{i.name}</span> },
          { header: 'Código', cell: (i) => <code className="text-xs text-slate-500">{i.code}</code> },
          { header: 'Orden', align: 'right', cell: (i) => i.sortOrder },
          { header: 'Estado', cell: (i) => (
            <button disabled={!canEdit} onClick={() => toggle.mutate(i)} title={canEdit ? 'Activar / desactivar' : undefined}>
              <Badge tone={i.active ? 'green' : 'slate'}>{i.active ? 'Activo' : 'Inactivo'}</Badge>
            </button>
          ) },
          { header: '', cell: (i) => canEdit && <button onClick={() => setEditing(i)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
        ]} />
      <ErrorText error={toggle.error} />
      <Modal open={!!editing} onClose={() => setEditing(null)} title={item ? `Editar · ${item.name}` : `Nuevo valor · ${catalog.label}`}>
        <form key={item?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <Field label="Nombre"><Input name="name" defaultValue={item?.name} required maxLength={100} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Código" hint={item ? 'No se puede cambiar: lo usan los registros existentes' : 'Mayúsculas, sin espacios (ej. BODEGA)'}>
              <Input name="code" defaultValue={item?.code} disabled={!!item} required={!item} maxLength={30} pattern="[A-Za-z0-9_]+" />
            </Field>
            <Field label="Orden"><Input name="sortOrder" type="number" min="0" defaultValue={item?.sortOrder ?? catalog.items.length + 1} /></Field>
          </div>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </Card>
  );
}

/** Catálogo de cuentas: categorías de ingreso (4xxx) y gasto (5xxx); las del sistema no se desactivan. */
function AccountsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AccountRow | 'new' | null>(null);
  const [type, setType] = useState('');
  const { data = [] } = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => get<AccountRow[]>('/accounts') });
  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/accounts/${editing.id}`, b) : post('/accounts', b)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setEditing(null); },
  });
  const toggle = useMutation({ mutationFn: (a: AccountRow) => patch(`/accounts/${a.id}`, { active: !a.active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }) });
  const acc = editing && editing !== 'new' ? editing : null;
  const rows = data.filter((a) => !type || a.type === type);

  return (
    <Card title="Catálogo de cuentas" actions={
      <div className="flex gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Todas</option>{Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        {canEdit && <Button variant="secondary" onClick={() => setEditing('new')}><Plus className="size-4" />Nueva categoría</Button>}
      </div>
    }>
      <Table rows={rows} rowKey={(a) => a.id}
        columns={[
          { header: 'Código', cell: (a) => <strong className={a.postable || a.active ? '' : 'text-slate-400'}>{a.code}</strong> },
          { header: 'Nombre', cell: (a) => <span className={a.active ? '' : 'text-slate-400 line-through'}>{a.name}</span> },
          { header: 'Tipo', cell: (a) => ACCOUNT_TYPES[a.type] },
          { header: 'Uso', cell: (a) => (/^\d000$/.test(a.code) ? <Badge>Agrupación</Badge> : a.isSystem ? <Badge tone="violet">Sistema</Badge> : <Badge tone="blue">Propia</Badge>) },
          { header: 'Estado', cell: (a) => (
            <button disabled={!canEdit || a.isSystem} onClick={() => toggle.mutate(a)} title={a.isSystem ? 'Cuenta del sistema' : 'Activar / desactivar'}>
              <Badge tone={a.active ? 'green' : 'slate'}>{a.active ? 'Activa' : 'Inactiva'}</Badge>
            </button>
          ) },
          { header: '', cell: (a) => canEdit && <button onClick={() => setEditing(a)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
        ]} />
      <ErrorText error={toggle.error} />
      <Modal open={!!editing} onClose={() => setEditing(null)} title={acc ? `Cuenta ${acc.code}` : 'Nueva categoría de ingreso o gasto'}>
        <form key={acc?.id ?? 'new'} onSubmit={(e) => { e.preventDefault(); const f = formData(e); save.mutate(acc ? { name: f.name } : { code: f.code, name: f.name }); }} className="space-y-4">
          {!acc && <Field label="Código" hint="4xxx = ingreso · 5xxx = gasto (ej. 4600)"><Input name="code" required pattern="[45][0-9]{3}" maxLength={4} /></Field>}
          <Field label="Nombre"><Input name="name" defaultValue={acc?.name} required minLength={2} maxLength={120} /></Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </Card>
  );
}
