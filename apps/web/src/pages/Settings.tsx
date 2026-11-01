import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { COMPLEX_TYPES, ROLES, today } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Spinner, Table } from '../components/ui';

interface Complex { id: string; name: string; type: string; address: string | null; taxId: string | null; currency: string; timezone: string; openingBalance: string; openingBalanceDate: string | null; requireGeofence: boolean; myRole: string }
interface Member { userId: string; fullName: string; email: string; role: string }

/** Ajustes del complejo, saldo inicial, usuarios y alta de complejos adicionales. */
export function SettingsPage() {
  const { complex: active, reload, selectComplex } = useAuth();
  const canManage = can(active?.role, 'manage');
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);

  const c = useQuery({ queryKey: ['complex'], queryFn: () => get<Complex>('/complexes/current') });
  const members = useQuery({ queryKey: ['members'], queryFn: () => get<Member[]>('/complexes/current/members'), enabled: canManage });

  const update = useMutation({
    mutationFn: (b: unknown) => patch('/complexes/current', b),
    onSuccess: async () => { await qc.invalidateQueries(); await reload(); setSaved(true); setTimeout(() => setSaved(false), 3000); },
  });
  const addMember = useMutation({ mutationFn: (b: unknown) => post('/complexes/current/members', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); setAdding(false); } });
  const createComplex = useMutation({
    mutationFn: (b: unknown) => post<{ id: string }>('/complexes', b),
    onSuccess: async (r) => { await reload(); selectComplex(r.id); setParams({}); nav('/ajustes'); },
  });

  if (c.isLoading) return <Spinner />;
  if (!c.data) return <ErrorText error={c.error} />;
  const d = c.data;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    update.mutate({
      name: f.name, type: f.type, address: f.address || null, taxId: f.taxId || null, timezone: f.timezone,
      requireGeofence: f.requireGeofence === 'on',
      openingBalance: Number(f.openingBalance || 0), openingBalanceDate: f.openingBalanceDate,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes del complejo" subtitle={d.name} />
      {!canManage && <Alert tone="amber">Solo propietarios y administradores pueden modificar estos ajustes.</Alert>}
      {saved && <Alert tone="green">Cambios guardados.</Alert>}

      <form onSubmit={submit} className="space-y-6">
        <fieldset disabled={!canManage} className="space-y-6">
          <Card title="Datos generales">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre"><Input name="name" defaultValue={d.name} required /></Field>
              <Field label="Tipo"><Select name="type" defaultValue={d.type}>{Object.entries(COMPLEX_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Dirección"><Input name="address" defaultValue={d.address ?? ''} /></Field>
              <Field label="NIT / registro fiscal"><Input name="taxId" defaultValue={d.taxId ?? ''} /></Field>
              <Field label="Zona horaria"><Input name="timezone" defaultValue={d.timezone} /></Field>
              <Field label="Moneda"><Input value={d.currency} disabled /></Field>
            </div>
          </Card>

          <Card title="Saldo inicial">
            <p className="mb-4 text-sm text-slate-600">Saldo de caja y bancos con el que el complejo inicia en el sistema. Genera el asiento de apertura (Caja contra Fondo inicial); si lo cambias, el asiento se reemplaza.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Saldo (USD)" hint="Puede ser negativo si inicia con sobregiro"><Input name="openingBalance" type="number" step="0.01" defaultValue={d.openingBalance} /></Field>
              <Field label="Fecha del saldo"><Input name="openingBalanceDate" type="date" defaultValue={d.openingBalanceDate ?? today()} required /></Field>
            </div>
          </Card>

          <Card title="Control de marcación">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="requireGeofence" defaultChecked={d.requireGeofence} className="mt-0.5" />
              <span><strong>Exigir geocerca</strong><br /><span className="text-slate-500">Rechaza marcaciones fuera de las zonas definidas. Si está desactivado, se aceptan y quedan señaladas.</span></span>
            </label>
          </Card>
        </fieldset>
        <ErrorText error={update.error} />
        {canManage && <div className="flex justify-end"><Button loading={update.isPending}>Guardar ajustes</Button></div>}
      </form>

      {canManage && (
        <Card title="Usuarios" actions={<Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" />Agregar usuario</Button>}>
          <Table rows={members.data ?? []} rowKey={(m) => m.userId}
            columns={[
              { header: 'Nombre', cell: (m) => m.fullName },
              { header: 'Correo', cell: (m) => m.email },
              { header: 'Rol', cell: (m) => <Badge tone={m.role === 'OWNER' ? 'violet' : 'blue'}>{ROLES[m.role]}</Badge> },
            ]} />
        </Card>
      )}

      <Card title="Otros complejos">
        <p className="mb-3 text-sm text-slate-600">Administra varios complejos con la misma cuenta; cámbialos desde el selector superior del menú.</p>
        <Button variant="secondary" onClick={() => setParams({ nuevo: '1' })}><Plus className="size-4" />Nuevo complejo</Button>
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Agregar usuario">
        <form onSubmit={(e) => { e.preventDefault(); addMember.mutate(formData(e)); }} className="space-y-4">
          <Field label="Nombre completo"><Input name="fullName" required /></Field>
          <Field label="Correo"><Input name="email" type="email" required /></Field>
          <Field label="Rol">
            <Select name="role" defaultValue="STAFF">
              {['ADMIN', 'ACCOUNTANT', 'STAFF', 'VIEWER'].map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
            </Select>
          </Field>
          <Field label="Contraseña temporal" hint="Compártela de forma segura; el usuario podrá cambiarla en Mi cuenta"><Input name="temporaryPassword" type="text" minLength={8} required /></Field>
          <ErrorText error={addMember.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancelar</Button><Button loading={addMember.isPending}>Agregar</Button></div>
        </form>
      </Modal>

      <Modal open={params.get('nuevo') === '1'} onClose={() => setParams({})} title="Nuevo complejo">
        <form onSubmit={(e) => { e.preventDefault(); createComplex.mutate(formData(e)); }} className="space-y-4">
          <Field label="Nombre"><Input name="name" required /></Field>
          <Field label="Tipo"><Select name="type" defaultValue="RESIDENTIAL">{Object.entries(COMPLEX_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <ErrorText error={createComplex.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setParams({})}>Cancelar</Button><Button loading={createComplex.isPending}>Crear</Button></div>
        </form>
      </Modal>
    </div>
  );
}
