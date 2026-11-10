import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Home, MessageSquarePlus, Pin, Receipt, Wallet } from 'lucide-react';
import { get, OFFLINE_MESSAGE } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateLabel, dateTime, money } from '../lib/format';
import { useCatalog } from '../lib/catalogs';
import { Badge, Button, Card, Empty, ErrorText, PageHeader, Spinner, Table, Tone, cx } from '../components/ui';
import { NewTicketModal } from './Tickets';
import { ProjectLogo } from '../components/ProjectLogo';

interface Portal {
  complex: { name: string; address: string | null };
  properties: { id: string; code: string; type: string; address: string | null; monthlyFee: string; balance: { balance: number; overdue: number } }[];
  /** Total de todas sus propiedades. */
  balance: { balance: number; overdue: number } | null;
  news: { id: string; title: string; body: string; category: string; pinned: boolean; publishedAt: string }[];
  payments: { id: string; date: string; amount: number; concept: string; description: string | null; reference: string | null; receiptNumber: string | null; unitCode: string }[];
  tickets: { open: number; total: number };
}

export const CATEGORY_TONE: Record<string, Tone> = { AVISO: 'blue', MANTENIMIENTO: 'amber', ASAMBLEA: 'violet', SEGURIDAD: 'red', EVENTO: 'green', FINANZAS: 'slate' };

/** Inicio del propietario: noticias del complejo, su propiedad, su estado de cuenta y acceso rápido a consultas. Solo lectura. */
export function PortalPage() {
  const { me, complex } = useAuth();
  const [newTicket, setNewTicket] = useState(false);
  const cats = useCatalog('NEWS_CATEGORY');
  const { data, isLoading, error } = useQuery({ queryKey: ['portal'], queryFn: () => get<Portal>('/portal') });
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorText error={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-gradient-to-r from-brand-50 via-surface to-blue-50 p-4">
        <ProjectLogo id={complex?.id} version={complex?.logoVersion} className="size-14" />
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-bold text-slate-900">{data.complex.name}</div>
          {data.complex.address && <div className="truncate text-sm text-slate-500">{data.complex.address}</div>}
        </div>
      </div>
      <PageHeader
        title={`Hola, ${me?.fullName.split(' ')[0]}`}
        subtitle="Avisos de tu residencial, tu estado de cuenta y tus consultas"
        actions={<Button onClick={() => setNewTicket(true)}><MessageSquarePlus className="size-4" />Nueva consulta o reclamo</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-2 text-sm text-slate-500"><Home className="size-4" />{data.properties.length > 1 ? 'Mis propiedades' : 'Mi propiedad'}</div>
          <div className="mt-1 text-2xl font-bold">{data.properties.length ? data.properties.map((p) => p.code).join(', ') : '—'}</div>
          {data.properties.length === 1 && <div className="text-xs text-slate-500">Cuota mensual {money(data.properties[0].monthlyFee)}</div>}
          {data.properties.length === 1 && data.properties[0].address && <div className="mt-1 truncate text-xs text-slate-500" title={data.properties[0].address}>{data.properties[0].address}</div>}
          {data.properties.length > 1 && data.properties.map((p) => (
            <div key={p.id} className="text-xs text-slate-500">{p.code}: {p.balance.balance > 0 ? <span className="text-red-600">debe {money(p.balance.balance)}</span> : p.balance.balance < 0 ? `${money(-p.balance.balance)} a favor` : 'al día'}</div>
          ))}
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm text-slate-500"><Wallet className="size-4" />{data.balance && data.balance.balance < 0 ? 'Saldo a favor' : 'Saldo pendiente'}</div>
          <div className={cx('mt-1 text-2xl font-bold', data.balance && data.balance.balance > 0 && 'text-red-600')}>{data.balance ? money(Math.abs(data.balance.balance)) : '—'}</div>
          {data.balance && (data.balance.overdue > 0
            ? <div className="text-xs text-red-600">Vencido {money(data.balance.overdue)}</div>
            : <div className="text-xs text-emerald-600">Al día</div>)}
          <Link to="/estado-de-cuenta" className="text-xs text-link">Ver estado de cuenta</Link>
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm text-slate-500"><Receipt className="size-4" />Último pago</div>
          <div className="mt-1 text-2xl font-bold">{data.payments[0] ? money(data.payments[0].amount) : '—'}</div>
          {data.payments[0] && <div className="text-xs text-slate-500">{dateLabel(data.payments[0].date)}</div>}
        </Card>
        <Card>
          <div className="flex items-center gap-2 text-sm text-slate-500"><MessageSquarePlus className="size-4" />Mis consultas</div>
          <div className="mt-1 text-2xl font-bold">{data.tickets.open} abiertas</div>
          <Link to="/consultas" className="text-xs text-link">Ver todas ({data.tickets.total})</Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <h2 className="flex items-center gap-2 font-semibold"><Bell className="size-4" />Avisos y noticias</h2>
          {data.news.length === 0 && <Card><Empty>No hay avisos publicados.</Empty></Card>}
          {data.news.map((n) => (
            <article key={n.id} className="rounded-xl border border-slate-200 bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={CATEGORY_TONE[n.category] ?? 'slate'}>{cats.label(n.category)}</Badge>
                {n.pinned && <span className="flex items-center gap-1 text-xs text-slate-500"><Pin className="size-3" />Fijado</span>}
                <span className="ml-auto text-xs text-slate-500">{dateTime(n.publishedAt)}</span>
              </div>
              <h3 className="mt-2 text-lg font-semibold">{n.title}</h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{n.body}</p>
            </article>
          ))}
        </div>
        <div className="lg:col-span-2">
          <Card title="Mis pagos registrados">
            <Table
              rows={data.payments}
              rowKey={(p) => p.id}
              empty="Aún no hay pagos registrados a tu propiedad."
              columns={[
                { header: 'Fecha', cell: (p) => <span className="whitespace-nowrap">{dateLabel(p.date)}</span> },
                { header: 'Concepto', cell: (p) => <><div>{p.description ?? p.concept}</div><div className="text-xs text-slate-500">{[data.properties.length > 1 && p.unitCode, p.receiptNumber && `Recibo N.º ${p.receiptNumber}`].filter(Boolean).join(' · ')}</div></> },
                { header: 'Monto', align: 'right', cell: (p) => money(p.amount) },
              ]}
            />
          </Card>
        </div>
      </div>

      <NewTicketModal open={newTicket} onClose={() => setNewTicket(false)} />
    </div>
  );
}

/** Fuera del horario de servicio la API está apagada; la sesión se conserva para cuando vuelva. */
export function OfflinePage() {
  const { reload } = useAuth();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="grid min-h-full place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold">Fuera de horario</h1>
        <p className="mt-3 text-sm text-slate-600">{OFFLINE_MESSAGE}</p>
        <Button variant="secondary" className="mt-6" loading={retrying} onClick={async () => { setRetrying(true); await reload(); setRetrying(false); }}>Reintentar</Button>
      </div>
    </div>
  );
}

/** Pantalla para cuentas aún no aprobadas o sin proyecto. */
export function PendingPage({ reason }: { reason: 'pending' | 'none' | 'rejected' }) {
  const { logout, me } = useAuth();
  const text = {
    pending: 'Tu solicitud fue enviada. La administración de tu residencial debe aprobarla y asignarte tu propiedad; luego podrás ver avisos, tus pagos y enviar consultas.',
    rejected: 'Tu solicitud no fue aprobada. Comunícate con la administración de tu residencial.',
    none: 'Tu usuario aún no está asociado a ningún proyecto. Pide a la administración que te dé acceso.',
  }[reason];
  return (
    <div className="grid min-h-full place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold">{reason === 'pending' ? 'Solicitud en revisión' : 'Sin acceso'}</h1>
        <p className="mt-3 text-sm text-slate-600">{text}</p>
        <p className="mt-4 text-xs text-slate-400">{me?.email}</p>
        <Button variant="secondary" className="mt-6" onClick={logout}>Cerrar sesión</Button>
      </div>
    </div>
  );
}
