import { FormEvent, ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiError, get } from '../lib/api';
import { Button, ErrorText, Field, formData, Input, Select } from '../components/ui';

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white"><Building2 className="size-5" /></span>
          <span className="font-semibold">Administración de Complejos</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    setBusy(true);
    setError(null);
    try {
      await login(f.email, f.password);
      nav('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Iniciar sesión" subtitle="Ingresa para administrar tu complejo">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Correo o usuario"><Input name="email" type="text" autoComplete="username" autoCapitalize="none" required /></Field>
        <Field label="Contraseña"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <ErrorText error={error} />
        <Button className="w-full" loading={busy}>Entrar</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        ¿Eres propietario y no tienes cuenta? <Link to="/registro" className="font-medium text-brand-700">Regístrate</Link>
      </p>
    </Shell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fieldErr = (k: string) => (error instanceof ApiError ? error.details?.[k]?.[0] : undefined);
  const projects = useQuery({ queryKey: ['public-projects'], queryFn: () => get<{ id: string; name: string }[]>('/public/projects') });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    if (f.password !== f.confirm) return setError(new Error('Las contraseñas no coinciden'));
    delete f.confirm;
    setBusy(true);
    setError(null);
    try {
      await register(f);
      nav('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Registro de propietarios" subtitle="Crea tu cuenta; la administración de tu residencial la aprobará">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre completo" error={fieldErr('fullName')}><Input name="fullName" required autoComplete="name" /></Field>
        <Field label="Correo electrónico" error={fieldErr('email')}><Input name="email" type="email" required autoComplete="email" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña" hint="Mín. 8, letras y números" error={fieldErr('password')}><Input name="password" type="password" required autoComplete="new-password" /></Field>
          <Field label="Confirmar"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
        </div>
        <Field label="Teléfono"><Input name="phone" type="tel" autoComplete="tel" /></Field>
        <Field label="Residencial / complejo" error={fieldErr('complexId')}>
          <Select name="complexId" required defaultValue="">
            <option value="" disabled>Selecciona…</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Casa / apartamento" hint="Tal como aparece en tu recibo, p. ej. C-01" error={fieldErr('unitCode')}><Input name="unitCode" required /></Field>
        <ErrorText error={error} />
        <Button className="w-full" loading={busy}>Enviar solicitud</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        ¿Ya tienes cuenta? <Link to="/login" className="font-medium text-brand-700">Iniciar sesión</Link>
      </p>
    </Shell>
  );
}
