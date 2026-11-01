import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Send } from 'lucide-react';
import { get, patch, post } from '../lib/api';
import { can, useAuth } from '../lib/auth';
import { dateTime, TICKET_STATUS, TICKET_TYPES } from '../lib/format';
import { Badge, Button, Card, cx, ErrorText, Field, formData, Input, Modal, PageHeader, Select, Spinner, Table, Tone } from '../components/ui';

interface TicketRow { id: string; type: string; subject: string; status: string; createdAt: string; updatedAt: string; author: string; unitCode: string | null; messages: number }
interface TicketDetail {
  id: string; type: string; subject: string; description: string; status: string; createdAt: string; createdBy: string;
  unitCode: string | null; creator: { fullName: string; email: string; phone: string | null };
  messages: { id: string; body: string; createdAt: string; authorId: string; author: string }[];
}

export const STATUS_TONE: Record<string, Tone> = { ABIERTO: 'amber', EN_PROCESO: 'blue', RESUELTO: 'green', CERRADO: 'slate' };
const TYPE_TONE: Record<string, Tone> = { CONSULTA: 'blue', RECLAMO: 'red', SUGERENCIA: 'violet' };

export function NewTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (b: unknown) => post('/tickets', b),
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Nueva consulta o reclamo">
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(formData(e)); }} className="space-y-4">
        <Field label="Tipo">
          <Select name="type" defaultValue="CONSULTA">{Object.entries(TICKET_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
        <Field label="Asunto"><Input name="subject" required minLength={3} maxLength={160} placeholder="Ej.: Fuga de agua en área común" /></Field>
        <Field label="Detalle">
          <textarea name="description" required minLength={5} rows={5} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
        </Field>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={create.isPending}>Enviar</Button></div>
      </form>
    </Modal>
  );
}

/** Consultas y reclamos: el propietario ve los suyos; la administración los atiende todos. */
export function TicketsPage() {
  const { complex, me } = useAuth();
  const isResident = can(complex?.role, 'resident');
  const isAdmin = can(complex?.role, 'manage');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const list = useQuery({ queryKey: ['tickets', status], queryFn: () => get<TicketRow[]>('/tickets', { status }) });
  const detail = useQuery({ queryKey: ['ticket', openId], queryFn: () => get<TicketDetail>(`/tickets/${openId}`), enabled: !!openId });
  const reply = useMutation({
    mutationFn: (body: string) => post(`/tickets/${openId}/messages`, { body }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const setSt = useMutation({
    mutationFn: (s: string) => patch(`/tickets/${openId}`, { status: s }),
    onSuccess: () => qc.invalidateQueries(),
  });

  function submitReply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    reply.mutate(formData(e).body, { onSuccess: () => form.reset() });
  }

  const t = detail.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={isResident ? 'Mis consultas y reclamos' : 'Consultas y reclamos'}
        subtitle={isResident ? 'Envía tus consultas a la administración y sigue sus respuestas' : 'Atiende las solicitudes de los propietarios'}
        actions={
          <div className="flex gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos los estados</option>
              {Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            {isResident && <Button onClick={() => setCreating(true)}><MessageSquarePlus className="size-4" />Nueva</Button>}
          </div>
        }
      />
      <Card>
        {list.isLoading ? <Spinner /> : (
          <Table rows={list.data ?? []} rowKey={(r) => r.id} empty="No hay consultas."
            columns={[
              { header: 'Asunto', cell: (r) => <button className="text-left font-medium text-link hover:underline" onClick={() => setOpenId(r.id)}>{r.subject}</button> },
              { header: 'Tipo', cell: (r) => <Badge tone={TYPE_TONE[r.type]}>{TICKET_TYPES[r.type]}</Badge> },
              ...(isResident ? [] : [{ header: 'Propietario', cell: (r: TicketRow) => <>{r.author}{r.unitCode && <span className="text-slate-500"> · {r.unitCode}</span>}</> }]),
              { header: 'Estado', cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{TICKET_STATUS[r.status]}</Badge> },
              { header: 'Respuestas', align: 'right', cell: (r) => r.messages },
              { header: 'Actualizado', cell: (r) => <span className="whitespace-nowrap text-slate-500">{dateTime(r.updatedAt)}</span> },
            ]} />
        )}
      </Card>

      <Modal open={!!openId} onClose={() => setOpenId(null)} title={t?.subject ?? 'Consulta'} wide>
        {!t ? <Spinner /> : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={TYPE_TONE[t.type]}>{TICKET_TYPES[t.type]}</Badge>
              <Badge tone={STATUS_TONE[t.status]}>{TICKET_STATUS[t.status]}</Badge>
              <span className="text-slate-500">{t.creator.fullName}{t.unitCode ? ` · ${t.unitCode}` : ''} · {dateTime(t.createdAt)}</span>
            </div>
            {isAdmin && (
              <div className="text-xs text-slate-500">Contacto: {t.creator.email}{t.creator.phone ? ` · ${t.creator.phone}` : ''}</div>
            )}
            <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{t.description}</p>

            <div className="space-y-3">
              {t.messages.map((m) => {
                const mine = m.authorId === me?.id;
                return (
                  <div key={m.id} className={cx('max-w-[85%] rounded-xl px-3 py-2 text-sm', mine ? 'ml-auto bg-brand-600 text-white' : 'bg-slate-100')}>
                    <div className={cx('mb-0.5 text-xs', mine ? 'text-blue-100' : 'text-slate-500')}>{m.author} · {dateTime(m.createdAt)}</div>
                    <div className="whitespace-pre-line">{m.body}</div>
                  </div>
                );
              })}
            </div>

            {t.status !== 'CERRADO' && complex?.role !== 'VIEWER' && (
              <form onSubmit={submitReply} className="flex gap-2">
                <Input name="body" required placeholder="Escribe una respuesta…" />
                <Button loading={reply.isPending} aria-label="Enviar"><Send className="size-4" /></Button>
              </form>
            )}
            <ErrorText error={reply.error} />

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                <span className="text-sm text-slate-500">Cambiar estado:</span>
                {Object.entries(TICKET_STATUS).filter(([k]) => k !== t.status).map(([k, v]) => (
                  <Button key={k} variant="secondary" loading={setSt.isPending && setSt.variables === k} onClick={() => setSt.mutate(k)}>{v}</Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <NewTicketModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
