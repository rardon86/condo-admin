import { FormEvent, ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
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
        <Field label="Correo electrónico"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Contraseña"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <ErrorText error={error} />
        <Button className="w-full" loading={busy}>Entrar</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        ¿No tienes cuenta? <Link to="/registro" className="font-medium text-brand-700">Crear cuenta</Link>
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

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    if (f.password !== f.confirm) return setError(new Error('Las contraseñas no coinciden'));
    delete f.confirm;
    setBusy(true);
    setError(null);
    try {
      await register(f);
      nav('/ajustes');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Crear cuenta" subtitle="Registra tu complejo; luego podrás invitar a tu equipo">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre completo" error={fieldErr('fullName')}><Input name="fullName" required autoComplete="name" /></Field>
        <Field label="Correo electrónico" error={fieldErr('email')}><Input name="email" type="email" required autoComplete="email" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña" hint="Mín. 8, letras y números" error={fieldErr('password')}><Input name="password" type="password" required autoComplete="new-password" /></Field>
          <Field label="Confirmar"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
        </div>
        <Field label="Nombre del complejo" error={fieldErr('complexName')}><Input name="complexName" required placeholder="Residencial Las Palmas" /></Field>
        <Field label="Tipo de complejo">
          <Select name="complexType" defaultValue="RESIDENTIAL">
            <option value="RESIDENTIAL">Residencial</option>
            <option value="RECREATIONAL">Recreativo</option>
            <option value="MIXED">Mixto</option>
          </Select>
        </Field>
        <ErrorText error={error} />
        <Button className="w-full" loading={busy}>Crear cuenta</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        ¿Ya tienes cuenta? <Link to="/login" className="font-medium text-brand-700">Iniciar sesión</Link>
      </p>
    </Shell>
  );
}
