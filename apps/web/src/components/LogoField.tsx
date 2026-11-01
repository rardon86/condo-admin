import { ChangeEvent, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { ProjectLogo } from './ProjectLogo';

const MAX_SIDE = 320;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

/** Redimensiona en el navegador y devuelve un data URL PNG/WebP liviano. */
async function toDataUrl(file: File): Promise<string> {
  if (!ACCEPT.includes(file.type)) throw new Error('Formato no permitido (usa PNG, JPG o WebP)');
  if (file.size > 5 * 1024 * 1024) throw new Error('La imagen supera 5 MB');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

/**
 * Selector de logo para formularios. Envía su valor en un input oculto `logo`:
 *   ''          → sin cambios
 *   '__remove__'→ quitar el logo
 *   data URL    → logo nuevo
 */
export function LogoField({ projectId, version }: { projectId?: string; version?: string | null }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setError(null);
      setValue(await toDataUrl(file));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const showExisting = value === '' && !!version;
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-slate-700">Logo del proyecto</span>
      <div className="flex items-center gap-4 rounded-xl border border-dashed border-slate-300 p-3">
        {value && value !== '__remove__' ? (
          <img src={value} alt="Vista previa" className="size-16 rounded-lg bg-white object-contain p-1" />
        ) : (
          <ProjectLogo id={projectId} version={showExisting ? version : null} className="size-16" />
        )}
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
            <ImagePlus className="size-4" /> {showExisting || (value && value !== '__remove__') ? 'Cambiar' : 'Subir logo'}
            <input type="file" accept={ACCEPT.join(',')} className="sr-only" onChange={pick} />
          </label>
          {(showExisting || (value && value !== '__remove__')) && (
            <button type="button" onClick={() => setValue(version ? '__remove__' : '')} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">
              <Trash2 className="size-4" /> Quitar
            </button>
          )}
        </div>
      </div>
      <span className="block text-xs text-slate-500">PNG, JPG o WebP. Se ajusta automáticamente a {MAX_SIDE}px.</span>
      {error && <span className="block text-xs text-red-600">{error}</span>}
      <input type="hidden" name="logo" value={value} />
    </div>
  );
}

/** Convierte el valor del input oculto al formato de la API (undefined = sin cambio, null = quitar). */
export const logoPayload = (v: string | undefined) => (!v ? undefined : v === '__remove__' ? null : v);
