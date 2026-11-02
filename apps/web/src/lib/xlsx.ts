/**
 * Exportación a Excel (.xlsx, Office Open XML) generada en el navegador.
 * Solo usa `fflate` para empaquetar el ZIP; las hojas se escriben a mano (texto en línea, sin fórmulas).
 */
import { strToU8, zipSync } from 'fflate';

export type Cell = string | number | null | undefined;

export interface Sheet {
  /** Nombre de la pestaña (se recorta a 31 caracteres). */
  name: string;
  /** Líneas de título en la parte superior (proyecto, periodo…). */
  title?: string[];
  header: string[];
  rows: Cell[][];
  /** Índices de columnas con formato de moneda (#,##0.00). */
  money?: number[];
  /** Fila de totales al final (en negrita). */
  totals?: Cell[];
}

// Estilos: 0 normal · 1 negrita · 2 moneda · 3 negrita+moneda · 4 título
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F5EC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
</styleSheet>`;

const esc = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

function cellXml(ref: string, v: Cell, style: number) {
  if (v === null || v === undefined || v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(s: Sheet) {
  const lines: { cells: Cell[]; kind: 'title' | 'header' | 'row' | 'total' | 'blank' }[] = [];
  s.title?.forEach((t, i) => lines.push({ cells: [t], kind: i === 0 ? 'title' : 'row' }));
  if (s.title?.length) lines.push({ cells: [], kind: 'blank' });
  const headerRow = lines.length + 1;
  lines.push({ cells: s.header, kind: 'header' });
  s.rows.forEach((r) => lines.push({ cells: r, kind: 'row' }));
  if (s.totals) lines.push({ cells: s.totals, kind: 'total' });

  const money = new Set(s.money ?? []);
  const body = lines
    .map((l, r) => {
      const cells = l.cells
        .map((v, c) => {
          const isMoney = money.has(c) && typeof v === 'number' && l.kind !== 'header';
          const style = l.kind === 'title' ? 4 : l.kind === 'header' ? 5 : l.kind === 'total' ? (isMoney ? 3 : 1) : isMoney ? 2 : 0;
          return cellXml(`${colName(c)}${r + 1}`, v, style);
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  // Ancho de columna según el contenido (sin contar el título)
  const widths = s.header.map((h, c) =>
    Math.min(60, Math.max(10, h.length + 2, ...[...s.rows, s.totals ?? []].map((r) => String(r[c] ?? '').length + 2))),
  );
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  // Encabezado fijo al desplazarse
  const pane = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const sheetName = (n: string, used: Set<string>) => {
  let base = n.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

/** Genera y descarga un .xlsx con una o varias hojas. */
export function downloadXlsx(filename: string, sheets: Sheet[]) {
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));

  const blob = new Blob([zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
