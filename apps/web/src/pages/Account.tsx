import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { patch, post, session } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ROLES } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, Field, formData, Input, PageHeader } from '../components/ui';

/** Gestión de la cuenta del usuario: perfil, contraseña y cierre de sesiones. */
export function AccountPage() {
  const { me, reload, logout } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);

  const profile = useMutation({
    mutationFn: (b: unknown) => patch('/me', b),
    onSuccess: async () => { await reload(); setMsg('Perfil actualizado'); },
  });
  const password = useMutation({
    mutationFn: (b: unknown) => post<{ accessToken: string; refreshToken: string }>('/me/password', b),
    onSuccess: (t) => { session.setTokens(t); setMsg('Contraseña actualizada. Se cerraron tus otras sesiones.'); },
  });
  const logoutAll = useMutation({ mutationFn: () => post('/auth/logout-all'), onSuccess: () => logout() });

  function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    profile.mutate({ fullName: f.fullName, email: f.email, phone: f.phone || null });
  }
  function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = formData(e);
    if (f.newPassword !== f.confirm) return setMsg('Las contraseñas no coinciden');
    password.mutate({ currentPassword: f.currentPassword, newPassword: f.newPassword }, { onSuccess: () => form.reset() });
  }

  if (!me) return null;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Mi cuenta" subtitle={me.email} />
      {msg && <Alert tone="green">{msg}</Alert>}

      <Card title="Perfil">
        <form onSubmit={submitProfile} className="space-y-4">
          <Field label="Nombre completo"><Input name="fullName" defaultValue={me.fullName} required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Correo"><Input name="email" type="email" defaultValue={me.email} required /></Field>
            <Field label="Teléfono"><Input name="phone" defaultValue={me.phone ?? ''} /></Field>
          </div>
          <ErrorText error={profile.error} />
          <div className="flex justify-end"><Button loading={profile.isPending}>Guardar</Button></div>
        </form>
      </Card>

      <Card title="Cambiar contraseña">
        <form onSubmit={submitPassword} className="space-y-4">
          <Field label="Contraseña actual"><Input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nueva contraseña" hint="Mín. 8, letras y números"><Input name="newPassword" type="password" autoComplete="new-password" required /></Field>
            <Field label="Confirmar"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
          </div>
          <ErrorText error={password.error} />
          <div className="flex justify-end"><Button loading={password.isPending}>Actualizar contraseña</Button></div>
        </form>
      </Card>

      <Card title="Mis complejos">
        <ul className="divide-y divide-slate-100">
          {me.complexes.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2.5 text-sm"><span>{c.name}</span><Badge tone="blue">{ROLES[c.role]}</Badge></li>
          ))}
        </ul>
      </Card>

      <Card title="Seguridad">
        <p className="mb-3 text-sm text-slate-600">Cierra la sesión en todos los dispositivos donde hayas ingresado.</p>
        <Button variant="danger" loading={logoutAll.isPending} onClick={() => logoutAll.mutate()}>Cerrar todas las sesiones</Button>
      </Card>
    </div>
  );
}
