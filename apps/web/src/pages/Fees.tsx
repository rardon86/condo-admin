import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarPlus, CheckCircle2, FilePlus2, HandCoins } from 'lucide-react';
import { get, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { CHARGE_KINDS, CHARGE_STATUS, dateLabel, firstOfMonth, METHODS, money, today } from '../lib/format';
import { Alert, Badge, Button, Card, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Spinner, Table, cx } from '../components/ui';
import type { Account, Unit } from './Movements';
import { ExcelButton } from '../components/ExcelButton';
import { downloadXlsx } from '../lib/xlsx';

interface Charge {
  id: string; unitId: string; unitCode: string; ownerName: string | null; kind: string; period: string | null; description: string; accountName: string;
  issueDate: string; dueDate: string; amount: number; paid: number; outstanding: number; lastApplied: string | null; status: string; voidReason: string | null;
}
interface Payment {
  id: string; date: string; amount: number; method: string; receiptNumber: string | null; reference: string | null; description: string | null;
  voidedAt: string | null; voidReason: string | null; unitCode: string | null; ownerName: string | null; applied: number; credit: number;
}
export interface Pending {
  unit: { id: string; code: string; ownerName: string | null; monthlyFee: number };
  charges: { id: string; description: string; kind: string; dueDate: string; amount: number; outstanding: number; overdue: boolean }[];
  totalPending: number; overdue: number; credit: number;
}
interface PaymentResult { receiptNumber: string; amount: number; applied: { description?: string; amount: number }[]; credit: number }

const currentMonth = () => today().slice(0, 7);

/** Cuotas: cargos emitidos a cada propiedad, pagos con recibo y su aplicación. */
export function FeesPage() {
  const { complex } = useAuth();
  const canWrite = can(complex?.role, 'finWrite');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'charges' | 'payments'>('charges');
  const [modal, setModal] = useState<'pay' | 'generate' | 'charge' | null>(params.get('pagar') !== null ? 'pay' : null);
  const [voiding, setVoiding] = useState<{ kind: 'charge' | 'payment'; id: string; label: string } | null>(null);
  const [cf, setCf] = useState({ period: currentMonth(), unitId: '', status: '' });
  const [pf, setPf] = useState({ from: firstOfMonth(), to: today(), unitId: '' });

  const unitsQ = useQuery({ queryKey: ['units'], queryFn: () => get<Unit[]>('/units') });
  const chargesQ = useQuery({ queryKey: ['fee-charges', cf], queryFn: () => get<{ items: Charge[]; totals: { count: number; amount: number; paid: number; outstanding: number } }>('/fees/charges', cf), enabled: tab === 'charges' });
  const paymentsQ = useQuery({ queryKey: ['fee-payments', pf], queryFn: () => get<{ items: Payment[]; total: number }>('/fees/payments', pf), enabled: tab === 'payments' });

  const voidM = useMutation({
    mutationFn: (v: { kind: 'charge' | 'payment'; id: string; reason: string }) =>
      post(v.kind === 'charge' ? `/fees/charges/${v.id}/void` : `/incomes/${v.id}/void`, { reason: v.reason }),
    onSuccess: () => { qc.invalidateQueries(); setVoiding(null); },
  });
  const close = () => { setModal(null); if (params.has('pagar')) setParams({}, { replace: true }); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuotas"
        subtitle="Cargos a cada propiedad, pagos con recibo y recargos por mora"
        actions={
          <>
            {canWrite && <Button onClick={() => setModal('pay')}><HandCoins className="size-4" />Registrar pago</Button>}
            {canWrite && <Button variant="secondary" onClick={() => setModal('generate')}><CalendarPlus className="size-4" />Generar cuotas del mes</Button>}
            {canWrite && <Button variant="secondary" onClick={() => setModal('charge')}><FilePlus2 className="size-4" />Nuevo cargo</Button>}
            <ExcelButton
              disabled={tab === 'charges' ? !chargesQ.data : !paymentsQ.data}
              onClick={() => tab === 'charges'
                ? chargesQ.data && downloadXlsx(`Cargos ${cf.period || 'todos'}`, [{
                    name: 'Cargos', title: [`${complex?.name ?? ''} — Cargos ${cf.period || '(todos los meses)'}`],
                    header: ['Propiedad', 'Propietario', 'Concepto', 'Tipo', 'Emisión', 'Vence', 'Monto', 'Pagado', 'Pendiente', 'Aplicado el', 'Estado'],
                    rows: chargesQ.data.items.map((c) => [c.unitCode, c.ownerName, c.description, CHARGE_KINDS[c.kind], c.issueDate, c.dueDate, c.amount, c.paid, c.outstanding, c.lastApplied, CHARGE_STATUS[c.status].label]),
                    money: [6, 7, 8],
                    totals: ['Total', null, `${chargesQ.data.totals.count} cargos`, null, null, null, chargesQ.data.totals.amount, chargesQ.data.totals.paid, chargesQ.data.totals.outstanding, null, null],
                  }])
                : paymentsQ.data && downloadXlsx(`Pagos de cuotas ${pf.from} a ${pf.to}`, [{
                    name: 'Pagos', title: [`${complex?.name ?? ''} — Pagos de cuotas del ${pf.from} al ${pf.to}`],
                    header: ['Fecha', 'Recibo', 'Propiedad', 'Propietario', 'Método', 'Referencia', 'Monto', 'Aplicado', 'Saldo a favor', 'Estado'],
                    rows: paymentsQ.data.items.map((p) => [p.date, p.receiptNumber, p.unitCode, p.ownerName, METHODS[p.method], p.reference, p.amount, p.applied, p.credit, p.voidedAt ? `Anulado: ${p.voidReason ?? ''}` : 'Vigente']),
                    money: [6, 7, 8],
                    totals: ['Total vigente', null, null, null, null, null, paymentsQ.data.total, null, null, null],
                  }])}
            />
          </>
        }
      />

      <div className="flex gap-1 rounded-xl border border-slate-200 bg-surface p-1 sm:w-fit">
        {(['charges', 'payments'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition sm:flex-none', tab === t ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>
            {t === 'charges' ? 'Cargos' : 'Pagos'}
          </button>
        ))}
      </div>

      {tab === 'charges' ? (
        <>
          <Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Mes"><Input type="month" value={cf.period} onChange={(e) => setCf({ ...cf, period: e.target.value })} /></Field>
              <Field label="Propiedad"><PropertySelect units={unitsQ.data} value={cf.unitId} onChange={(v) => setCf({ ...cf, unitId: v })} all /></Field>
              <Field label="Estado">
                <Select value={cf.status} onChange={(e) => setCf({ ...cf, status: e.target.value })}>
                  <option value="">Vigentes</option><option value="PENDIENTES">Con saldo pendiente</option><option value="VENCIDOS">Vencidos</option>
                  <option value="PAGADOS">Pagados</option><option value="ANULADOS">Anulados</option>
                </Select>
              </Field>
            </div>
            <p className="mt-2 text-xs text-slate-500">Deja el mes vacío para ver todos los meses (útil filtrando por propiedad).</p>
          </Card>
          <Card title={chargesQ.data ? `${chargesQ.data.totals.count} cargos · ${money(chargesQ.data.totals.amount)} · Pendiente ${money(chargesQ.data.totals.outstanding)}` : 'Cargos'}>
            {chargesQ.isLoading ? <Spinner /> : (
              <Table rows={chargesQ.data?.items ?? []} rowKey={(c) => c.id} empty="Sin cargos. Usa “Generar cuotas del mes” o activa la generación automática en Ajustes."
                columns={[
                  { header: 'Propiedad', cell: (c) => <><Link className="font-medium text-link hover:underline" to={`/informes/estado-cuenta/${c.unitId}`}>{c.unitCode}</Link><div className="text-xs text-slate-500">{c.ownerName}</div></> },
                  { header: 'Concepto', cell: (c) => <><div className={c.status === 'ANULADO' ? 'line-through text-slate-400' : ''}>{c.description}</div><div className="text-xs text-slate-500">{CHARGE_KINDS[c.kind]}{c.voidReason ? ` · ${c.voidReason}` : ''}</div></> },
                  { header: 'Vence', cell: (c) => <span className="whitespace-nowrap">{dateLabel(c.dueDate)}</span> },
                  { header: 'Monto', align: 'right', cell: (c) => money(c.amount) },
                  { header: 'Pagado', align: 'right', cell: (c) => money(c.paid) },
                  { header: 'Pendiente', align: 'right', cell: (c) => <span className={c.outstanding > 0 ? 'font-medium' : 'text-slate-400'}>{money(c.outstanding)}</span> },
                  { header: 'Aplicado el', cell: (c) => <span className="whitespace-nowrap text-slate-500">{c.lastApplied ? dateLabel(c.lastApplied) : '—'}</span> },
                  { header: 'Estado', cell: (c) => <Badge tone={CHARGE_STATUS[c.status].tone}>{CHARGE_STATUS[c.status].label}</Badge> },
                  { header: '', cell: (c) => canWrite && c.status !== 'ANULADO' && (
                    <button title="Anular cargo" onClick={() => setVoiding({ kind: 'charge', id: c.id, label: `${c.unitCode} · ${c.description}` })} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Ban className="size-4" /></button>
                  ) },
                ]} />
            )}
          </Card>
        </>
      ) : (
        <>
          <Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Desde"><Input type="date" value={pf.from} onChange={(e) => setPf({ ...pf, from: e.target.value })} /></Field>
              <Field label="Hasta"><Input type="date" value={pf.to} onChange={(e) => setPf({ ...pf, to: e.target.value })} /></Field>
              <Field label="Propiedad"><PropertySelect units={unitsQ.data} value={pf.unitId} onChange={(v) => setPf({ ...pf, unitId: v })} all /></Field>
            </div>
          </Card>
          <Card title={paymentsQ.data ? `${paymentsQ.data.items.length} pagos · ${money(paymentsQ.data.total)}` : 'Pagos'}>
            {paymentsQ.isLoading ? <Spinner /> : (
              <Table rows={paymentsQ.data?.items ?? []} rowKey={(p) => p.id} empty="Sin pagos en el periodo"
                columns={[
                  { header: 'Fecha', cell: (p) => <span className="whitespace-nowrap">{dateLabel(p.date)}</span> },
                  { header: 'Recibo', cell: (p) => <span className={cx('font-medium', p.voidedAt && 'line-through text-slate-400')}>{p.receiptNumber ?? '—'}</span> },
                  { header: 'Propiedad', cell: (p) => <><div>{p.unitCode}</div><div className="text-xs text-slate-500">{p.ownerName}</div></> },
                  { header: 'Método', cell: (p) => METHODS[p.method] },
                  { header: 'Monto', align: 'right', cell: (p) => <span className="text-emerald-700">{money(p.amount)}</span> },
                  { header: 'Aplicado', align: 'right', cell: (p) => money(p.applied) },
                  { header: 'A favor', align: 'right', cell: (p) => (p.credit > 0 ? <Badge tone="green">{money(p.credit)}</Badge> : '—') },
                  { header: '', cell: (p) => p.voidedAt ? <Badge tone="red">Anulado</Badge> : canWrite && (
                    <button title="Anular pago" onClick={() => setVoiding({ kind: 'payment', id: p.id, label: `Recibo ${p.receiptNumber} · ${money(p.amount)}` })} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Ban className="size-4" /></button>
                  ) },
                ]} />
            )}
          </Card>
        </>
      )}

      <PaymentModal open={modal === 'pay'} onClose={close} units={unitsQ.data ?? []} initialUnit={params.get('pagar') ?? ''} />
      <GenerateModal open={modal === 'generate'} onClose={close} />
      <ChargeModal open={modal === 'charge'} onClose={close} units={unitsQ.data ?? []} />

      <Modal open={!!voiding} onClose={() => setVoiding(null)} title={voiding?.kind === 'charge' ? 'Anular cargo' : 'Anular pago'}>
        <form onSubmit={(e) => { e.preventDefault(); voidM.mutate({ ...voiding!, reason: formData(e).reason }); }} className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{voiding?.label}</strong><br />
            {voiding?.kind === 'charge'
              ? 'Se genera el asiento de reversión. Si el cargo ya estaba pagado, ese dinero pasa a saldo a favor de la propiedad y se aplica a sus otros pendientes.'
              : 'Se reversa el ingreso en caja y los cargos que cubría vuelven a quedar pendientes. Queda en la bitácora de auditoría.'}
          </p>
          <Field label="Motivo"><Input name="reason" required minLength={3} /></Field>
          <ErrorText error={voidM.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setVoiding(null)}>Cancelar</Button><Button variant="danger" loading={voidM.isPending}>Anular</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function PropertySelect({ units, value, onChange, all, name, required }: { units?: Unit[]; value?: string; onChange?: (v: string) => void; all?: boolean; name?: string; required?: boolean }) {
  return (
    <Select name={name} value={value} required={required} onChange={(e) => onChange?.(e.target.value)}>
      <option value="">{all ? 'Todas' : '— Seleccione —'}</option>
      {units?.filter((u) => u.active || u.id === value).map((u) => <option key={u.id} value={u.id}>{u.code}{u.ownerName ? ` · ${u.ownerName}` : ''}</option>)}
    </Select>
  );
}

/** Registrar pago de cuotas: muestra lo pendiente y cómo se aplicará (más antiguo primero). */
function PaymentModal({ open, onClose, units, initialUnit }: { open: boolean; onClose: () => void; units: Unit[]; initialUnit: string }) {
  const qc = useQueryClient();
  const [unitId, setUnitId] = useState(initialUnit);
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<PaymentResult | null>(null);
  useEffect(() => { if (open) { setUnitId(initialUnit); setResult(null); } }, [open, initialUnit]);
  const pending = useQuery({ queryKey: ['fee-pending', unitId], queryFn: () => get<Pending>(`/fees/pending/${unitId}`), enabled: open && !!unitId });
  useEffect(() => {
    if (pending.data) setAmount(String(Math.max(Math.round((pending.data.totalPending - pending.data.credit) * 100) / 100, 0) || ''));
  }, [pending.data]);
  const pay = useMutation({
    mutationFn: (b: unknown) => post<PaymentResult>('/fees/payments', b),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries(); },
  });

  // Vista previa de la aplicación FIFO
  const preview = useMemo(() => {
    let left = Math.round(Number(amount || 0) * 100);
    return (pending.data?.charges ?? []).map((c) => {
      const cents = Math.min(left, Math.round(c.outstanding * 100));
      left -= Math.max(cents, 0);
      return { ...c, applied: Math.max(cents, 0) / 100 };
    });
  }, [amount, pending.data]);
  const excess = Math.max(Number(amount || 0) - preview.reduce((s, p) => s + p.applied, 0), 0);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    pay.mutate({ unitId, date: f.date, amount: Number(f.amount), receiptNumber: f.receiptNumber, method: f.method, reference: f.reference || null, description: f.description || null });
  }

  return (
    <Modal open={open} onClose={onClose} title="Registrar pago de cuotas" wide>
      {result ? (
        <div className="space-y-4">
          <Alert tone="green" icon={<CheckCircle2 />}>
            Pago registrado con el recibo <strong>{result.receiptNumber}</strong> por {money(result.amount)}.
          </Alert>
          <Table rows={result.applied} rowKey={(a) => `${a.description}-${a.amount}`} empty="No había cargos pendientes"
            columns={[{ header: 'Aplicado a', cell: (a) => a.description }, { header: 'Monto', align: 'right', cell: (a) => money(a.amount) }]} />
          {result.credit > 0 && <Alert tone="blue">Quedan {money(result.credit)} como saldo a favor; se aplicarán automáticamente a los próximos cargos.</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setResult(null); setUnitId(''); }}>Registrar otro</Button>
            <Button onClick={onClose}>Listo</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Propiedad"><PropertySelect units={units} value={unitId} onChange={setUnitId} required /></Field>
          {unitId && (pending.isLoading ? <Spinner /> : pending.data && (
            <div className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                <span>Pendiente: <strong>{money(pending.data.totalPending)}</strong></span>
                {pending.data.overdue > 0 && <span className="text-red-600">Vencido: {money(pending.data.overdue)}</span>}
                {pending.data.credit > 0 && <span className="text-emerald-600">Saldo a favor: {money(pending.data.credit)}</span>}
              </div>
              {preview.length === 0 ? <p className="text-slate-500">Sin cargos pendientes: el pago quedará como saldo a favor.</p> : (
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {preview.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate">{c.description} <span className="text-xs text-slate-500">· vence {dateLabel(c.dueDate)}</span></span>
                      {c.overdue && <Badge tone="red">Vencido</Badge>}
                      <span className="w-20 text-right">{money(c.outstanding)}</span>
                      <span className={cx('w-24 text-right text-xs', c.applied ? 'text-emerald-600' : 'text-slate-400')}>{c.applied ? `aplica ${money(c.applied)}` : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {excess > 0 && <p className="mt-2 text-xs text-emerald-600">Sobrante {money(excess)} → saldo a favor</p>}
            </div>
          ))}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Fecha de pago"><Input name="date" type="date" defaultValue={today()} required /></Field>
            <Field label="Monto (USD)"><Input name="amount" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></Field>
            <Field label="N.º de recibo"><Input name="receiptNumber" required maxLength={40} placeholder="Recibo físico" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Método de pago"><Select name="method" defaultValue="CASH">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Referencia bancaria (opcional)"><Input name="reference" maxLength={80} /></Field>
          </div>
          <Field label="Observaciones (opcional)"><Input name="description" maxLength={1000} /></Field>
          <ErrorText error={pay.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={pay.isPending} disabled={!unitId}>Registrar pago</Button></div>
        </form>
      )}
    </Modal>
  );
}

function GenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [res, setRes] = useState<{ period: string; created: number; existing: number } | null>(null);
  useEffect(() => { if (open) setRes(null); }, [open]);
  const gen = useMutation({ mutationFn: (period: string) => post<{ period: string; created: number; existing: number }>('/fees/charges/generate', { period }), onSuccess: (r) => { setRes(r); qc.invalidateQueries(); } });
  return (
    <Modal open={open} onClose={onClose} title="Generar cuotas del mes">
      {res ? (
        <div className="space-y-4">
          <Alert tone="green" icon={<CheckCircle2 />}>{res.created} cuotas emitidas para {res.period}. {res.existing > 0 && `${res.existing} propiedades ya tenían su cuota.`}</Alert>
          <div className="flex justify-end"><Button onClick={onClose}>Listo</Button></div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); gen.mutate(formData(e).period); }} className="space-y-4">
          <p className="text-sm text-slate-600">Emite la cuota mensual de cada propiedad activa según su cuota configurada. No duplica las que ya existen. Si una propiedad tiene saldo a favor, se aplica automáticamente.</p>
          <Field label="Mes"><Input name="period" type="month" defaultValue={currentMonth()} required /></Field>
          <ErrorText error={gen.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={gen.isPending}>Generar</Button></div>
        </form>
      )}
    </Modal>
  );
}

/** Cargo extraordinario u otro cargo (p. ej. saldo anterior al sistema) a una, varias o todas las propiedades. */
function ChargeModal({ open, onClose, units }: { open: boolean; onClose: () => void; units: Unit[] }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'all' | 'some'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const accounts = useQuery({ queryKey: ['accounts', 'INCOME'], queryFn: () => get<Account[]>('/accounts', { type: 'INCOME' }), enabled: open });
  const create = useMutation({ mutationFn: (b: unknown) => post('/fees/charges', b), onSuccess: () => { qc.invalidateQueries(); onClose(); } });
  const active = units.filter((u) => u.active);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    create.mutate({
      kind: f.kind, accountId: f.accountId, description: f.description, amount: Number(f.amount), issueDate: f.issueDate, dueDate: f.dueDate,
      ...(scope === 'all' ? { allUnits: true } : { unitIds: selected }),
    });
  }
  return (
    <Modal open={open} onClose={onClose} title="Nuevo cargo" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo"><Select name="kind" defaultValue="EXTRAORDINARIA"><option value="EXTRAORDINARIA">Cuota extraordinaria</option><option value="OTRO">Otro cargo (p. ej. saldo anterior)</option></Select></Field>
          <Field label="Cuenta de ingreso">
            <Select name="accountId" required>{accounts.data?.filter((a) => a.postable).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select>
          </Field>
        </div>
        <Field label="Descripción"><Input name="description" required minLength={3} maxLength={300} placeholder="Cuota extraordinaria para reparación del portón" /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Monto por propiedad (USD)"><Input name="amount" type="number" step="0.01" min="0.01" required /></Field>
          <Field label="Fecha de emisión"><Input name="issueDate" type="date" defaultValue={today()} required /></Field>
          <Field label="Vencimiento"><Input name="dueDate" type="date" defaultValue={today()} required /></Field>
        </div>
        <Field label="Propiedades">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />Todas las activas ({active.length})</label>
            <label className="flex items-center gap-2"><input type="radio" checked={scope === 'some'} onChange={() => setScope('some')} />Seleccionar</label>
          </div>
        </Field>
        {scope === 'some' && (
          <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm sm:grid-cols-4">
            {active.map((u) => (
              <label key={u.id} className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} />{u.code}
              </label>
            ))}
          </div>
        )}
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={create.isPending}>Emitir cargo</Button></div>
      </form>
    </Modal>
  );
}
