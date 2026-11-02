import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Pin, Plus } from 'lucide-react';
import { del, get, patch, post } from '../lib/api';
import { dateTime } from '../lib/format';
import { useCatalog } from '../lib/catalogs';
import { Badge, Button, Card, Empty, ErrorText, Field, formData, Input, Modal, PageHeader, Select } from '../components/ui';
import { CATEGORY_TONE } from './Portal';

interface Item { id: string; title: string; body: string; category: string; pinned: boolean; publishedAt: string | null; createdAt: string; author: string | null }

/** Publicación de avisos y noticias que ven los propietarios en su portal. */
export function AnnouncementsPage() {
  const qc = useQueryClient();
  const cats = useCatalog('NEWS_CATEGORY');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const { data = [] } = useQuery({ queryKey: ['announcements'], queryFn: () => get<Item[]>('/announcements') });
  const save = useMutation({
    mutationFn: (b: unknown) => (editing && editing !== 'new' ? patch(`/announcements/${editing.id}`, b) : post('/announcements', b)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['announcements'] }); setEditing(null); },
  });
  const archive = useMutation({ mutationFn: (id: string) => del(`/announcements/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }) });
  const a = editing && editing !== 'new' ? editing : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = formData(e);
    save.mutate({ title: f.title, body: f.body, category: f.category, pinned: f.pinned === 'on', publish: f.publish === 'on' });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Avisos y noticias" subtitle="Lo que publiques aquí aparece en el portal de los propietarios"
        actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" />Nuevo aviso</Button>} />
      {data.length === 0 && <Card><Empty>Aún no hay avisos.</Empty></Card>}
      <div className="space-y-3">
        {data.map((n) => (
          <Card key={n.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={CATEGORY_TONE[n.category] ?? 'slate'}>{cats.label(n.category)}</Badge>
              {n.pinned && <span className="flex items-center gap-1 text-xs text-slate-500"><Pin className="size-3" />Fijado</span>}
              {n.publishedAt ? <span className="text-xs text-slate-500">Publicado {dateTime(n.publishedAt)}</span> : <Badge tone="amber">Borrador</Badge>}
              <div className="ml-auto flex gap-1">
                <button title="Editar" onClick={() => setEditing(n)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Pencil className="size-4" /></button>
                <button title="Archivar" onClick={() => confirm('¿Archivar este aviso? Dejará de verse en el portal.') && archive.mutate(n.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Archive className="size-4" /></button>
              </div>
            </div>
            <h3 className="mt-2 font-semibold">{n.title}</h3>
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-slate-600">{n.body}</p>
          </Card>
        ))}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={a ? 'Editar aviso' : 'Nuevo aviso'} wide>
        <form key={a?.id ?? 'new'} onSubmit={submit} className="space-y-4">
          <Field label="Título"><Input name="title" defaultValue={a?.title} required minLength={3} maxLength={160} /></Field>
          <Field label="Categoría">
            <Select name="category" defaultValue={a?.category ?? cats.options[0]?.code}>{cats.options.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
          </Field>
          <Field label="Contenido">
            <textarea name="body" defaultValue={a?.body} required minLength={3} rows={8} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
          </Field>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="publish" defaultChecked={a ? !!a.publishedAt : true} />Publicar ahora</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="pinned" defaultChecked={a?.pinned} />Fijar arriba</label>
          </div>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button><Button loading={save.isPending}>Guardar</Button></div>
        </form>
      </Modal>
    </div>
  );
}
