import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { del, get, patch, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, ROLES } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table } from '../components/ui';

interface Membership { complexId: string; complexName: string; role: string; status: string; unitId: string | null; unitCode: string | null }
interface User {
  id: string; fullName: string; email: string | null; username: string | null; phone: string | null; isSuperAdmin: boolean; active: boolean;
  lastLoginAt: string | null; createdAt: string; memberships: Membership[];
}
interface Project { id: string; name: string }

const ROLE_OPTIONS = ['ADMIN', 'ACCOUNTANT', 'VIEWER', 'STAFF', 'RESIDENT'];
const STATUS: Record<string, string> = { ACTIVE: 'Activo', PENDING: 'Pendiente', REJECTED: 'Rechazado' };

/** Gestión de usuarios de la plataforma (solo superusuario): cuentas, superusuarios y accesos por proyecto. */
export function UsersPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => get<User[]>('/admin/users') });
  const projects = useQuery({ queryKey: ['admin-projects'], queryFn: () => get<Project[]>('/admin/projects') });
  const list = (users.data ?? []).filter((u) => !q || `${u.fullName} ${u.email} ${u.username ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const current = editing && editing !== 'new' ? users.data?.find((u) => u.id === editing.id) ?? editing : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Usuarios" subtitle="Cuentas de la plataforma, superusuarios y acceso de cada usuario a los proyectos"
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" />Nuevo usuario</Button>} />
      <Card>
        <div className="mb-4 max-w-sm"><Input placeholder="Buscar por nombre, correo o usuario" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Table rows={list} rowKey={(u) => u.id} empty="Sin usuarios"
          columns={[
            { header: 'Usuario', cell: (u) => (
              <>
                <div className="flex items-center gap-1.5 font-medium">{u.fullName}{u.isSuperAdmin && <span title="Superusuario"><ShieldCheck className="size-4 text-violet-500" /></span>}</div>
                <div className="text-xs text-slate-500">{u.email}{u.username ? ` · @${u.username}` : ''}</div>
              </>
            ) },
            { header: 'Proyectos', cell: (u) => (
              <div className="flex flex-wrap gap-1">
                {u.isSuperAdmin && <Badge tone="violet">Superusuario · todos</Badge>}
                {u.memberships.map((m) => <Badge key={m.complexId} tone={m.status === 'ACTIVE' ? 'blue' : 'amber'}>{m.complexName} · {ROLES[m.role]}{m.unitCode ? ` ${m.unitCode}` : ''}</Badge>)}
                {!u.isSuperAdmin && !u.memberships.length && <span className="text-xs text-slate-400">Sin acceso</span>}
              </div>
            ) },
            { header: 'Último acceso', cell: (u) => <span className="whitespace-nowrap text-xs text-slate-500">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Nunca'}</span> },
            { header: 'Estado', cell: (u) => <Badge tone={u.active ? 'green' : 'slate'}>{u.active ? 'Activo' : 'Desactivado'}</Badge> },
            { header: '', cell: (u) => <button onClick={() => setEditing(u)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
          ]} />
        <ErrorText error={users.error} />
      </Card>

      {editing === 'new' && <NewUserModal projects={projects.data ?? []} onClose={() => setEditing(null)} onDone={() => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditing(null); }} />}
      {current && <EditUserModal user={current} self={current.id === me?.id} projects={projects.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NewUserModal({ projects, onClose, onDone }: { projects: Project[]; onClose: () => void; onDone: () => void }) {
  const [complexId, setComplexId] = useState('');
  const [role, setRole] = useState('ADMIN');
  const create = useMutation({ mutationFn: (b: unknown) => post('/admin/users', b), onSuccess: onDone });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    create.mutate({
      fullName: f.fullName, email: f.email, username: f.username || null, phone: f.phone || null, password: f.password, isSuperAdmin: f.isSuperAdmin === 'on',
      ...(complexId ? { complexId, membership: { role, status: 'ACTIVE', unitId: f.unitId || null } } : {}),
    });
  }
  return (
    <Modal open onClose={onClose} title="Nuevo usuario" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre completo"><Input name="fullName" required minLength={2} /></Field>
          <Field label="Correo" hint="Opcional si indicas usuario"><Input name="email" type="email" /></Field>
          <Field label="Usuario (opcional)" hint="Para iniciar sesión sin correo"><Input name="username" pattern="[A-Za-z0-9._-]{3,60}" /></Field>
          <Field label="Teléfono"><Input name="phone" /></Field>
        </div>
        <Field label="Contraseña temporal" hint="Mínimo 8 caracteres; el usuario puede cambiarla en Mi cuenta"><Input name="password" type="text" required minLength={8} /></Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="isSuperAdmin" className="mt-0.5" />
          <span><strong>Superusuario de la plataforma</strong><br /><span className="text-slate-500">Administra todos los proyectos, empleados y usuarios.</span></span>
        </label>
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 text-sm font-medium">Acceso inicial a un proyecto (opcional)</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select value={complexId} onChange={(e) => setComplexId(e.target.value)}><option value="">— Ninguno —</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Select value={role} onChange={(e) => setRole(e.target.value)} disabled={!complexId}>{ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}</Select>
            {complexId && role === 'RESIDENT' && <UnitSelect complexId={complexId} name="unitId" />}
          </div>
        </div>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={create.isPending}>Crear usuario</Button></div>
      </form>
    </Modal>
  );
}

function UnitSelect({ complexId, name, value, onChange }: { complexId: string; name?: string; value?: string; onChange?: (v: string) => void }) {
  const units = useQuery({ queryKey: ['admin-units', complexId], queryFn: () => get<{ id: string; code: string; ownerName: string | null }[]>(`/admin/users/projects/${complexId}/units`) });
  return (
    <Select name={name} value={value} onChange={(e) => onChange?.(e.target.value)}>
      <option value="">— Propiedad —</option>
      {units.data?.map((u) => <option key={u.id} value={u.id}>{u.code}{u.ownerName ? ` · ${u.ownerName}` : ''}</option>)}
    </Select>
  );
}

function EditUserModal({ user, self, projects, onClose }: { user: User; self: boolean; projects: Project[]; onClose: () => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-users'] });
  const [saved, setSaved] = useState('');
  const [add, setAdd] = useState({ complexId: '', role: 'ADMIN', unitId: '' });
  const update = useMutation({ mutationFn: (b: unknown) => patch(`/admin/users/${user.id}`, b), onSuccess: () => { refresh(); setSaved('Cambios guardados'); } });
  const setM = useMutation({
    mutationFn: ({ complexId, ...b }: { complexId: string; role: string; status: string; unitId: string | null }) => put(`/admin/users/${user.id}/memberships/${complexId}`, b),
    onSuccess: () => { refresh(); setAdd({ complexId: '', role: 'ADMIN', unitId: '' }); },
  });
  const removeM = useMutation({ mutationFn: (complexId: string) => del(`/admin/users/${user.id}/memberships/${complexId}`), onSuccess: refresh });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    update.mutate({ fullName: f.fullName, email: f.email, username: f.username || null, phone: f.phone || null, isSuperAdmin: f.isSuperAdmin === 'on', active: f.active === 'on' });
  }

  return (
    <Modal open onClose={onClose} title={user.fullName} wide>
      <div className="space-y-6">
        <form key={user.id} onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre completo"><Input name="fullName" defaultValue={user.fullName} required /></Field>
            <Field label="Correo"><Input name="email" type="email" defaultValue={user.email ?? ''} /></Field>
            <Field label="Usuario"><Input name="username" defaultValue={user.username ?? ''} pattern="[A-Za-z0-9._-]{3,60}" /></Field>
            <Field label="Teléfono"><Input name="phone" defaultValue={user.phone ?? ''} /></Field>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="isSuperAdmin" defaultChecked={user.isSuperAdmin} disabled={self} />Superusuario</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={user.active} disabled={self} />Cuenta activa</label>
          </div>
          {self && <p className="text-xs text-slate-500">No puedes quitarte el superusuario ni desactivar tu propia cuenta.</p>}
          {saved && <p className="text-sm text-emerald-600">{saved}</p>}
          <ErrorText error={update.error} />
          <div className="flex justify-end"><Button loading={update.isPending}>Guardar datos</Button></div>
        </form>

        <form onSubmit={(e) => { e.preventDefault(); update.mutate({ password: formData(e).password }); (e.target as HTMLFormElement).reset(); }} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-3">
          <div className="min-w-48 flex-1"><Field label="Restablecer contraseña" hint="Cierra las sesiones abiertas del usuario"><Input name="password" type="text" minLength={8} required /></Field></div>
          <Button variant="secondary" loading={update.isPending}><KeyRound className="size-4" />Restablecer</Button>
        </form>

        <Card title="Acceso a proyectos">
          {user.isSuperAdmin && <p className="mb-3 text-sm text-slate-500">Como superusuario entra a todos los proyectos como administrador. Las membresías de abajo aplican si deja de serlo.</p>}
          <Table rows={user.memberships} rowKey={(m) => m.complexId} empty="Sin acceso a proyectos"
            columns={[
              { header: 'Proyecto', cell: (m) => m.complexName },
              { header: 'Rol', cell: (m) => (
                <Select value={m.role === 'OWNER' ? 'ADMIN' : m.role} onChange={(e) => setM.mutate({ complexId: m.complexId, role: e.target.value, status: m.status, unitId: e.target.value === 'RESIDENT' ? m.unitId : null })}>
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
                </Select>
              ) },
              { header: 'Propiedad', cell: (m) => m.role === 'RESIDENT'
                ? <UnitSelect complexId={m.complexId} value={m.unitId ?? ''} onChange={(v) => setM.mutate({ complexId: m.complexId, role: m.role, status: m.status, unitId: v || null })} />
                : <span className="text-slate-400">—</span> },
              { header: 'Estado', cell: (m) => (
                <Select value={m.status} onChange={(e) => setM.mutate({ complexId: m.complexId, role: m.role, status: e.target.value, unitId: m.unitId })}>
                  {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              ) },
              { header: '', cell: (m) => <button title="Quitar acceso" onClick={() => confirm(`¿Quitar el acceso a ${m.complexName}?`) && removeM.mutate(m.complexId)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button> },
            ]} />
          <form onSubmit={(e) => { e.preventDefault(); setM.mutate({ ...add, status: 'ACTIVE', unitId: add.role === 'RESIDENT' ? add.unitId || null : null }); }} className="mt-4 grid gap-2 sm:grid-cols-4">
            <Select value={add.complexId} onChange={(e) => setAdd({ ...add, complexId: e.target.value })} required>
              <option value="">— Proyecto —</option>
              {projects.filter((p) => !user.memberships.some((m) => m.complexId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>{ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}</Select>
            {add.role === 'RESIDENT' && add.complexId ? <UnitSelect complexId={add.complexId} value={add.unitId} onChange={(v) => setAdd({ ...add, unitId: v })} /> : <span />}
            <Button variant="secondary" loading={setM.isPending}><Plus className="size-4" />Dar acceso</Button>
          </form>
          <ErrorText error={setM.error ?? removeM.error} />
        </Card>
      </div>
    </Modal>
  );
}
