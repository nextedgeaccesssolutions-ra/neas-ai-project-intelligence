'use client';
// Selection toolbar for long lists: Group selected, Ungroup, Hide, Unhide, and the Hidden-items view.
// Only actions that apply to the current selection are shown.
import { useState } from 'react';
import type { ViewGroup } from '@/lib/viewOrg';

export default function OrgToolbar({ selected, groups, canShare, showHidden, hiddenCount, anyGrouped, onGroup, onUngroup, onHide, onUnhide, onToggleHidden, onClear, onSelectAll, allSelected = false, total, onDelete }: {
  selected: number;
  groups: ViewGroup[];
  canShare: boolean;
  showHidden: boolean;
  hiddenCount: number;
  anyGrouped: boolean;
  onGroup: (t: { id?: string; name?: string; scope?: 'personal' | 'project' }) => Promise<boolean>;
  onUngroup: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onToggleHidden: () => void;
  onClear: () => void;
  onSelectAll: () => void;
  /** every shown item is selected (the checkbox then clears the selection) */
  allSelected?: boolean;
  /** how many items are shown */
  total?: number;
  /** permanently delete the selected items (shown only when given) */
  onDelete?: () => void;
}) {
  const [form, setForm] = useState(false);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'personal' | 'project'>('personal');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onGroup(target ? { id: target } : { name, scope });
    setBusy(false);
    if (ok) { setForm(false); setName(''); setTarget(''); }
  };
  return (
    <div className="org-bar" role="toolbar" aria-label="Organise list">
      <span className="org-count" aria-live="polite">{selected ? `${selected} selected` : showHidden ? 'Hidden items' : 'Select items to group or hide'}</span>
      <label className="org-all"><input type="checkbox" className="org-pick" checked={allSelected} onChange={() => (allSelected ? onClear() : onSelectAll())} /> Select all{total != null ? ` (${total})` : ''}</label>
      {selected > 0 && <>
        {!showHidden && <button className="btn btn-sm btn-primary" onClick={() => setForm((f) => !f)} aria-expanded={form}>Group selected</button>}
        {!showHidden && anyGrouped && <button className="btn btn-sm" onClick={onUngroup}>Ungroup</button>}
        {showHidden ? <button className="btn btn-sm btn-primary" onClick={onUnhide}>Unhide</button> : <button className="btn btn-sm" onClick={onHide}>Hide</button>}
        {onDelete && <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete selected ({selected})</button>}
        <button className="btn btn-sm" onClick={onClear}>Clear selection</button>
      </>}
      <button className={`btn btn-sm ${showHidden ? 'btn-primary' : ''}`} onClick={onToggleHidden} aria-pressed={showHidden}>
        {showHidden ? 'Back to list' : `Hidden items (${hiddenCount})`}
      </button>
      {form && selected > 0 && (
        <form className="org-form" onSubmit={submit}>
          <label className="field">Add to
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">New group…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.scope === 'project' ? ' (shared)' : ''}</option>)}
            </select>
          </label>
          {!target && <>
            <label className="field">Group name<input className="input" autoFocus maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North facade, Week 43" /></label>
            <label className="field">Who sees it
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value as 'personal' | 'project')}>
                <option value="personal">Only me</option>
                {canShare && <option value="project">Everyone on the project</option>}
              </select>
            </label>
          </>}
          <div className="form-actions"><button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save group'}</button><button type="button" className="btn btn-sm" onClick={() => setForm(false)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

// ---- drag and drop between groups (mouse); phones use the "Move to" menu instead ----
const DRAG_TYPE = 'application/x-neas-items';

/** Props that make a card or row draggable. Dragging a selected item carries the whole selection. */
export function dragSource(id: string, picked: Set<string> | string[]) {
  const sel = Array.isArray(picked) ? picked : [...picked];
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // never start a drag from a field the person is typing or selecting text in
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) { e.preventDefault(); return; }
      const ids = sel.includes(id) ? sel : [id];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.setData('text/plain', `${ids.length} item(s)`);
      e.dataTransfer.effectAllowed = 'move';
    },
  };
}

/** Props for a drop target (a group header or the "Not in a group" zone). */
export function dropTarget(onDrop: (ids: string[]) => void, setOver: (v: boolean) => void) {
  return {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      try { const ids = JSON.parse(raw) as string[]; if (Array.isArray(ids) && ids.length) onDrop(ids); } catch { /* not ours */ }
    },
  };
}

/** Area that takes dropped items out of their group. */
export function UngroupZone({ label, onDrop }: { label: string; onDrop: (ids: string[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className={`drop-zone${over ? ' drop-over' : ''}`} {...dropTarget(onDrop, setOver)}>{label}</div>
  );
}

/** Touch-friendly alternative to dragging: choose the group from a list. */
export function MoveToMenu({ groups, current, currentEditable = true, onMove }: { groups: { id: string; name: string }[]; current: string | null; currentEditable?: boolean; onMove: (groupId: string | null) => void }) {
  // an item in a group this person cannot change stays where it is
  if (!groups.length || (current && !currentEditable)) return null;
  return (
    <select className="input input-sm move-to" value="" aria-label="Move to group" onChange={(e) => { const v = e.target.value; if (v) onMove(v === '__none' ? null : v); }} onClick={(e) => e.stopPropagation()}>
      <option value="">Move to…</option>
      {groups.filter((g) => g.id !== current).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      {current && <option value="__none">Not in a group</option>}
    </select>
  );
}

/** Header row of a collapsible group section. Items can be dropped on it to move them into the group. */
export function GroupHeader({ label, count, open, onToggle, badge, onRename, onRemove, onDropItems }: { label: string; count: number; open: boolean; onToggle: () => void; badge?: string; onRename?: () => void; onRemove?: () => void; onDropItems?: (ids: string[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className={`org-head${over ? ' drop-over' : ''}`} {...(onDropItems ? dropTarget(onDropItems, setOver) : {})}>
      <button className="group-toggle" aria-expanded={open} onClick={onToggle}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> <b>{label}</b> <span className="note">· {count} item(s)</span>
        {badge && <span className="pill" style={{ marginLeft: 8 }}>{badge}</span>}
      </button>
      {(onRename || onRemove) && (
        <span className="row-actions">
          {onRename && <button className="btn btn-sm" onClick={onRename}>Rename</button>}
          {onRemove && <button className="btn btn-sm" onClick={onRemove} title="Removes the group only; its items go back to the list">Remove group</button>}
        </span>
      )}
    </div>
  );
}
