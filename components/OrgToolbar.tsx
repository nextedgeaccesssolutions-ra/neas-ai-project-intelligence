'use client';
// Selection toolbar for long lists: Group selected, Ungroup, Hide, Unhide, and the Hidden-items view.
// Only actions that apply to the current selection are shown.
import { useState } from 'react';
import type { ViewGroup } from '@/lib/viewOrg';

export default function OrgToolbar({ selected, groups, canShare, showHidden, hiddenCount, anyGrouped, onGroup, onUngroup, onHide, onUnhide, onToggleHidden, onClear, onSelectAll, allSelected = false, total }: {
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

/** Header row of a collapsible group section. */
export function GroupHeader({ label, count, open, onToggle, badge, onRename, onRemove }: { label: string; count: number; open: boolean; onToggle: () => void; badge?: string; onRename?: () => void; onRemove?: () => void }) {
  return (
    <div className="org-head">
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
