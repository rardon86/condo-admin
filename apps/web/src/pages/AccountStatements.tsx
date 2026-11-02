import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarClock, HandCoins, Printer, Receipt, Scale } from 'lucide-react';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateLabel, money, monthLabel, today } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, Field, Input, Kpi, PageHeader, Spinner, Table, Tone } from '../components/ui';

type Period = { from: string; to: string; months: number; asOf: string };

interface Summary {
  complex: { name: string; currency: string };
  period: Period;
  totals: { units: number; charges: number; paid: number; balance: number; overdue: number; unitsInArrears: number };
  unassigned: { count: number; amount: number };
  rows: { unitId: string; code: string; ownerName: string | null; monthlyFee: number; charges: number; paid: number; balance: number; overdueMonths: number; overdue: number }[];
}

export interface UnitStatement {
  complex: { name: string; currency: string };
  period: Period;
  unit: { id: string; code: string; type: string; monthlyFee: number; active: boolean };
  owner: { name: string | null; email: string | null; phone: string | null };
  residents: { fullName: string; email: string; phone: string | null }[];
  summary: { charges: number; paid: number; balance: number; overdueMonths: number; overdue: number };
  months: { month: string; label: string; charge: number; paid: number; status: 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'SIN_CARGO'; overdue: boolean }[];
  lines: { date: string; kind: 'CARGO' | 'ABONO'; concept: string; charge: number; payment: number; balance: number; reference: string | null }[];
  otherPayments: { id: string; date: string; concept: string; category: string; amount: number; reference: string | null }[];
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  PAGADO: { label: 'Pagado', tone: 'green' },
  PARCIAL: { label: 'Parcial', tone: 'amber' },
  PENDIENTE: { label: 'Pendiente', tone: 'slate' },
  SIN_CARGO: { label: 'Sin cargo', tone: 'slate' },
};

/** Saldo: positivo = pendiente de pago; negativo = saldo a favor. */
const Balance = ({ v }: { v: number }) =>
  v > 0 ? <span className="font-semibold text-red-600">{money(v)}</span> : v < 0 ? <span className="font-semibold text-emerald-600">{money(-v)} a favor</span> : <span className="text-slate-500">{money(0)}</span>;

/** Periodo por defecto: enero del año en curso → mes actual. */
function usePeriod() {
  const cur = today().slice(0, 7);
  return useState({ from: `${cur.slice(0, 4)}-01`, to: cur });
}

function PeriodFields({ value, onChange }: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 print:hidden">
      <Field label="Desde"><Input type="month" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} /></Field>
      <Field label="Hasta"><Input type="month" value={value.to} min={value.from} max={today().slice(0, 7)} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} /></Field>
    </div>
  );
}

const PrintButton = () => <Button variant="secondary" className="print:hidden" onClick={() => window.print()}><Printer className="size-4" />Imprimir / PDF</Button>;

/** Resumen de cuentas por unidad: quién debe, cuánto y desde cuándo. */
export function AccountStatementsPage() {
  const { complex } = useAuth();
  const [period, setPeriod] = usePeriod();
  const [filter, setFilter] = useState<'all' | 'arrears'>('all');
  const { data: r, isLoading, error } = useQuery({ queryKey: ['unit-statements', period], queryFn: () => get<Summary>('/reports/unit-statements', period) });
  const rows = r ? (filter === 'arrears' ? r.rows.filter((x) => x.overdueMonths > 0) : r.rows) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estado de cuenta por unidad"
        subtitle={`${complex?.name ?? ''}${r ? ` · ${monthLabel(r.period.from)} a ${monthLabel(r.period.to)}` : ''}`}
        actions={<PrintButton />}
      />
      <Card><PeriodFields value={period} onChange={setPeriod} /></Card>
      {isLoading ? <Spinner /> : error || !r ? <ErrorText error={error} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Cuotas del periodo" tone="blue" icon={<Receipt />} value={money(r.totals.charges)} sub={`${r.totals.units} unidades · ${r.period.months} meses`} />
            <Kpi label="Pagado" tone="green" icon={<HandCoins />} value={money(r.totals.paid)} sub="Pagos de cuotas registrados a cada unidad" />
            <Kpi label="Saldo pendiente" tone={r.totals.balance > 0 ? 'red' : 'green'} icon={<Scale />} value={money(r.totals.balance)} sub="Incluye el mes en curso" />
            <Kpi label="En mora" tone="amber" icon={<AlertTriangle />} value={money(r.totals.overdue)} sub={`${r.totals.unitsInArrears} unidades con meses vencidos`} />
          </div>
          {r.unassigned.count > 0 && (
            <Alert tone="amber" icon={<AlertTriangle />} action={<Link to="/ingresos" className="font-medium underline print:hidden">Ver ingresos</Link>}>
              Hay {r.unassigned.count} {r.unassigned.count === 1 ? 'pago' : 'pagos'} de cuotas por {money(r.unassigned.amount)} sin unidad asignada en el periodo.
              No se acreditan a ninguna cuenta: registre los ingresos de cuotas indicando la unidad.
            </Alert>
          )}
          <Card
            title="Unidades"
            actions={
              <div className="flex gap-1 print:hidden">
                <Button variant={filter === 'all' ? 'primary' : 'ghost'} onClick={() => setFilter('all')}>Todas</Button>
                <Button variant={filter === 'arrears' ? 'primary' : 'ghost'} onClick={() => setFilter('arrears')}>Solo en mora</Button>
              </div>
            }
          >
            <Table rows={rows} rowKey={(x) => x.unitId} empty="Ninguna unidad en mora"
              columns={[
                { header: 'Unidad', cell: (x) => <Link className="font-medium text-link hover:underline" to={`/informes/estado-cuenta/${x.unitId}?from=${r.period.from}&to=${r.period.to}`}>{x.code}</Link> },
                { header: 'Propietario', cell: (x) => x.ownerName ?? <span className="text-slate-400">—</span> },
                { header: 'Cuota', align: 'right', cell: (x) => money(x.monthlyFee) },
                { header: 'Cargos', align: 'right', cell: (x) => money(x.charges) },
                { header: 'Pagado', align: 'right', cell: (x) => money(x.paid) },
                { header: 'Saldo', align: 'right', cell: (x) => <Balance v={x.balance} /> },
                { header: 'Mora', align: 'right', cell: (x) => (x.overdueMonths ? <Badge tone={x.overdueMonths >= 3 ? 'red' : 'amber'}>{x.overdueMonths} {x.overdueMonths === 1 ? 'mes' : 'meses'}</Badge> : <Badge tone="green">Al día</Badge>) },
              ]} />
          </Card>
          <Note />
        </>
      )}
    </div>
  );
}

const Note = () => (
  <p className="text-xs text-slate-500">
    Cargos calculados con la cuota mensual vigente de cada unidad. Los pagos de cuotas se aplican primero a los meses más antiguos.
    Un mes cuenta como vencido cuando ya cerró sin pagarse completo.
  </p>
);

/** Estado de cuenta de una unidad (vista interna). */
export function UnitStatementPage() {
  const { unitId } = useParams();
  const [params] = useSearchParams();
  const [def] = usePeriod();
  // Conserva el periodo con el que se abrió desde el resumen
  const [period, setPeriod] = useState({ from: params.get('from') ?? def.from, to: params.get('to') ?? def.to });
  const { data, isLoading, error } = useQuery({ queryKey: ['unit-statement', unitId, period], queryFn: () => get<UnitStatement>(`/reports/unit-statements/${unitId}`, period) });
  return (
    <div className="space-y-6">
      <Link to="/informes/estado-cuenta" className="inline-flex items-center gap-1 text-sm text-link hover:underline print:hidden"><ArrowLeft className="size-4" />Todas las unidades</Link>
      <StatementView data={data} isLoading={isLoading} error={error} period={period} onPeriod={setPeriod} />
    </div>
  );
}

/** Estado de cuenta del propietario (portal, solo su unidad). */
export function MyStatementPage() {
  const [period, setPeriod] = usePeriod();
  const { data, isLoading, error } = useQuery({ queryKey: ['my-statement', period], queryFn: () => get<UnitStatement>('/portal/statement', period) });
  return <StatementView data={data} isLoading={isLoading} error={error} period={period} onPeriod={setPeriod} />;
}

function StatementView({ data: d, isLoading, error, period, onPeriod }: { data?: UnitStatement; isLoading: boolean; error: unknown; period: { from: string; to: string }; onPeriod: (v: { from: string; to: string }) => void }) {
  const owners = d ? [d.owner.name, ...d.residents.map((x) => x.fullName)].filter((x, i, a) => x && a.indexOf(x) === i) : [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={d ? `Estado de cuenta · ${d.unit.code}` : 'Estado de cuenta'}
        subtitle={d ? `${d.complex.name} · ${monthLabel(d.period.from)} a ${monthLabel(d.period.to)} · al ${dateLabel(d.period.asOf)}` : undefined}
        actions={<PrintButton />}
      />
      <Card><PeriodFields value={period} onChange={onPeriod} /></Card>
      {isLoading ? <Spinner /> : error || !d ? <ErrorText error={error} /> : (
        <>
          <Card>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-slate-500">Propietario</dt><dd className="font-medium text-slate-900">{owners.length ? owners.join(' · ') : '—'}</dd></div>
              <div><dt className="text-slate-500">Contacto</dt><dd className="text-slate-900">{[d.owner.email ?? d.residents[0]?.email, d.owner.phone ?? d.residents[0]?.phone].filter(Boolean).join(' · ') || '—'}</dd></div>
              <div><dt className="text-slate-500">Cuota mensual</dt><dd className="font-medium text-slate-900">{money(d.unit.monthlyFee)}</dd></div>
            </dl>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Cargos" tone="blue" icon={<Receipt />} value={money(d.summary.charges)} sub={`${d.period.months} ${d.period.months === 1 ? 'mes' : 'meses'}`} />
            <Kpi label="Pagado" tone="green" icon={<HandCoins />} value={money(d.summary.paid)} />
            <Kpi label={d.summary.balance < 0 ? 'Saldo a favor' : 'Saldo pendiente'} tone={d.summary.balance > 0 ? 'red' : 'green'} icon={<Scale />} value={money(Math.abs(d.summary.balance))} />
            <Kpi label="Vencido" tone={d.summary.overdueMonths ? 'amber' : 'green'} icon={<CalendarClock />} value={money(d.summary.overdue)}
              sub={d.summary.overdueMonths ? `${d.summary.overdueMonths} ${d.summary.overdueMonths === 1 ? 'mes vencido' : 'meses vencidos'}` : 'Al día'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card title="Por mes" className="lg:col-span-2">
              <Table rows={d.months} rowKey={(m) => m.month}
                columns={[
                  { header: 'Mes', cell: (m) => <span className="capitalize">{m.label}</span> },
                  { header: 'Cuota', align: 'right', cell: (m) => money(m.charge) },
                  { header: 'Aplicado', align: 'right', cell: (m) => money(m.paid) },
                  { header: 'Estado', cell: (m) => <Badge tone={m.overdue ? 'red' : STATUS[m.status].tone}>{m.overdue ? 'Vencido' : STATUS[m.status].label}</Badge> },
                ]} />
            </Card>
            <Card title="Movimientos" className="lg:col-span-3">
              <Table rows={d.lines} rowKey={(l) => `${l.date}-${l.kind}-${l.concept}-${l.balance}`} empty="Sin cargos ni pagos en el periodo"
                columns={[
                  { header: 'Fecha', cell: (l) => dateLabel(l.date) },
                  { header: 'Concepto', cell: (l) => <><div>{l.concept}</div>{l.reference && <div className="text-xs text-slate-500">Ref. {l.reference}</div>}</> },
                  { header: 'Cargo', align: 'right', cell: (l) => (l.charge ? money(l.charge) : '') },
                  { header: 'Abono', align: 'right', cell: (l) => (l.payment ? <span className="text-emerald-600">{money(l.payment)}</span> : '') },
                  { header: 'Saldo', align: 'right', cell: (l) => <Balance v={l.balance} /> },
                ]} />
            </Card>
          </div>

          {d.otherPayments.length > 0 && (
            <Card title="Otros pagos de la unidad">
              <Table rows={d.otherPayments} rowKey={(o) => o.id}
                columns={[
                  { header: 'Fecha', cell: (o) => dateLabel(o.date) },
                  { header: 'Concepto', cell: (o) => <><div>{o.concept}</div><div className="text-xs text-slate-500">{o.category}</div></> },
                  { header: 'Monto', align: 'right', cell: (o) => money(o.amount) },
                ]} />
              <p className="mt-3 text-xs text-slate-500">Alquileres, servicios y otros cobros: se muestran como referencia y no abonan a las cuotas.</p>
            </Card>
          )}
          <Note />
        </>
      )}
    </div>
  );
}
