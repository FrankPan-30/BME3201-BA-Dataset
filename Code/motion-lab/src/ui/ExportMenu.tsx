import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, FileJson, Video } from 'lucide-react';
import type { ArchiveText } from './archive';

export type ExportMenuProps = {
  copy: ArchiveText;
  hasVideo?: boolean;
  onExportPdf: () => Promise<void> | void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportVideo?: () => void;
};

export function ExportMenu({ copy, hasVideo = false, onExportPdf, onExportCsv, onExportJson, onExportVideo }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function runPdf() {
    setBusy(true);
    try {
      await onExportPdf();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return <div className="export-menu-wrap" ref={rootRef}>
    <button
      type="button"
      className="button toolbar-sub-btn export-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={busy}
      onClick={() => setOpen((cur) => !cur)}
    >
      <Download size={14} />
      <span>{copy.exportBtn}</span>
      <ChevronDown size={13} />
    </button>
    {open && <div className="glass export-dropdown" role="menu">
      <button type="button" className="export-item" role="menuitem" disabled={busy} onClick={() => void runPdf()}>
        <FileText size={14} /><span>{copy.exportPdf}</span>
      </button>
      <button type="button" className="export-item" role="menuitem" onClick={() => { onExportCsv(); setOpen(false); }}>
        <FileSpreadsheet size={14} /><span>{copy.exportCsv}</span>
      </button>
      <button type="button" className="export-item" role="menuitem" onClick={() => { onExportJson(); setOpen(false); }}>
        <FileJson size={14} /><span>{copy.exportJson}</span>
      </button>
      {onExportVideo && <button
        type="button"
        className="export-item"
        role="menuitem"
        disabled={!hasVideo}
        onClick={() => { onExportVideo(); setOpen(false); }}
      >
        <Video size={14} /><span>{copy.exportVideo}</span>
      </button>}
    </div>}
  </div>;
}
