'use client';
// "More": everything that is not on the phone bottom bar, filtered to what this account may open.
import Link from 'next/link';
import { CLOUD } from '@/lib/cloud/env';
import { canManage, canView, isClientViews, useCloudStatus, viewOfPath } from '@/lib/cloud/cloudSync';
import { useStore } from '@/lib/store';

const LINKS: [string, string, string][] = [
  ['/site-evidence', 'Site evidence', 'Take and manage site photos'],
  ['/photos', 'Photo library', 'Every photo by project, area, floor and category'],
  ['/map', 'Project map', 'Where projects and photos were taken'],
  ['/scan', 'Scan QR code', 'Open a project from its QR code'],
  ['/project-management', 'Schedule & Gantt', 'Activities, progress and the Gantt chart'],
  ['/reports', 'Project reports', 'Build and send the project report'],
  ['/global-reports', 'Global reports', 'All reports, sharing and activity'],
  ['/templates', 'Report templates', 'Per-project report templates'],
  ['/estimating', 'Estimating & BOQ', 'Bill of quantities'],
  ['/offline-queue', 'Offline queue', 'Changes waiting to sync'],
  ['/account', 'Account', 'Your profile, passcode and sign out'],
];

export default function More() {
  const cloud = useCloudStatus();
  const { state } = useStore();
  // same rules as the side menu: the module must be allowed, and estimating is for managers
  const links = LINKS.filter(([href]) => !CLOUD || href === '/account'
    || ((viewOfPath(href) === null ? !isClientViews(cloud.profile?.allowed_views) : canView(viewOfPath(href), cloud.profile)) && (href !== '/estimating' || canManage(state.activeProjectId))));
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Menu</div><h1>More</h1></div></div>
      <ul className="more-list">
        {links.map(([href, label, sub]) => (
          <li key={href}><Link href={href}><b>{label}</b><span className="note">{sub}</span><span aria-hidden="true">›</span></Link></li>
        ))}
        {CLOUD && cloud.profile?.global_role === 'super_admin' && <li><Link href="/admin"><b>Control panel</b><span className="note">Users, access, sync and audit</span><span aria-hidden="true">›</span></Link></li>}
      </ul>
    </>
  );
}
