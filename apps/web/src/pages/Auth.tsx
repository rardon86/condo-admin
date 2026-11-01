import { FormEvent, InputHTMLAttributes, ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BarChart3, Eye, EyeOff, Lock, MapPinned, MessagesSquare, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiError, get } from '../lib/api';
import { ArorLogo, CopyrightFooter, PRODUCT_NAME } from '../components/Brand';
import { Button, ErrorText, Field, formData, Input, Select } from '../components/ui';

const FEATURES = [
  { icon: <BarChart3 />, title: 'Finanzas claras', text: 'Ingresos, egresos, estados financieros y proyecciones al día.' },
  { icon: <MessagesSquare />, title: 'Comunidad conectada', text: 'Avisos, consultas y reclamos en un portal para cada propietario.' },
  { icon: <MapPinned />, title: 'Personal bajo control', text: 'Marcación con GPS y geocercas, horas y costo por proyecto.' },
];

/** Fondo de marca: medianoche con resplandores esmeralda y azul AROR, retícula sutil y la onda del logo. */
function BrandBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#071021]" />
      <div className="absolute -left-40 -top-40 size-[36rem] rounded-full bg-[#1d4ed8] opacity-25 blur-[120px]" />
      <div className="absolute -bottom-48 right-[-10rem] size-[40rem] rounded-full bg-[#10b981] opacity-20 blur-[130px]" />
      <div className="absolute left-1/3 top-1/2 size-[18rem] rounded-full bg-[#d4af37] opacity-[0.07] blur-[100px]" />
      <svg className="absolute inset-0 h-full w-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M44 0H0V44" fill="none" stroke="white" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <svg className="absolute bottom-0 left-0 h-48 w-full opacity-50" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <defs>
          <linearGradient id="wave" x1="0" x2="1">
            <stop offset="0" stopColor="#1d4ed8" stopOpacity="0.35" />
            <stop offset="1" stopColor="#10b981" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <path d="M0 260 C 320 120, 620 330, 900 210 S 1300 90, 1440 150 L1440 320 L0 320 Z" fill="url(#wave)" />
      </svg>
    </div>
  );
}

function Shell({ title, subtitle, children, wide }: { title: string; subtitle: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative flex min-h-full flex-col overflow-hidden text-white">
      <BrandBackdrop />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-5 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-16">
        {/* Presentación del producto */}
        <section className="animate-rise hidden lg:block">
          <ArorLogo variant="light" className="h-20 w-auto drop-shadow-[0_8px_30px_rgba(29,78,216,0.35)]" />
          <div className="mt-10 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-[#6ee7b7]">
            <ShieldCheck className="size-3.5" /> Plataforma segura en la nube
          </div>
          <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight tracking-tight xl:text-5xl">
            {PRODUCT_NAME}
            <span className="block bg-gradient-to-r from-[#34d399] via-[#7fb3ff] to-[#d4af37] bg-clip-text text-transparent">residenciales y recreativos</span>
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-[#c5d0df]">
            Todo lo que tu complejo necesita en un solo lugar: transparencia para los propietarios y control total para la administración.
          </p>
          <ul className="mt-10 grid gap-4">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="animate-rise flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur" style={{ animationDelay: `${120 + i * 90}ms` }}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#10b981] to-[#1d4ed8] text-white [&>svg]:size-5">{f.icon}</span>
                <span>
                  <span className="block font-semibold">{f.title}</span>
                  <span className="block text-sm text-[#a8b6cb]">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Tarjeta de acceso */}
        <section className={`animate-rise mx-auto w-full ${wide ? 'max-w-lg' : 'max-w-md'}`} style={{ animationDelay: '80ms' }}>
          <div className="relative">
            <div aria-hidden className="absolute -inset-px rounded-[1.6rem] bg-gradient-to-br from-[#10b981]/60 via-white/10 to-[#1d4ed8]/60" />
            <div className="relative rounded-[1.55rem] bg-[#0c1a30]/95 p-7 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-9">
              <ArorLogo variant="light" className="mx-auto mb-6 h-14 w-auto lg:hidden" />
              <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
              <p className="mb-7 mt-1.5 text-sm text-[#a8b6cb]">{subtitle}</p>
              {children}
            </div>
          </div>
        </section>
      </div>
      <CopyrightFooter className="relative z-10 px-4 pb-6 text-[#7f90ab]" />
    </div>
  );
}

/** Campo con ícono, estilo oscuro fijo (la pantalla de acceso no depende del tema elegido). */
function AuthInput({ icon, right, ...p }: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="relative">
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7f90ab] [&>svg]:size-4">{icon}</span>}
      <input
        {...p}
        className={`w-full rounded-xl border border-white/10 bg-white/[0.06] py-3 text-sm text-white placeholder:text-[#7f90ab] outline-none transition focus:border-[#10b981] focus:bg-white/[0.09] focus:ring-4 focus:ring-[#10b981]/15 ${icon ? 'pl-10' : 'pl-3.5'} ${right ? 'pr-11' : 'pr-3.5'}`}
      />
      {right && <span className="absolute right-2 top-1/2 -translate-y-1/2">{right}</span>}
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

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
    <Shell title="Bienvenido" subtitle="Ingresa para administrar tu complejo">
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-[#a8b6cb]">Correo o usuario</span>
          <AuthInput name="email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required icon={<User />} placeholder="tu@correo.com" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-[#a8b6cb]">Contraseña</span>
          <AuthInput
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            required
            icon={<Lock />}
            placeholder="••••••••"
            right={
              <button type="button" onClick={() => setShow((s) => !s)} className="rounded-lg p-1.5 text-[#7f90ab] hover:text-white" aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          />
        </label>
        {error ? <p role="alert" className="rounded-xl border border-[#f05252]/30 bg-[#f05252]/10 px-3 py-2 text-sm text-[#fecaca]">{(error as Error).message}</p> : null}
        <button
          disabled={busy}
          className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#10b981] to-[#0e9f6e] py-3 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#10b981]/30 disabled:opacity-60"
        >
          {busy ? 'Ingresando…' : 'Ingresar'}
          <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
        </button>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-[#7f90ab]">
        <span className="h-px flex-1 bg-white/10" /> ¿Eres propietario? <span className="h-px flex-1 bg-white/10" />
      </div>
      <Link to="/registro" className="block w-full rounded-xl border border-white/10 py-2.5 text-center text-sm font-medium text-white transition hover:border-[#10b981]/50 hover:bg-white/5">
        Solicitar acceso a mi residencial
      </Link>
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

  // data-theme="dark" fija los tokens oscuros en este bloque aunque el usuario use tema claro.
  return (
    <Shell wide title="Registro de propietarios" subtitle="Crea tu cuenta; la administración de tu residencial la aprobará">
      <div data-theme="dark" className="text-slate-900">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nombre completo" error={fieldErr('fullName')}><Input name="fullName" required autoComplete="name" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Correo electrónico" error={fieldErr('email')}><Input name="email" type="email" required autoComplete="email" /></Field>
            <Field label="Teléfono"><Input name="phone" type="tel" autoComplete="tel" /></Field>
            <Field label="Contraseña" hint="Mín. 8, letras y números" error={fieldErr('password')}><Input name="password" type="password" required autoComplete="new-password" /></Field>
            <Field label="Confirmar"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
          </div>
          <Field label="Residencial / complejo" error={fieldErr('complexId')}>
            <Select name="complexId" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Casa / apartamento" hint="Tal como aparece en tu recibo, p. ej. C-01" error={fieldErr('unitCode')}><Input name="unitCode" required /></Field>
          <ErrorText error={error} />
          <Button className="w-full py-3" loading={busy}>Enviar solicitud</Button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Ya tienes cuenta? <Link to="/login" className="font-medium text-link">Iniciar sesión</Link>
        </p>
      </div>
    </Shell>
  );
}
