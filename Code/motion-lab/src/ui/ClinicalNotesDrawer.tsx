import { useEffect, useState } from 'react';
import { Check, MessageSquarePlus, Trash2, X } from 'lucide-react';
import type { AnnotationTag, TrialAnnotation } from '../model';
import type { Lang } from '../text';
import { annotationTagLabels, type ArchiveText } from './archive';

const quickTags: readonly AnnotationTag[] = [
  'shrug',
  'trunk_lean',
  'elbow_deficit',
  'grip_slip',
  'fatigue_tremor',
];

export function ClinicalNotesDrawer({
  open,
  onClose,
  positionMs,
  annotations,
  clinicalNote,
  prescription,
  reviewed,
  canSave,
  saving,
  lang,
  copy,
  onSeek,
  onSaveAll,
}: {
  open: boolean;
  onClose: () => void;
  positionMs: number;
  annotations: readonly TrialAnnotation[];
  clinicalNote: string;
  prescription: string;
  reviewed: boolean;
  canSave: boolean;
  saving: boolean;
  lang: Lang;
  copy: ArchiveText;
  onSeek: (atMs: number) => void;
  onSaveAll: (next: {
    annotations: TrialAnnotation[];
    clinicalNote: string;
    prescription: string;
    markReviewed?: boolean;
  }) => Promise<void> | void;
}) {
  const [selectedTag, setSelectedTag] = useState<AnnotationTag>('shrug');
  const [draftNote, setDraftNote] = useState('');
  const [noteText, setNoteText] = useState(clinicalNote);
  const [rxText, setRxText] = useState(prescription);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setNoteText(clinicalNote);
    setRxText(prescription);
  }, [clinicalNote, prescription]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tagLabels = annotationTagLabels[lang];
  const sorted = [...annotations].sort((a, b) => a.atMs - b.atMs);
  const dirtyNotes = noteText !== clinicalNote || rxText !== prescription;

  async function addMarker() {
    const ann: TrialAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      atMs: Math.max(0, Math.round(positionMs)),
      tag: selectedTag,
      note: draftNote.trim(),
      createdAt: Date.now(),
    };
    const nextList = [...annotations, ann].sort((a, b) => a.atMs - b.atMs);
    setDraftNote('');
    await onSaveAll({ annotations: nextList, clinicalNote: noteText, prescription: rxText });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  }

  async function removeMarker(id: string) {
    const nextList = annotations.filter((a) => a.id !== id);
    await onSaveAll({ annotations: nextList, clinicalNote: noteText, prescription: rxText });
  }

  async function commitNotes(markReviewed?: boolean) {
    await onSaveAll({
      annotations: [...annotations],
      clinicalNote: noteText,
      prescription: rxText,
      markReviewed,
    });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  }

  return <>
    <div className="drawer-scrim" aria-hidden="true" onClick={onClose} />
    <aside className="glass clinical-drawer" role="dialog" aria-modal="false" aria-label={copy.annotationsTitle}>
      <header className="clinical-drawer-head">
        <div className="clinical-drawer-title">
          <MessageSquarePlus size={16} />
          <h2>{copy.annotationsTitle}</h2>
        </div>
        <button type="button" className="icon-button" aria-label={copy.cancel} onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="clinical-drawer-body">
        <section className="well drawer-section">
          <div className="drawer-section-head">
            <span>{copy.addAnnotation}</span>
            <span className="chip">{(positionMs / 1000).toFixed(3)} s</span>
          </div>
          <div className="tag-pill-grid" role="group" aria-label={copy.addAnnotation}>
            {quickTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="button tag-quick-pill"
                aria-pressed={selectedTag === tag}
                onClick={() => setSelectedTag(tag)}
              >
                {tagLabels[tag]}
              </button>
            ))}
          </div>
          <div className="drawer-add-row">
            <input
              type="text"
              value={draftNote}
              maxLength={80}
              placeholder={copy.notePlaceholder}
              onChange={(event) => setDraftNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSave && !saving) {
                  event.preventDefault();
                  void addMarker();
                }
              }}
            />
            <button type="button" className="button btn-primary" disabled={!canSave || saving} onClick={() => void addMarker()}>
              {copy.addNoteBtn}
            </button>
          </div>
        </section>

        <section className="drawer-annotations-list">
          {sorted.length === 0 ? (
            <p className="drawer-empty">{copy.noAnnotations}</p>
          ) : (
            <ul>
              {sorted.map((ann) => (
                <li key={ann.id} className="well drawer-ann-item">
                  <button type="button" className="drawer-ann-jump" onClick={() => onSeek(ann.atMs)}>
                    <span className="drawer-ann-time">{(ann.atMs / 1000).toFixed(2)} s</span>
                    <span className="drawer-ann-tag" data-tag={ann.tag}>{tagLabels[ann.tag]}</span>
                    <span className="drawer-ann-text">{ann.note || tagLabels[ann.tag]}</span>
                  </button>
                  {canSave && <button
                    type="button"
                    className="icon-button drawer-ann-del"
                    aria-label="Delete"
                    onClick={() => void removeMarker(ann.id)}
                  >
                    <Trash2 size={13} />
                  </button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="well drawer-section drawer-notes-box">
          <label className="drawer-field">
            <span>{copy.clinicianNote}</span>
            <textarea
              rows={3}
              value={noteText}
              maxLength={400}
              placeholder={copy.noteAreaPlaceholder}
              onChange={(event) => setNoteText(event.target.value)}
            />
          </label>
          <label className="drawer-field">
            <span>{copy.prescription}</span>
            <textarea
              rows={2}
              value={rxText}
              maxLength={320}
              placeholder={copy.rxAreaPlaceholder}
              onChange={(event) => setRxText(event.target.value)}
            />
          </label>
        </section>
      </div>

      <footer className="clinical-drawer-foot">
        {savedNotice && <span className="drawer-saved-pill"><Check size={13} />{copy.notesSaved}</span>}
        <button
          type="button"
          className="button"
          disabled={!canSave || saving || !dirtyNotes}
          onClick={() => void commitNotes(false)}
        >
          {copy.saveNotes}
        </button>
        {!reviewed && <button
          type="button"
          className="button btn-primary"
          disabled={!canSave || saving}
          onClick={() => void commitNotes(true)}
        >
          <Check size={14} />{copy.saveAndReview}
        </button>}
      </footer>
    </aside>
  </>;
}
