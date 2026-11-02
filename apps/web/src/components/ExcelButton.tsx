import { FileSpreadsheet } from 'lucide-react';
import { Button } from './ui';

/** Botón estándar de descarga a Excel (oculto al imprimir). */
export function ExcelButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="secondary" className="print:hidden" onClick={onClick} disabled={disabled} title="Descargar en Excel">
      <FileSpreadsheet className="size-4" />Excel
    </Button>
  );
}
