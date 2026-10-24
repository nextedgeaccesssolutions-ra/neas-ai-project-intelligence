'use client';
// Saved groups and personal hidden items for long lists (site evidence, report library).
// Display only: nothing here moves, renames, deletes or re-permissions a file or report.
// Cloud mode stores them in Supabase (RLS: personal rows are private, shared groups are per project);
// device mode keeps them in this browser.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CLOUD } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';

export type ListKey = 'evidence' | 'reports' | 'projects' | 'activities' | 'actions' | 'field_reports' | 'boq' | 'report_history';
export type ItemKind = 'attachment' | 'field_report' | 'project_export' | 'project' | 'activity' | 'boq_line';
export interface ViewGroup { id: string; project_id: string | null; list_key: ListKey; scope: 'personal' | 'project'; owner_id: string; name: string; sort_order: number }
interface GroupItem { group_id: string; item_kind: ItemKind; item_id: string }
interface Hidden { item_kind: ItemKind; item_id: string; project_id: string | null }
export const itemKey = (kind: ItemKind, id: string) => `${kind}:${id}`;

const LOCAL = 'neas-view-org';
type LocalState = { groups: ViewGroup[]; items: GroupItem[]; hidden: Hidden[] };
const readLocal = (): LocalState => { try { return JSON.parse(localStorage.getItem(LOCAL) ?? '') as LocalState; } catch { return { groups: [], items: [], hidden: [] }; } };
const writeLocal = (s: LocalState) => { try { localStorage.setItem(LOCAL, JSON.stringify(s)); } catch { /* storage blocked: view stays for this session */ } };

export function useViewOrg(list: ListKey, me: string | null) {
  const [groups, setGroups] = useState<ViewGroup[]>([]);
  const [items, setItems] = useState<GroupItem[]>([]);
  const [hidden, setHidden] = useState<Hidden[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sb = CLOUD ? supabaseBrowser() : null;

  const load = useCallback(async () => {
    if (!sb) {
      const l = readLocal();
      setGroups(l.groups.filter((g) => g.list_key === list));
      setItems(l.items);
      setHidden(l.hidden);
      return;
    }
    const [g, i, h] = await Promise.all([
      sb.from('view_groups').select('id, project_id, list_key, scope, owner_id, name, sort_order').eq('list_key', list).order('sort_order').order('name'),
      sb.from('view_group_items').select('group_id, item_kind, item_id').limit(10000),
      sb.from('hidden_items').select('item_kind, item_id, project_id').limit(10000),
    ]);
    setError(g.error || i.error || h.error ? 'Saved groups could not be loaded. The list is shown ungrouped.' : null);
    setGroups((g.data as ViewGroup[]) ?? []);
    setItems((i.data as GroupItem[]) ?? []);
    setHidden((h.data as Hidden[]) ?? []);
  }, [sb, list]);
  useEffect(() => { void load(); }, [load]);

  const hiddenSet = useMemo(() => new Set(hidden.map((h) => itemKey(h.item_kind, h.item_id))), [hidden]);
  /** item → its group in the given view (personal view wins over the shared one for display) */
  const groupOf = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g]));
    const m = new Map<string, ViewGroup>();
    for (const it of items) {
      const g = byId.get(it.group_id);
      if (!g) continue;
      const k = itemKey(it.item_kind, it.item_id);
      const cur = m.get(k);
      if (!cur || (cur.scope === 'project' && g.scope === 'personal')) m.set(k, g);
    }
    return m;
  }, [groups, items]);

  const fail = (msg: string): false => { setError(msg); return false; };

  /** Put items into a group (creating it when no id is given). One project per call. */
  const group = async (projectId: string | null, kind: ItemKind, ids: string[], target: { id?: string; name?: string; scope?: 'personal' | 'project' }): Promise<string | false> => {
    if (!ids.length) return false;
    if (!sb) {
      const l = readLocal();
      let gid = target.id;
      if (!gid) {
        gid = crypto.randomUUID();
        l.groups.push({ id: gid, project_id: projectId, list_key: list, scope: 'personal', owner_id: me ?? 'device', name: (target.name ?? '').trim().slice(0, 80), sort_order: l.groups.length });
      }
      const set = new Set(ids);
      l.items = l.items.filter((x) => !(x.item_kind === kind && set.has(x.item_id))).concat(ids.map((id) => ({ group_id: gid!, item_kind: kind, item_id: id })));
      writeLocal(l);
      await load();
      return gid;
    }
    let gid = target.id;
    if (!gid) {
      const name = (target.name ?? '').trim();
      if (!name) return fail('Enter a group name.');
      const { data, error: e } = await sb.from('view_groups').insert({ project_id: projectId, list_key: list, scope: target.scope ?? 'personal', name: name.slice(0, 80), owner_id: me }).select('id').single();
      if (e || !data) return fail(e?.code === '23505' ? 'A group with that name already exists here.' : 'The group could not be created.');
      gid = (data as { id: string }).id;
    }
    const { error: e } = await sb.rpc('move_items_to_group', { p_group: gid, p_kind: kind, p_ids: ids });
    await load();
    return e ? fail(e.message) : gid;
  };

  /** Take items out of their group in the view they are shown in. The items themselves are untouched. */
  const ungroup = async (kind: ItemKind, ids: string[]): Promise<boolean> => {
    const gids = [...new Set(ids.map((id) => groupOf.get(itemKey(kind, id))?.id).filter(Boolean))] as string[];
    if (!gids.length) return false;
    if (!sb) {
      const l = readLocal();
      const set = new Set(ids);
      l.items = l.items.filter((x) => !(x.item_kind === kind && set.has(x.item_id) && gids.includes(x.group_id)));
      writeLocal(l);
      await load();
      return true;
    }
    const { error: e } = await sb.from('view_group_items').delete().eq('item_kind', kind).in('item_id', ids).in('group_id', gids);
    await load();
    return e ? fail('Could not ungroup: you can only change your own groups, or shared groups as a project manager.') : true;
  };

  const rename = async (g: ViewGroup, name: string) => {
    const n = name.trim().slice(0, 80);
    if (!n) return false;
    if (!sb) { const l = readLocal(); l.groups = l.groups.map((x) => (x.id === g.id ? { ...x, name: n } : x)); writeLocal(l); await load(); return true; }
    const { data, error: e } = await sb.from('view_groups').update({ name: n }).eq('id', g.id).select('id');
    await load();
    return e || !data?.length ? fail(e?.code === '23505' ? 'A group with that name already exists here.' : 'You cannot rename this group.') : true;
  };

  /** Remove a group. Its items return to the ungrouped list; no file or report is deleted. */
  const remove = async (g: ViewGroup) => {
    if (!sb) { const l = readLocal(); l.groups = l.groups.filter((x) => x.id !== g.id); l.items = l.items.filter((x) => x.group_id !== g.id); writeLocal(l); await load(); return true; }
    const { data, error: e } = await sb.from('view_groups').delete().eq('id', g.id).select('id');
    await load();
    return e || !data?.length ? fail('You cannot remove this group.') : true;
  };

  const setHiddenFor = async (projectOf: (id: string) => string, kind: ItemKind, ids: string[], hide: boolean) => {
    if (!ids.length) return false;
    if (!sb) {
      const l = readLocal();
      const set = new Set(ids);
      l.hidden = l.hidden.filter((x) => !(x.item_kind === kind && set.has(x.item_id)));
      if (hide) l.hidden.push(...ids.map((id) => ({ item_kind: kind, item_id: id, project_id: projectOf(id) })));
      writeLocal(l);
      await load();
      return true;
    }
    const { error: e } = hide
      ? await sb.from('hidden_items').upsert(ids.map((id) => ({ item_kind: kind, item_id: id, project_id: projectOf(id), user_id: me })), { onConflict: 'user_id,item_kind,item_id', ignoreDuplicates: true })
      : await sb.from('hidden_items').delete().eq('item_kind', kind).in('item_id', ids);
    await load();
    return e ? fail(hide ? 'Could not hide the selected items.' : 'Could not unhide the selected items.') : true;
  };

  return { groups, groupOf, hiddenSet, error, clearError: () => setError(null), group, ungroup, rename, remove, hide: (p: (id: string) => string, k: ItemKind, ids: string[]) => setHiddenFor(p, k, ids, true), unhide: (p: (id: string) => string, k: ItemKind, ids: string[]) => setHiddenFor(p, k, ids, false), reload: load };
}

/** Collapsed/expanded state of group sections, remembered on this device. */
export function useCollapsed(storeKey: string) {
  const [open, setOpen] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(storeKey) ?? '[]') as string[]); } catch { return new Set(); } });
  const save = (s: Set<string>) => { setOpen(s); try { localStorage.setItem(storeKey, JSON.stringify([...s])); } catch { /* per-device convenience */ } };
  return {
    isOpen: (k: string) => open.has(k),
    toggle: (k: string) => { const s = new Set(open); if (s.has(k)) s.delete(k); else s.add(k); save(s); },
    setAll: (keys: string[]) => save(new Set(keys)),
  };
}
