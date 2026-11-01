import { ReactNode, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Building2, ChevronsUpDown, Clock, FileSpreadsheet, HandCoins, Home, LayoutGrid, LogOut, MapPinned, Megaphone,
  Menu, MessagesSquare, Receipt, Settings, Shield, TrendingUp, UserCheck, UserCog, Users, Wallet, Wrench, X,
} from 'lucide-react';
import { can, useAuth } from '../lib/auth';
import { ROLES } from '../lib/format';
import { cx } from './ui';

type Item = { to: string; label: string; icon: ReactNode; show?: boolean };

export function Layout() {
  const { me, complex, logout, selectComplex } = useAuth();
  const [open, setOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const role = complex?.role;
  const fin = can(role, 'finRead');
  const resident = can(role, 'resident');
  const platform: { title?: string; items: Item[] } = {
    title: 'Plataforma',
    items: [
      { to: '/plataforma/proyectos', label: 'Proyectos', icon: <Shield />, show: !!me?.isSuperAdmin },
      { to: '/plataforma/empleados', label: 'Empleados', icon: <Users />, show: !!me?.isSuperAdmin },
    ],
  };

  const groups: { title?: string; items: Item[] }[] = resident ? [
    { items: [
      { to: '/', label: 'Inicio', icon: <Home /> },
      { to: '/consultas', label: 'Mis consultas', icon: <MessagesSquare /> },
      { to: '/cuenta', label: 'Mi cuenta', icon: <UserCog /> },
    ] },
  ] : [
    platform,
    { items: [{ to: '/', label: 'Panel principal', icon: <LayoutGrid />, show: fin }] },
    { title: 'Finanzas', items: [
      { to: '/ingresos', label: 'Ingresos', icon: <HandCoins />, show: fin },
      { to: '/egresos', label: 'Egresos', icon: <Receipt />, show: fin },
      { to: '/servicios', label: 'Servicios', icon: <Wrench />, show: fin },
    ] },
    { title: 'Informes', items: [
      { to: '/informes/gastos', label: 'Gastos mensuales', icon: <FileSpreadsheet />, show: fin },
      { to: '/informes/estados', label: 'Estados financieros', icon: <BarChart3 />, show: fin },
      { to: '/informes/proyecciones', label: 'Proyecciones', icon: <TrendingUp />, show: fin },
    ] },
    { title: 'Propiedad', items: [
      { to: '/unidades', label: 'Unidades', icon: <Home />, show: fin },
      { to: '/propietarios', label: 'Propietarios', icon: <UserCheck />, show: can(role, 'manage') },
    ] },
    { title: 'Comunidad', items: [
      { to: '/avisos', label: 'Avisos y noticias', icon: <Megaphone />, show: can(role, 'manage') },
      { to: '/consultas', label: 'Consultas y reclamos', icon: <MessagesSquare />, show: can(role, 'manage') || role === 'VIEWER' },
    ] },
    { title: 'Personal', items: [
      { to: '/marcacion', label: 'Marcación', icon: <Clock />, show: !!complex },
      { to: '/personal', label: 'Empleados y horas', icon: <Users />, show: fin },
      { to: '/geocercas', label: 'Zonas de marcación', icon: <MapPinned />, show: can(role, 'manage') },
    ] },
    { title: 'Configuración', items: [
      { to: '/ajustes', label: 'Ajustes del proyecto', icon: <Settings />, show: can(role, 'manage') },
      { to: '/cuenta', label: 'Mi cuenta', icon: <UserCog /> },
    ] },
  ];

  const current = groups.flatMap((g) => g.items).find((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.to)));
  const initials = me?.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="relative p-3">
        <button onClick={() => setSwitcher((s) => !s)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white"><Building2 className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{complex?.name ?? 'Sin proyecto'}</span>
            <span className="block truncate text-xs text-slate-500">{me?.isSuperAdmin ? 'Superusuario' : ROLES[role ?? ''] ?? ''}{complex?.unitCode ? ` · ${complex.unitCode}` : ''}</span>
          </span>
          <ChevronsUpDown className="size-4 text-slate-400" />
        </button>
        {switcher && (
          <div className="absolute inset-x-3 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            {me?.complexes.filter((c) => c.status === 'ACTIVE').map((c) => (
              <button key={c.id} onClick={() => { selectComplex(c.id); setSwitcher(false); nav('/'); }} className={cx('block w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100', c.id === complex?.id && 'font-semibold text-brand-700')}>
                {c.name}
              </button>
            ))}
            {me?.isSuperAdmin && (
              <button onClick={() => { setSwitcher(false); nav('/plataforma/proyectos'); }} className="block w-full rounded-md px-3 py-2 text-left text-sm text-brand-700 hover:bg-slate-100">
                Administrar proyectos
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((g, gi) => {
          const items = g.items.filter((i) => i.show !== false);
          if (!items.length) return null;
          return (
            <div key={gi}>
              {g.title && <div className="mb-1 px-2 text-xs font-medium text-slate-500">{g.title}</div>}
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={() => setOpen(false)}
                  className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-2 py-2 text-sm [&>svg]:size-4', isActive ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-700 hover:bg-slate-50')}>
                  {i.icon}
                  {i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 border-t border-slate-100 p-3">
        <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{me?.fullName}</span>
          <span className="block truncate text-xs text-slate-500">{me?.email}</span>
        </span>
        <button onClick={() => { logout(); nav('/login'); }} title="Cerrar sesión" className="rounded-md p-2 text-slate-500 hover:bg-slate-100">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-slate-50/60 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-2 top-4 rounded-md p-1.5 text-slate-500" aria-label="Cerrar menú"><X className="size-4" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden truncate text-slate-500 sm:inline">{complex?.name}</span>
            <span className="hidden text-slate-300 sm:inline">›</span>
            <span className="truncate font-medium">{current?.label}</span>
          </div>
          <Wallet className="ml-auto size-4 text-slate-300" />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
