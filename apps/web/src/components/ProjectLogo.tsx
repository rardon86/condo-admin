import { Building2 } from 'lucide-react';
import { cx } from './ui';

/** Logo del proyecto (servido por la API con caché) o ícono por defecto. */
export function ProjectLogo({ id, version, className }: { id?: string | null; version?: string | null; className?: string }) {
  if (id && version) {
    return (
      <img
        src={`/api/public/projects/${id}/logo?v=${encodeURIComponent(version)}`}
        alt=""
        className={cx('shrink-0 rounded-lg bg-white object-contain p-0.5', className)}
      />
    );
  }
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-white', className)}>
      <Building2 className="size-1/2" />
    </span>
  );
}
