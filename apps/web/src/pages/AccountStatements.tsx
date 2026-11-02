import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CalendarClock, HandCoins, History, Printer, Receipt, Scale } from 'lucide-react';
import { get } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { CHARGE_KINDS, CHARGE_STATUS, dateLabel, money, monthLabel, today } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, Input, Kpi, PageHeader, Spinner, Table } from '../components/ui';
import { ExcelButton } from '../components/ExcelButton';
import { downloadXlsx } from '../lib/xlsx';

type Period = { from: string; to: string; months: number; asOf: string };

interface Summary {
  complex: { name: string; currency: string };
  period: Period;
  totals: { units: number; opening: number; charges: number; paid: number; balance: number; overdue: number; unitsInArrears: number };
  rows: { unitId: string; code: string; address: string | null; ownerName: string | null; monthlyFee: number; opening: number; charges: number; paid: number; balance: number; overdue: number; overdueCount: number }[];
}

export interface UnitStatement {
  complex: { name: string; currency: string };
  period: Period;
  unit: { id: string; code: string; type: string; address: string | null; monthlyFee: number; active: boolean };
  owner: { name: string | null; email: string | null; phone: string | null };
  residents: { fullName: string; email: string; phone: string | null }[];
  summary: { opening: number; charges: number; paid: number; balance: number; overdue: number; overdueCount: number };
  charges: { id: string; kind?: string; description: string; issueDate: string; dueDate: string; amount: number; paid: number; outstanding: number; status: string; applications: { date: string; amount: number; receiptNumber: string | null }[] }[];
  lines: { date: string; kind: 'SALDO' | 'CARGO' | 'ABONO'; concept: string; charge: number; payment: number; balance: number; receiptNumber: string | null }[];
  otherPayments: { id: string; date: string; concept: string; category: string; amount: number; receiptNumber: string | null }[];
}

/** Saldo: positivo = pendiente de pago; negativo = saldo a favor. */
const Balance = ({ v }: { v: number }) =>
  v > 0 ? <span className="font-semibold text-red-600">{money(v)}</span> : v < 0 ? <span className="font-semibold text-emerald-600">{money(-v)} a favor</span> : <span className="text-slate-500">{money(0)}</span>;

/** Periodo por defecto: enero del año en curso → mes actual. */
function defaultPeriod() {
  const cur = today().slice(0, 7);
  return { from: `${cur.slice(0, 4)}-01`, to: cur };
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

/** Resumen de cuentas por propiedad: quién debe, cuánto y desde cuándo. */
export function AccountStatementsPage() {
  const { complex } = useAuth();
  const [period, setPeriod] = useState(defaultPeriod);
  const [filter, setFilter] = useState<'all' | 'arrears'>('all');
  const { data: r, isLoading, error } = useQuery({ queryKey: ['unit-statements', period], queryFn: () => get<Summary>('/reports/unit-statements', period) });
  const rows = r ? (filter === 'arrears' ? r.rows.filter((x) => x.overdue > 0) : r.rows) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estado de cuenta por propiedad"
        subtitle={`${complex?.name ?? ''}${r ? ` · ${monthLabel(r.period.from)} a ${monthLabel(r.period.to)}` : ''}`}
        actions={<><ExcelButton disabled={!r} onClick={() => r && exportSummary(r)} /><PrintButton /></>}
      />
      <Card><PeriodFields value={period} onChange={setPeriod} /></Card>
      {isLoading ? <Spinner /> : error || !r ? <ErrorText error={error} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Cargos del periodo" tone="blue" icon={<Receipt />} value={money(r.totals.charges)} sub={`${r.totals.units} propiedades · saldo anterior ${money(r.totals.opening)}`} />
            <Kpi label="Pagado" tone="green" icon={<HandCoins />} value={money(r.totals.paid)} sub="Pagos de cuotas con recibo" />
            <Kpi label="Saldo por cobrar" tone={r.totals.balance > 0 ? 'red' : 'green'} icon={<Scale />} value={money(r.totals.balance)} sub="Neto de saldos a favor" />
            <Kpi label="En mora" tone="amber" icon={<AlertTriangle />} value={money(r.totals.overdue)} sub={`${r.totals.unitsInArrears} propiedades con cargos vencidos`} />
          </div>
          <Card
            title="Propiedades"
            actions={
              <div className="flex gap-1 print:hidden">
                <Button variant={filter === 'all' ? 'primary' : 'ghost'} onClick={() => setFilter('all')}>Todas</Button>
                <Button variant={filter === 'arrears' ? 'primary' : 'ghost'} onClick={() => setFilter('arrears')}>Solo en mora</Button>
              </div>
            }
          >
            <Table rows={rows} rowKey={(x) => x.unitId} empty="Ninguna propiedad en mora"
              columns={[
                { header: 'Propiedad', cell: (x) => <Link className="font-medium text-link hover:underline" to={`/informes/estado-cuenta/${x.unitId}?from=${r.period.from}&to=${r.period.to}`}>{x.code}</Link> },
                { header: 'Propietario', cell: (x) => x.ownerName ?? <span className="text-slate-400">—</span> },
                { header: 'Saldo anterior', align: 'right', cell: (x) => <Balance v={x.opening} /> },
                { header: 'Cargos', align: 'right', cell: (x) => money(x.charges) },
                { header: 'Pagado', align: 'right', cell: (x) => money(x.paid) },
                { header: 'Saldo', align: 'right', cell: (x) => <Balance v={x.balance} /> },
                { header: 'Mora', align: 'right', cell: (x) => (x.overdue > 0 ? <Badge tone={x.overdueCount >= 3 ? 'red' : 'amber'}>{money(x.overdue)} · {x.overdueCount} {x.overdueCount === 1 ? 'cargo' : 'cargos'}</Badge> : <Badge tone="green">Al día</Badge>) },
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
    Saldo = saldo anterior + cargos del periodo − pagos del periodo. Los pagos se aplican primero a los cargos más antiguos; lo que sobra queda
    como saldo a favor. Un cargo está vencido cuando pasó su fecha de vencimiento sin pagarse completo.
  </p>
);

/** Estado de cuenta de una propiedad (vista interna). */
export function UnitStatementPage() {
  const { unitId } = useParams();
  const { complex } = useAuth();
  const [params] = useSearchParams();
  // Conserva el periodo con el que se abrió desde el resumen
  const [period, setPeriod] = useState(() => ({ from: params.get('from') ?? defaultPeriod().from, to: params.get('to') ?? defaultPeriod().to }));
  const { data, isLoading, error } = useQuery({ queryKey: ['unit-statement', unitId, period], queryFn: () => get<UnitStatement>(`/reports/unit-statements/${unitId}`, period) });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to="/informes/estado-cuenta" className="inline-flex items-center gap-1 text-sm text-link hover:underline"><ArrowLeft className="size-4" />Todas las propiedades</Link>
        {can(complex?.role, 'finWrite') && <Link to={`/cuotas?pagar=${unitId}`}><Button><HandCoins className="size-4" />Registrar pago</Button></Link>}
      </div>
      <StatementView data={data} isLoading={isLoading} error={error} period={period} onPeriod={setPeriod} />
    </div>
  );
}

/** Estado de cuenta del propietario (portal, solo su propiedad). */
export function MyStatementPage() {
  const [period, setPeriod] = useState(defaultPeriod);
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
        actions={<><ExcelButton disabled={!d} onClick={() => d && exportUnit(d)} /><PrintButton /></>}
      />
      <Card><PeriodFields value={period} onChange={onPeriod} /></Card>
      {isLoading ? <Spinner /> : error || !d ? <ErrorText error={error} /> : (
        <>
          <Card>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-slate-500">Propietario</dt><dd className="font-medium text-slate-900">{owners.length ? owners.join(' · ') : '—'}</dd></div>
              <div><dt className="text-slate-500">Dirección</dt><dd className="text-slate-900">{d.unit.address || '—'}</dd></div>
              <div><dt className="text-slate-500">Contacto</dt><dd className="text-slate-900">{[d.owner.email ?? d.residents[0]?.email, d.owner.phone ?? d.residents[0]?.phone].filter(Boolean).join(' · ') || '—'}</dd></div>
              <div><dt className="text-slate-500">Cuota mensual</dt><dd className="font-medium text-slate-900">{money(d.unit.monthlyFee)}</dd></div>
            </dl>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Saldo anterior" tone="slate" icon={<History />} value={money(d.summary.opening)} sub={`Antes de ${monthLabel(d.period.from)}`} />
            <Kpi label="Cargos" tone="blue" icon={<Receipt />} value={money(d.summary.charges)} sub={`Pagado ${money(d.summary.paid)}`} />
            <Kpi label={d.summary.balance < 0 ? 'Saldo a favor' : 'Saldo pendiente'} tone={d.summary.balance > 0 ? 'red' : 'green'} icon={<Scale />} value={money(Math.abs(d.summary.balance))} />
            <Kpi label="Vencido hoy" tone={d.summary.overdue > 0 ? 'amber' : 'green'} icon={<CalendarClock />} value={money(d.summary.overdue)}
              sub={d.summary.overdueCount ? `${d.summary.overdueCount} ${d.summary.overdueCount === 1 ? 'cargo vencido' : 'cargos vencidos'}` : 'Al día'} />
          </div>

          <Card title="Cargos del periodo">
            <Table rows={d.charges} rowKey={(c) => c.id} empty="Sin cargos en el periodo"
              columns={[
                { header: 'Concepto', cell: (c) => <><div>{c.description}</div><div className="text-xs text-slate-500">{c.kind ? CHARGE_KINDS[c.kind] : ''}</div></> },
                { header: 'Vence', cell: (c) => <span className="whitespace-nowrap">{dateLabel(c.dueDate)}</span> },
                { header: 'Monto', align: 'right', cell: (c) => money(c.amount) },
                { header: 'Pagado', align: 'right', cell: (c) => money(c.paid) },
                { header: 'Fecha de aplicación', cell: (c) => c.applications.length ? (
                  <div className="space-y-0.5">
                    {c.applications.map((a, i) => (
                      <div key={i} className="whitespace-nowrap text-xs">{dateLabel(a.date)} · {money(a.amount)}{a.receiptNumber ? <span className="text-slate-500"> · Rec. {a.receiptNumber}</span> : ''}</div>
                    ))}
                  </div>
                ) : <span className="text-slate-400">—</span> },
                { header: 'Estado', cell: (c) => <Badge tone={CHARGE_STATUS[c.status].tone}>{CHARGE_STATUS[c.status].label}</Badge> },
              ]} />
          </Card>

          <Card title="Movimientos">
            <Table rows={d.lines} rowKey={(l) => `${l.date}-${l.kind}-${l.concept}-${l.balance}`}
              columns={[
                { header: 'Fecha', cell: (l) => <span className="whitespace-nowrap">{dateLabel(l.date)}</span> },
                { header: 'Concepto', cell: (l) => <><div className={l.kind === 'SALDO' ? 'font-medium' : ''}>{l.concept}</div>{l.receiptNumber && <div className="text-xs text-slate-500">Recibo N.º {l.receiptNumber}</div>}</> },
                { header: 'Cargo', align: 'right', cell: (l) => (l.charge ? money(l.charge) : '') },
                { header: 'Abono', align: 'right', cell: (l) => (l.payment ? <span className="text-emerald-600">{money(l.payment)}</span> : '') },
                { header: 'Saldo', align: 'right', cell: (l) => <Balance v={l.balance} /> },
              ]} />
          </Card>

          {d.otherPayments.length > 0 && (
            <Card title="Otros pagos de la propiedad">
              <Table rows={d.otherPayments} rowKey={(o) => o.id}
                columns={[
                  { header: 'Fecha', cell: (o) => dateLabel(o.date) },
                  { header: 'Concepto', cell: (o) => <><div>{o.concept}</div><div className="text-xs text-slate-500">{o.category}{o.receiptNumber ? ` · Recibo ${o.receiptNumber}` : ''}</div></> },
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

const periodText = (p: Period) => `Periodo: ${monthLabel(p.from)} a ${monthLabel(p.to)} · al ${dateLabel(p.asOf)} · Cifras en USD`;

function exportSummary(r: Summary) {
  downloadXlsx(`Estado de cuenta por propiedad ${r.period.from} a ${r.period.to}`, [{
    name: 'Propiedades',
    title: [`${r.complex.name} — Estado de cuenta por propiedad`, periodText(r.period)],
    header: ['Propiedad', 'Dirección', 'Propietario', 'Cuota mensual', 'Saldo anterior', 'Cargos', 'Pagado', 'Saldo', 'Vencido', 'Cargos vencidos'],
    rows: r.rows.map((x) => [x.code, x.address, x.ownerName ?? 'Sin propietario', x.monthlyFee, x.opening, x.charges, x.paid, x.balance, x.overdue, x.overdueCount]),
    money: [3, 4, 5, 6, 7, 8],
    totals: ['Total', null, `${r.totals.units} propiedades`, null, r.totals.opening, r.totals.charges, r.totals.paid, r.totals.balance, r.totals.overdue, null],
  }]);
}

function exportUnit(d: UnitStatement) {
  const title = [
    `${d.complex.name} — Estado de cuenta ${d.unit.code}`,
    `Propietario: ${d.owner.name ?? d.residents[0]?.fullName ?? 'Sin propietario'}${d.unit.address ? ` · ${d.unit.address}` : ''}`,
    periodText(d.period),
  ];
  downloadXlsx(`Estado de cuenta ${d.unit.code} ${d.period.from} a ${d.period.to}`, [
    {
      name: 'Movimientos', title,
      header: ['Fecha', 'Concepto', 'Recibo', 'Cargo', 'Abono', 'Saldo'],
      rows: d.lines.map((l) => [l.date, l.concept, l.receiptNumber, l.charge || null, l.payment || null, l.balance]),
      money: [3, 4, 5],
      totals: ['Saldo final', null, null, d.summary.charges, d.summary.paid, d.summary.balance],
    },
    {
      name: 'Cargos', title,
      header: ['Concepto', 'Tipo', 'Emisión', 'Vence', 'Monto', 'Pagado', 'Pendiente', 'Estado', 'Fecha de aplicación'],
      rows: d.charges.map((c) => [
        c.description, c.kind ? CHARGE_KINDS[c.kind] : '', c.issueDate, c.dueDate, c.amount, c.paid, c.outstanding, CHARGE_STATUS[c.status].label,
        c.applications.map((a) => `${a.date} (${a.amount.toFixed(2)}${a.receiptNumber ? `, rec. ${a.receiptNumber}` : ''})`).join('; '),
      ]),
      money: [4, 5, 6],
    },
    ...(d.otherPayments.length
      ? [{
          name: 'Otros pagos', title,
          header: ['Fecha', 'Concepto', 'Categoría', 'Recibo', 'Monto'],
          rows: d.otherPayments.map((o) => [o.date, o.concept, o.category, o.receiptNumber, o.amount]),
          money: [4],
        }]
      : []),
  ]);
}
