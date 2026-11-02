import { ReactNode, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, ChevronsUpDown, Clock, FileSpreadsheet, HandCoins, Home, LayoutGrid, LogOut, MapPinned, Megaphone,
  Menu, MessagesSquare, Moon, PanelLeftClose, PanelLeftOpen, Receipt, ScrollText, Settings, Shield, Sun, TrendingUp, UserCheck, UserCog, Users, Wrench, X,
} from 'lucide-react';
import { can, useAuth } from '../lib/auth';
import { ROLES } from '../lib/format';
import { useTheme } from '../lib/theme';
import { ProjectLogo } from './ProjectLogo';
import { cx } from './ui';
import { SUPPORT_EMAIL } from './Brand';

type Item = { to: string; label: string; icon: ReactNode; show?: boolean };

export function Layout() {
  const { me, complex, logout, selectComplex } = useAuth();
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  // Menú lateral plegable en escritorio (se recuerda en este navegador)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* sin almacenamiento */
    }
  }, [collapsed]);
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
      { to: '/estado-de-cuenta', label: 'Estado de cuenta', icon: <ScrollText /> },
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
      { to: '/informes/estado-cuenta', label: 'Estado de cuenta', icon: <ScrollText />, show: fin },
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

  /** Barra lateral en tonos medianoche (igual en ambos temas). `mini` = solo íconos; `onClose` = cajón móvil. */
  const sidebar = (mini: boolean, onClose?: () => void) => (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div className={cx('relative flex items-center gap-1', mini ? 'p-2' : 'p-3')}>
        <button
          onClick={() => !mini && setSwitcher((s) => !s)}
          title={complex?.name}
          className={cx('flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left transition hover:bg-sidebar-2', mini && 'justify-center')}
        >
          <ProjectLogo id={complex?.id} version={complex?.logoVersion} className="size-9" />
          {!mini && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{complex?.name ?? 'Sin proyecto'}</span>
                <span className="block truncate text-xs text-sidebar-muted">
                  {me?.isSuperAdmin ? 'Superusuario' : ROLES[role ?? ''] ?? ''}
                  {complex?.unitCode ? ` · ${complex.unitCode}` : ''}
                </span>
              </span>
              <ChevronsUpDown className="size-4 text-sidebar-muted" />
            </>
          )}
        </button>
        {onClose && (
          <button onClick={onClose} className="shrink-0 rounded-md p-2 text-sidebar-muted hover:bg-white/5 hover:text-white" aria-label="Cerrar menú">
            <X className="size-4" />
          </button>
        )}
        {switcher && !mini && (
          <div className="absolute inset-x-3 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-sidebar-2 p-1 shadow-2xl">
            {me?.complexes.filter((c) => c.status === 'ACTIVE').map((c) => (
              <button
                key={c.id}
                onClick={() => { selectComplex(c.id); setSwitcher(false); nav('/'); }}
                className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5', c.id === complex?.id && 'font-semibold text-brand-400')}
              >
                <ProjectLogo id={c.id} version={c.logoVersion} className="size-6" />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            {me?.isSuperAdmin && (
              <button onClick={() => { setSwitcher(false); nav('/plataforma/proyectos'); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-brand-400 hover:bg-white/5">
                Administrar proyectos
              </button>
            )}
          </div>
        )}
      </div>

      <nav className={cx('flex-1 space-y-5 overflow-y-auto pb-4', mini ? 'px-2' : 'px-3')}>
        {groups.map((g, gi) => {
          const items = g.items.filter((i) => i.show !== false);
          if (!items.length) return null;
          return (
            <div key={gi}>
              {g.title && !mini && <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{g.title}</div>}
              {g.title && mini && <div className="mx-auto mb-2 h-px w-6 bg-white/10" />}
              {items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === '/'}
                  title={mini ? i.label : undefined}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'relative flex items-center gap-3 rounded-lg py-2 text-sm transition [&>svg]:size-[18px] [&>svg]:shrink-0',
                      mini ? 'justify-center px-0' : 'px-2.5',
                      isActive
                        ? 'bg-gradient-to-r from-brand-600/25 to-brand-600/5 font-medium text-white before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand-400'
                        : 'text-sidebar-fg hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  {i.icon}
                  {!mini && i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className={cx('flex items-center gap-3 border-t border-white/10 p-3', mini && 'flex-col gap-2')}>
        <span title={me?.fullName} className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-aror text-xs font-semibold text-white">{initials}</span>
        {!mini && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{me?.fullName}</span>
            <span className="block truncate text-xs text-sidebar-muted">{me?.username ?? me?.email}</span>
          </span>
        )}
        <button onClick={() => { logout(); nav('/login'); }} title="Cerrar sesión" className="rounded-md p-2 text-sidebar-muted hover:bg-white/5 hover:text-white">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className={cx('hidden shrink-0 border-r border-black/20 transition-[width] duration-200 lg:block print:hidden', collapsed ? 'w-[72px]' : 'w-64')}>
        {sidebar(collapsed)}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">
            {sidebar(false, () => setOpen(false))}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center gap-2 border-b border-slate-200 bg-canvas/85 px-3 backdrop-blur sm:px-4">
          <button onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Abrir menú">
            <Menu className="size-5" />
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:block"
            aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden truncate text-slate-500 sm:inline">{complex?.name}</span>
            {complex && <span className="hidden text-slate-300 sm:inline">/</span>}
            <span className="truncate font-medium text-slate-900">{current?.label}</span>
          </div>
          <button
            onClick={toggle}
            className="ml-auto rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            aria-label="Cambiar tema"
          >
            {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
          <footer className="mx-auto max-w-7xl px-4 pb-6 pt-2 text-center text-xs text-slate-400 sm:px-6">
            © {new Date().getFullYear()} AROR Consulting · Soporte: <a className="hover:text-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
