'use client';
// Export (Excel, PDF, Word, JPEG) and import (Excel, CSV, Word, PDF) toolbar used by every module.
import { useEffect, useRef, useState } from 'react';
import { exportExcel, exportJpeg, exportPdf, exportWord, importTable, IMPORT_ACCEPT, type ExportDoc } from '@/lib/fileio';
import type { Column, Row } from '@/lib/sheetSchema';
import { askConfirm, notify } from './Dialogs';

export const asPlan = (p: { next: unknown; added: number; updated: number; errors: string[] }, apply: (next: never) => void): ImportPlan => ({
  added: p.added,
  updated: p.updated,
  errors: p.errors,
  apply: () => apply(p.next as never),
});

export interface ImportPlan {
  /** rows that will be added or updated */
  apply: () => void;
  added: number;
  updated: number;
  errors: string[];
}

interface Props {
  /** builds the export document lazily (only when an export is chosen) */
  doc: () => ExportDoc | Promise<ExportDoc>;
  /** element captured for JPEG */
  capture?: () => HTMLElement | null;
  /** columns accepted on import; omit to hide Import */
  importColumns?: Column[];
  /** sheet/tab name to prefer inside a multi-sheet Excel file */
  importSheet?: string;
  /** validates rows and returns a plan; nothing changes until the plan is applied */
  onImport?: (rows: Row[]) => ImportPlan;
  label?: string;
  /** extra import types, e.g. photos on Site evidence */
  extraAccept?: string;
  onExtraFiles?: (files: File[]) => void;
}

type Fmt = 'xlsx' | 'pdf' | 'docx' | 'jpg';
const LABEL: Record<Fmt, string> = { xlsx: 'Excel (.xlsx)', pdf: 'PDF', docx: 'Word (.docx)', jpg: 'JPEG image' };

export default function DataIO({ doc, capture, importColumns, importSheet, onImport, label = 'records', extraAccept, onExtraFiles }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = async (fmt: Fmt) => {
    setOpen(false);
    setBusy(`Preparing ${LABEL[fmt]}…`);
    try {
      let result: 'saved' | 'declined';
      if (fmt === 'jpg') {
        const el = capture?.();
        if (!el) throw new Error('Nothing to capture.');
        result = await exportJpeg(el, (await doc()).filename);
      } else {
        const d = await doc();
        result = fmt === 'xlsx' ? await exportExcel(d) : fmt === 'pdf' ? await exportPdf(d) : await exportWord(d);
      }
      notify(result === 'saved' ? `${LABEL[fmt]} ready.` : 'Download cancelled.');
    } catch (e) {
      notify(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length && onExtraFiles) {
      onExtraFiles(images);
      if (images.length === files.length) return;
    }
    const file = files.find((f) => !f.type.startsWith('image/'));
    // a Word file or NEAS PDF with a matching data table imports as data; any other report document becomes a template
    const dataTable = file && /\.(docx|pdf)$/i.test(file.name) && importColumns && onImport
      ? await importTable(file, importColumns, importSheet).then((x) => x.rows.some((r) => Object.values(r).filter((v) => String(v ?? '').trim()).length >= 2)).catch(() => false)
      : false;
    if (file && !dataTable && /\.(docx?|pptx?|pdf)$/i.test(file.name)) {
      setBusy(`Reading ${file.name}…`);
      try {
        const { templateFromFile } = await import('@/lib/templateImport');
        const def = await templateFromFile(file);
        sessionStorage.setItem('neas-imported-template', JSON.stringify({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 100), definition: def }));
        window.location.href = '/templates?imported=1';
      } catch (e) {
        setBusy(null);
        const m = (e as Error).message;
        notify(/dynamically imported module|Failed to fetch/i.test(m) ? 'Reading Word or PowerPoint files needs a connection the first time. Try again when you are online.' : m);
      }
      return;
    }
    if (!file || !importColumns || !onImport) {
      if (file) notify('Only photos can be imported here.');
      return;
    }
    setBusy(`Reading ${file.name}…`);
    try {
      const { rows, source } = await importTable(file, importColumns, importSheet);
      if (!rows.length) throw new Error('No rows found. Check that the first row holds the column names.');
      const plan = onImport(rows);
      setBusy(null);
      const errs = plan.errors.length ? ` ${plan.errors.length} row(s) skipped: ${plan.errors.slice(0, 3).join('; ')}${plan.errors.length > 3 ? '…' : ''}` : '';
      if (!plan.added && !plan.updated) {
        notify(`Nothing to import from ${source}.${errs}`);
        return;
      }
      const ok = await askConfirm(`Import from ${source}: ${plan.added} new and ${plan.updated} updated ${label}.${errs} Continue?`, { danger: false });
      if (ok) {
        plan.apply();
        notify(`Imported ${plan.added + plan.updated} ${label} from ${source}. Google Sheet will update automatically.`);
      }
    } catch (e) {
      notify(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const accept = [importColumns ? IMPORT_ACCEPT : '', extraAccept ?? ''].filter(Boolean).join(',');

  return (
    <div className="io" ref={boxRef}>
      <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!!busy}>
        Export ▾
      </button>
      {open && (
        <div className="io-menu" role="menu">
          {(['xlsx', 'pdf', 'docx', 'jpg'] as Fmt[])
            .filter((f) => f !== 'jpg' || capture)
            .map((f) => (
              <button key={f} role="menuitem" onClick={() => run(f)}>
                <span className={`io-badge io-${f}`}>{f.toUpperCase()}</span>
                {LABEL[f]}
              </button>
            ))}
        </div>
      )}
      {accept && (
        <>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            Import
          </button>
          <input ref={fileRef} type="file" hidden accept={accept} multiple={!!onExtraFiles} onChange={(e) => onFiles(e.target.files)} aria-label="Import file" />
        </>
      )}
      {busy && <span className="note" role="status">{busy}</span>}
    </div>
  );
}
