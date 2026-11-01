import { ButtonHTMLAttributes, FormEvent, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, useEffect } from 'react';
import { CircleHelp, Loader2, X } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-white border border-red-200 text-red-700 hover:bg-red-50',
  }[variant];
  return (
    <button {...p} disabled={p.disabled || loading} className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50', v, className)}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>((p, ref) => <input ref={ref} {...p} className={cx(inputCls, p.className)} />);
Input.displayName = 'Input';
export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(inputCls, p.className)}>
    {children}
  </select>
);

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = 'blue' | 'red' | 'amber' | 'violet' | 'green' | 'slate';
const tones: Record<Tone, { bg: string; label: string; value: string; icon: string; sub: string }> = {
  blue: { bg: 'bg-blue-50', label: 'text-blue-900', value: 'text-slate-900', icon: 'bg-blue-600', sub: 'text-blue-600' },
  red: { bg: 'bg-red-50', label: 'text-red-900', value: 'text-red-950', icon: 'bg-red-600', sub: 'text-red-600' },
  amber: { bg: 'bg-amber-50', label: 'text-amber-900', value: 'text-amber-950', icon: 'bg-amber-500', sub: 'text-amber-600' },
  violet: { bg: 'bg-violet-50', label: 'text-violet-900', value: 'text-violet-950', icon: 'bg-violet-600', sub: 'text-violet-600' },
  green: { bg: 'bg-emerald-50', label: 'text-emerald-900', value: 'text-emerald-950', icon: 'bg-emerald-600', sub: 'text-emerald-700' },
  slate: { bg: 'bg-slate-50', label: 'text-slate-700', value: 'text-slate-900', icon: 'bg-slate-600', sub: 'text-slate-500' },
};

/** Tarjeta KPI al estilo del panel de referencia. */
export function Kpi({ label, value, sub, icon, tone = 'blue', help }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: Tone; help?: string }) {
  const t = tones[tone];
  return (
    <div className={cx('rounded-xl p-5', t.bg)}>
      <div className="flex items-start justify-between">
        <span className={cx('flex items-center gap-1.5 text-sm font-semibold', t.label)}>
          {label}
          {help && (
            <span title={help}>
              <CircleHelp className="size-3.5 opacity-60" />
            </span>
          )}
        </span>
        <span className={cx('grid size-8 place-items-center rounded-full text-white [&>svg]:size-4', t.icon)}>{icon}</span>
      </div>
      <div className={cx('mt-3 text-3xl font-bold tracking-tight', t.value)}>{value}</div>
      {sub && <div className={cx('mt-2 text-xs', t.sub)}>{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: Tone }) {
  const c = { blue: 'bg-blue-100 text-blue-800', red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800', violet: 'bg-violet-100 text-violet-800', green: 'bg-emerald-100 text-emerald-800', slate: 'bg-slate-100 text-slate-700' }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', c)}>{children}</span>;
}

export function Alert({ tone = 'blue', icon, children, action }: { tone?: 'blue' | 'amber' | 'red' | 'green'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const c = { blue: 'border-blue-200 bg-blue-50 text-blue-900', amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-900', green: 'border-emerald-200 bg-emerald-50 text-emerald-900' }[tone];
  return (
    <div className={cx('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm', c)}>
      {icon && <span className="[&>svg]:size-4">{icon}</span>}
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

/** Tabla responsive: en móvil hace scroll horizontal dentro de la tarjeta, nunca la página. */
export function Table<T>({ rows, columns, empty = 'Sin registros', rowKey }: { rows: T[]; rowKey: (r: T) => string; empty?: string; columns: { header: string; cell: (r: T) => ReactNode; align?: 'right'; className?: string }[] }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.header} className={cx('px-5 py-2.5 font-medium', c.align === 'right' && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
              {columns.map((c) => (
                <td key={c.header} className={cx('px-5 py-3', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="py-10 text-center text-sm text-slate-500">{children}</div>;
export const Spinner = () => (
  <div className="grid place-items-center py-16 text-slate-400">
    <Loader2 className="size-6 animate-spin" />
  </div>
);
export const ErrorText = ({ error }: { error: unknown }) => (error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p> : null);

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Lee un <form> como objeto plano. */
export const formData = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
