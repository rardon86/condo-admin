import { cx } from './ui';

export const SUPPORT_EMAIL = 'rardon@arorconsulting.onmicrosoft.com';
export const PRODUCT_NAME = 'Administración de Complejos';

/** Logo de AROR Consulting: versión clara sobre fondos oscuros y original sobre claros. */
export function ArorLogo({ variant = 'auto', className }: { variant?: 'auto' | 'light' | 'color'; className?: string }) {
  if (variant === 'light') return <img src="/brand/aror-logo-light.png" alt="AROR Consulting" className={className} />;
  if (variant === 'color') return <img src="/brand/aror-logo.png" alt="AROR Consulting" className={className} />;
  return (
    <>
      <img src="/brand/aror-logo-light.png" alt="AROR Consulting" className={cx('hidden dark:block', className)} />
      <img src="/brand/aror-logo.png" alt="AROR Consulting" className={cx('block dark:hidden', className)} />
    </>
  );
}

export function CopyrightFooter({ className }: { className?: string }) {
  return (
    <footer className={cx('text-center text-xs', className)}>
      © {new Date().getFullYear()} AROR Consulting. Todos los derechos reservados.
      <span className="mx-1.5 opacity-50">·</span>
      Soporte: <a className="underline-offset-2 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
    </footer>
  );
}
