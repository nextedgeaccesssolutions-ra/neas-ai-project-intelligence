'use client';
// Select-all, Group, Ungroup, Hide and Unhide for any list or table, built on the saved groups and
// personal hidden items in lib/viewOrg.ts. Display only: the records themselves never change.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import OrgToolbar, { GroupHeader } from '@/components/OrgToolbar';
import { askConfirm, notify } from '@/components/Dialogs';
import { itemKey, useCollapsed, useViewOrg, type ItemKind, type ListKey, type ViewGroup } from '@/lib/viewOrg';
import { canManage, useCloudStatus } from '@/lib/cloud/cloudSync';
import { CLOUD } from '@/lib/cloud/env';

interface Opts<T> {
  list: ListKey;
  kind: ItemKind;
  items: T[];
  id: (t: T) => string;
  /** the record's project (for projects themselves: their own id) */
  project: (t: T) => string;
  /** what the list calls one item, for messages ("photo", "report", "project") */
  noun?: string;
}

export function useOrgList<T>({ list, kind, items, id, project, noun = 'item' }: Opts<T>) {
  const cloud = useCloudStatus();
  const org = useViewOrg(list, cloud.profile?.id ?? null);
  const open = useCollapsed(`neas-groups-${list}`);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [renaming, setRenaming] = useState<ViewGroup | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const key = (t: T) => itemKey(kind, id(t));

  const listed = items.filter((t) => (showHidden ? org.hiddenSet.has(key(t)) : !org.hiddenSet.has(key(t))));
  const groups = showHidden ? [] : org.groups
    .map((g) => ({ g, items: listed.filter((t) => org.groupOf.get(key(t))?.id === g.id) }))
    .filter((x) => x.items.length);
  const inGroup = new Set(groups.flatMap((x) => x.items.map(id)));
  const ungrouped = listed.filter((t) => !inGroup.has(id(t)));
  const pickedItems = listed.filter((t) => picked.has(id(t)));
  const pickedIds = pickedItems.map(id);
  const projects = [...new Set(pickedItems.map(project))];
  // groups of projects are personal and span projects; every other group belongs to one project
  const groupProject = list === 'projects' ? null : projects.length === 1 ? projects[0] : undefined;
  const editable = (g: ViewGroup) => g.scope === 'personal' || (!!g.project_id && canManage(g.project_id));
  useEffect(() => { setPicked(new Set()); }, [showHidden]);

  const toggle = (t: T) => setPicked((p) => { const n = new Set(p); if (n.has(id(t))) n.delete(id(t)); else n.add(id(t)); return n; });
  const allOn = listed.length > 0 && listed.every((t) => picked.has(id(t)));
  const someOn = !allOn && listed.some((t) => picked.has(id(t)));
  const done = (ok: boolean, msg: string) => { if (ok) { notify(msg); setPicked(new Set()); } };

  const checkbox = (t: T) => (
    <input type="checkbox" className="org-pick" checked={picked.has(id(t))} onChange={() => toggle(t)} onClick={(e) => e.stopPropagation()} aria-label={`Select this ${noun}`} />
  );
  const headerCheckbox = <SelectAll on={allOn} some={someOn} onChange={() => setPicked(allOn ? new Set() : new Set(listed.map(id)))} label={`Select all ${listed.length} shown`} />;

  const toolbar = (
    <>
      <OrgToolbar
        selected={pickedIds.length}
        groups={org.groups.filter((g) => editable(g) && (groupProject === null ? g.project_id === null : g.project_id === groupProject))}
        canShare={CLOUD && !!groupProject && canManage(groupProject)}
        showHidden={showHidden}
        hiddenCount={items.filter((t) => org.hiddenSet.has(key(t))).length}
        anyGrouped={pickedItems.some((t) => org.groupOf.has(key(t)))}
        onGroup={async (target) => {
          if (groupProject === undefined) { notify(`Select ${noun}s from one project to group them.`); return false; }
          const ok = !!(await org.group(groupProject, kind, pickedIds, target));
          done(ok, `Grouped ${pickedIds.length} ${noun}(s). Nothing else changed.`);
          return ok;
        }}
        onUngroup={async () => done(await org.ungroup(kind, pickedIds), 'Ungrouped. They are back in the main list.')}
        onHide={async () => done(await org.hide((i) => project(items.find((t) => id(t) === i)!), kind, pickedIds), `Hidden from your view: ${pickedIds.length} ${noun}(s). Find them under Hidden items.`)}
        onUnhide={async () => done(await org.unhide((i) => project(items.find((t) => id(t) === i)!), kind, pickedIds), 'Back in your list.')}
        onToggleHidden={() => setShowHidden((v) => !v)}
        onClear={() => setPicked(new Set())}
        onSelectAll={() => setPicked(new Set(listed.map(id)))}
        allSelected={allOn}
        total={listed.length}
      />
      {org.error && <p className="bad" role="alert">{org.error} <button className="linklike" onClick={org.clearError}>Dismiss</button></p>}
      {showHidden && <p className="note">Hidden only from your own view. Hiding never deletes anything or changes who can see it.</p>}
      {groups.length > 1 && (
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-sm" onClick={() => open.setAll(groups.map((x) => x.g.id))}>Expand all groups</button>
          <button className="btn btn-sm" onClick={() => open.setAll([])}>Collapse all groups</button>
        </div>
      )}
      {renaming && (
        <form className="org-form" onSubmit={async (e) => { e.preventDefault(); if (await org.rename(renaming, renameTo)) { notify('Group renamed.'); setRenaming(null); } }}>
          <label className="field">New name for “{renaming.name}”<input className="input" autoFocus maxLength={80} required value={renameTo} onChange={(e) => setRenameTo(e.target.value)} /></label>
          <div className="form-actions"><button className="btn btn-sm btn-primary">Rename</button><button type="button" className="btn btn-sm" onClick={() => setRenaming(null)}>Cancel</button></div>
        </form>
      )}
    </>
  );

  const header = (g: ViewGroup, count: number) => (
    <GroupHeader label={g.name} count={count} open={open.isOpen(g.id)} onToggle={() => open.toggle(g.id)}
      badge={g.scope === 'project' ? 'Shared with project' : 'Only you'}
      onRename={editable(g) ? () => { setRenaming(g); setRenameTo(g.name); } : undefined}
      onRemove={editable(g) ? () => askConfirm(`Remove the group "${g.name}"? Its ${count} ${noun}(s) go back to the main list. Nothing is deleted.`, { danger: false }).then(async (ok) => { if (ok && (await org.remove(g))) notify('Group removed.'); }) : undefined} />
  );

  /** Table bodies: one per open group (header row + rows), then the ungrouped rows. */
  const tbodies = (render: (t: T) => ReactNode, colSpan: number, rest: T[] = ungrouped) => (
    <>
      {groups.map(({ g, items: rows }) => (
        <tbody key={g.id}>
          <tr className="group-row"><td colSpan={colSpan}>{header(g, rows.length)}</td></tr>
          {open.isOpen(g.id) && rows.map((t) => <Fragment key={id(t)}>{render(t)}</Fragment>)}
        </tbody>
      ))}
      <tbody>{rest.map((t) => <Fragment key={id(t)}>{render(t)}</Fragment>)}</tbody>
    </>
  );

  /** Non-table lists: group sections rendered with the caller's own markup. */
  const sections = (render: (rows: T[]) => ReactNode) => groups.map(({ g, items: rows }) => (
    <div key={g.id}>{header(g, rows.length)}{open.isOpen(g.id) && render(rows)}</div>
  ));

  return { listed, ungrouped, groups, picked, checkbox, headerCheckbox, toolbar, tbodies, sections, showHidden };
}

function SelectAll({ on, some, onChange, label }: { on: boolean; some: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = some; }, [some]);
  return <input ref={ref} type="checkbox" className="org-pick" checked={on} onChange={onChange} aria-label={label} title={label} />;
}
