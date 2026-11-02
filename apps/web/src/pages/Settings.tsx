import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { COMPLEX_TYPES, ROLES, today } from '../lib/format';
import { LogoField, logoPayload } from '../components/LogoField';
import { Alert, Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Spinner, Table } from '../components/ui';

interface Complex { id: string; name: string; type: string; address: string | null; taxId: string | null; currency: string; timezone: string; openingBalance: string; openingBalanceDate: string | null; requireGeofence: boolean; myRole: string; logoUpdatedAt: string | null;
  feeDueDay: number; autoGenerateFees: boolean; lateFeeType: 'NONE' | 'FIXED' | 'PERCENT'; lateFeeValue: string; lateFeeGraceDays: number }
interface Member { userId: string; fullName: string; email: string; role: string }

/** Ajustes del proyecto, saldo inicial y usuarios internos. */
export function SettingsPage() {
  const { complex: active, reload, me } = useAuth();
  const canManage = can(active?.role, 'manage');
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);

  const c = useQuery({ queryKey: ['complex'], queryFn: () => get<Complex>('/complexes/current') });
  const members = useQuery({ queryKey: ['members'], queryFn: () => get<Member[]>('/complexes/current/members'), enabled: canManage });

  const update = useMutation({
    mutationFn: (b: unknown) => patch('/complexes/current', b),
    onSuccess: async () => { await qc.invalidateQueries(); await reload(); setSaved(true); setTimeout(() => setSaved(false), 3000); },
  });
  const addMember = useMutation({ mutationFn: (b: unknown) => post('/complexes/current/members', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); setAdding(false); } });
  const setRole = useMutation({ mutationFn: ({ userId, role }: { userId: string; role: string }) => patch(`/complexes/current/members/${userId}`, { role }), onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }) });
  const removeMember = useMutation({ mutationFn: (userId: string) => del(`/complexes/current/members/${userId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }) });

  if (c.isLoading) return <Spinner />;
  if (!c.data) return <ErrorText error={c.error} />;
  const d = c.data;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    update.mutate({
      name: f.name, type: f.type, address: f.address || null, taxId: f.taxId || null, timezone: f.timezone,
      requireGeofence: f.requireGeofence === 'on',
      feeDueDay: Number(f.feeDueDay), autoGenerateFees: f.autoGenerateFees === 'on',
      lateFeeType: f.lateFeeType, lateFeeValue: Number(f.lateFeeValue || 0), lateFeeGraceDays: Number(f.lateFeeGraceDays || 0),
      openingBalance: Number(f.openingBalance || 0), openingBalanceDate: f.openingBalanceDate,
      logo: logoPayload(f.logo),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes del proyecto" subtitle={d.name} />
      {!canManage && <Alert tone="amber">Solo propietarios y administradores pueden modificar estos ajustes.</Alert>}
      {saved && <Alert tone="green">Cambios guardados.</Alert>}

      <form onSubmit={submit} className="space-y-6">
        <fieldset disabled={!canManage} className="space-y-6">
          <Card title="Datos generales">
            <div className="mb-4"><LogoField projectId={d.id} version={d.logoUpdatedAt} /></div>
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

          <Card title="Cuotas y recargos">
            <label className="mb-4 flex items-start gap-3 text-sm">
              <input type="checkbox" name="autoGenerateFees" defaultChecked={d.autoGenerateFees} className="mt-0.5" />
              <span><strong>Generar cuotas automáticamente</strong><br /><span className="text-slate-500">Cada mes se emite la cuota de cada propiedad activa (según su cuota mensual) y se calculan los recargos por mora. También puedes generarlas a mano en Cuotas.</span></span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Día de vencimiento" hint="Del 1 al 28"><Input name="feeDueDay" type="number" min="1" max="28" defaultValue={d.feeDueDay} required /></Field>
              <Field label="Recargo por mora">
                <Select name="lateFeeType" defaultValue={d.lateFeeType}><option value="NONE">Sin recargo</option><option value="FIXED">Monto fijo (USD)</option><option value="PERCENT">Porcentaje de la cuota</option></Select>
              </Field>
              <Field label="Valor del recargo" hint="USD o % según el tipo"><Input name="lateFeeValue" type="number" step="0.01" min="0" defaultValue={d.lateFeeValue} /></Field>
              <Field label="Días de gracia" hint="Después del vencimiento"><Input name="lateFeeGraceDays" type="number" min="0" max="90" defaultValue={d.lateFeeGraceDays} /></Field>
            </div>
            <p className="mt-3 text-xs text-slate-500">El recargo se aplica una sola vez por cargo vencido y queda como cargo “Recargo por mora” en la cuenta 4400.</p>
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
        <Card title="Usuarios internos" actions={<Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" />Agregar usuario</Button>}>
          <p className="mb-3 text-sm text-slate-600">Administradores, contadores y junta directiva. Los propietarios se gestionan en “Propietarios” y el personal operativo lo asigna el superusuario.</p>
          <ErrorText error={setRole.error ?? removeMember.error} />
          <Table rows={(members.data ?? []).filter((m) => m.role !== 'RESIDENT')} rowKey={(m) => m.userId}
            columns={[
              { header: 'Nombre', cell: (m) => m.fullName },
              { header: 'Correo', cell: (m) => m.email },
              { header: 'Rol', cell: (m) => m.userId === me?.id ? <Badge tone="violet">{ROLES[m.role]}</Badge> : (
                <Select value={m.role === 'OWNER' ? 'ADMIN' : m.role} onChange={(e) => setRole.mutate({ userId: m.userId, role: e.target.value })}>
                  {['ADMIN', 'ACCOUNTANT', 'VIEWER', 'STAFF'].map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
                </Select>
              ) },
              { header: '', cell: (m) => m.userId !== me?.id && (
                <button title="Quitar acceso al proyecto" onClick={() => confirm(`¿Quitar a ${m.fullName} de este proyecto?`) && removeMember.mutate(m.userId)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
              ) },
            ]} />
        </Card>
      )}


      <Modal open={adding} onClose={() => setAdding(false)} title="Agregar usuario">
        <form onSubmit={(e) => { e.preventDefault(); addMember.mutate(formData(e)); }} className="space-y-4">
          <Field label="Nombre completo"><Input name="fullName" required /></Field>
          <Field label="Correo"><Input name="email" type="email" required /></Field>
          <Field label="Rol">
            <Select name="role" defaultValue="STAFF">
              {['ADMIN', 'ACCOUNTANT', 'VIEWER'].map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
            </Select>
          </Field>
          <Field label="Contraseña temporal" hint="Compártela de forma segura; el usuario podrá cambiarla en Mi cuenta"><Input name="temporaryPassword" type="text" minLength={8} required /></Field>
          <ErrorText error={addMember.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancelar</Button><Button loading={addMember.isPending}>Agregar</Button></div>
        </form>
      </Modal>

    </div>
  );
}
