import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Pencil, Plus } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { COMPLEX_TYPES, money } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Table } from '../components/ui';
import { LogoField, logoPayload } from '../components/LogoField';
import { ProjectLogo } from '../components/ProjectLogo';

interface Project {
  id: string; name: string; type: string; address: string | null; active: boolean; logoVersion: string | null;
  counts: { units: number; residents: number; employees: number; admins: number };
  admins: { fullName: string; email: string }[];
}
interface Employee {
  id: string; fullName: string; documentId: string | null; position: string | null; phone: string | null; hourlyRate: string;
  active: boolean; userId: string | null; loginEmail: string | null; projects: { id: string; name: string }[];
}

/** Consola del superusuario: proyectos de la plataforma y su administrador. */
export function PlatformProjectsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { reload, selectComplex } = useAuth();
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const { data = [] } = useQuery({ queryKey: ['admin-projects'], queryFn: () => get<Project[]>('/admin/projects') });
  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/admin/projects/${editing.id}`, b) : post('/admin/projects', b)),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['admin-projects'] }); await reload(); setEditing(null); },
  });
  const p = editing && editing !== 'new' ? editing : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    save.mutate({
      name: f.name, type: f.type, address: f.address || null, active: f.active === 'true', logo: logoPayload(f.logo),
      ...(f.adminEmail ? { adminEmail: f.adminEmail, adminName: f.adminName || undefined, adminPassword: f.adminPassword || undefined } : {}),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Proyectos" subtitle="Residenciales y complejos recreativos administrados en la plataforma"
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" />Nuevo proyecto</Button>} />
      <Card>
        <Table rows={data} rowKey={(r) => r.id} empty="Crea tu primer proyecto."
          columns={[
            { header: 'Proyecto', cell: (r) => (
              <div className="flex items-center gap-3">
                <ProjectLogo id={r.id} version={r.logoVersion} className="size-10" />
                <div><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{COMPLEX_TYPES[r.type]}{r.address ? ` · ${r.address}` : ''}</div></div>
              </div>
            ) },
            { header: 'Administrador', cell: (r) => r.admins.length ? r.admins.map((a) => <div key={a.email} className="text-sm">{a.fullName} <span className="text-xs text-slate-500">{a.email}</span></div>) : <Badge tone="amber">Sin asignar</Badge> },
            { header: 'Propiedades', align: 'right', cell: (r) => r.counts.units },
            { header: 'Propietarios', align: 'right', cell: (r) => r.counts.residents },
            { header: 'Empleados', align: 'right', cell: (r) => r.counts.employees },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activo' : 'Inactivo'}</Badge> },
            { header: '', cell: (r) => (
              <div className="flex justify-end gap-1">
                <button title="Editar" onClick={() => setEditing(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button>
                <Button variant="ghost" onClick={() => { selectComplex(r.id); nav('/'); }}>Entrar<ArrowRight className="size-4" /></Button>
              </div>
            ) },
          ]} />
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={p ? `Editar ${p.name}` : 'Nuevo proyecto'}>
        <form key={p?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <Field label="Nombre"><Input name="name" defaultValue={p?.name} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo"><Select name="type" defaultValue={p?.type ?? 'RESIDENTIAL'}>{Object.entries(COMPLEX_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Estado"><Select name="active" defaultValue={String(p?.active ?? true)}><option value="true">Activo</option><option value="false">Inactivo</option></Select></Field>
          </div>
          <Field label="Dirección"><Input name="address" defaultValue={p?.address ?? ''} /></Field>
          <LogoField projectId={p?.id} version={p?.logoVersion} />
          <div className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-medium">{p ? 'Agregar administrador (opcional)' : 'Administrador del proyecto (opcional)'}</div>
            <Field label="Correo"><Input name="adminEmail" type="email" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre" hint="Solo si es usuario nuevo"><Input name="adminName" /></Field>
              <Field label="Contraseña temporal" hint="Solo si es usuario nuevo"><Input name="adminPassword" type="text" minLength={8} /></Field>
            </div>
          </div>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}

/** Registro único de empleados y su asociación a uno o varios proyectos. */
export function PlatformEmployeesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const emps = useQuery({ queryKey: ['admin-employees'], queryFn: () => get<Employee[]>('/admin/employees') });
  const projects = useQuery({ queryKey: ['admin-projects'], queryFn: () => get<Project[]>('/admin/projects') });
  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/admin/employees/${editing.id}`, b) : post('/admin/employees', b)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-employees'] }); qc.invalidateQueries({ queryKey: ['admin-projects'] }); setEditing(null); },
  });
  const e = editing && editing !== 'new' ? editing : null;

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const f = formData(ev);
    save.mutate({
      fullName: f.fullName, position: f.position || null, documentId: f.documentId || null, phone: f.phone || null,
      hourlyRate: Number(f.hourlyRate || 0), active: f.active === 'true',
      projectIds: fd.getAll('projectIds').map(String),
      ...(f.loginEmail ? { loginEmail: f.loginEmail, loginPassword: f.loginPassword || undefined } : {}),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Empleados" subtitle="Personal de la plataforma y los proyectos donde trabaja cada uno"
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" />Nuevo empleado</Button>} />
      <Card>
        <Table rows={emps.data ?? []} rowKey={(r) => r.id} empty="Sin empleados registrados."
          columns={[
            { header: 'Empleado', cell: (r) => <><div className="font-medium">{r.fullName}</div><div className="text-xs text-slate-500">{[r.position, r.documentId].filter(Boolean).join(' · ')}</div></> },
            { header: 'Proyectos', cell: (r) => r.projects.length ? <div className="flex flex-wrap gap-1">{r.projects.map((x) => <Badge key={x.id} tone="blue">{x.name}</Badge>)}</div> : <Badge tone="amber">Sin proyecto</Badge> },
            { header: 'Tarifa/hora', align: 'right', cell: (r) => money(r.hourlyRate) },
            { header: 'Acceso para marcar', cell: (r) => (r.loginEmail ? <span className="text-sm">{r.loginEmail}</span> : <Badge tone="slate">Sin usuario</Badge>) },
            { header: 'Estado', cell: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Activo' : 'Inactivo'}</Badge> },
            { header: '', cell: (r) => <button onClick={() => setEditing(r)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button> },
          ]} />
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={e ? 'Editar empleado' : 'Nuevo empleado'} wide>
        <form key={e?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <Field label="Nombre completo"><Input name="fullName" defaultValue={e?.fullName} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cargo"><Input name="position" defaultValue={e?.position ?? ''} placeholder="Vigilante, jardinero…" /></Field>
            <Field label="DUI / documento"><Input name="documentId" defaultValue={e?.documentId ?? ''} /></Field>
            <Field label="Teléfono"><Input name="phone" defaultValue={e?.phone ?? ''} /></Field>
            <Field label="Tarifa por hora (USD)"><Input name="hourlyRate" type="number" step="0.01" min="0" defaultValue={e?.hourlyRate ?? '0'} /></Field>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Proyectos donde trabaja</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {projects.data?.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input type="checkbox" name="projectIds" value={p.id} defaultChecked={e?.projects.some((x) => x.id === p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-medium">Acceso para marcar asistencia {e?.loginEmail && <span className="font-normal text-slate-500">· actual: {e.loginEmail}</span>}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Correo de acceso"><Input name="loginEmail" type="email" /></Field>
              <Field label="Contraseña temporal" hint="Solo si es usuario nuevo"><Input name="loginPassword" type="text" minLength={8} /></Field>
            </div>
          </div>
          <Field label="Estado"><Select name="active" defaultValue={String(e?.active ?? true)}><option value="true">Activo</option><option value="false">Inactivo</option></Select></Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
