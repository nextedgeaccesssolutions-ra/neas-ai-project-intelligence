'use client';
// Project map: each project placed at the middle of its photos' GPS points (only real GPS, never guessed).
import { useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { mapUrl } from '@/lib/geo';

export default function ProjectMap() {
  const { state, setActiveProject } = useStore();
  const places = state.projects.map((p) => {
    const pts = state.evidence.filter((e) => e.projectId === p.id && e.gps && (e.gpsStatus === 'captured' || e.gpsStatus === 'manual')).map((e) => e.gps!);
    if (!pts.length) return null;
    return { p, lat: pts.reduce((s, g) => s + g.lat, 0) / pts.length, lng: pts.reduce((s, g) => s + g.lng, 0) / pts.length, n: pts.length };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const [sel, setSel] = useState(0);
  const cur = places[sel];
  const d = 0.004;
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Projects</div><h1>Project map</h1><p className="lead">Projects placed by the GPS of their site photos. Projects without GPS photos are not shown.</p></div></div>
      {!places.length ? <div className="card empty">No project has photos with GPS yet.</div> : (
        <section className="card fr-card">
          {cur && (
            <iframe className="map-frame" title={`Map of ${cur.p.name}`} loading="lazy" referrerPolicy="no-referrer"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${cur.lng - d},${cur.lat - d},${cur.lng + d},${cur.lat + d}&layer=mapnik&marker=${cur.lat},${cur.lng}`} />
          )}
          <ul className="more-list">
            {places.map((x, i) => (
              <li key={x.p.id}>
                <button type="button" className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
                  <b>{x.p.code ?? ''} · {x.p.name}</b><span className="note">{x.p.site} · {x.n} photo(s) with GPS · {x.lat.toFixed(5)}, {x.lng.toFixed(5)}</span>
                </button>
                <span className="form-actions" style={{ margin: 0 }}>
                  <a className="btn btn-sm" href={mapUrl(x.lat, x.lng) ?? '#'} target="_blank" rel="noreferrer">Open in Maps</a>
                  <Link className="btn btn-sm btn-primary" href="/field-reports" onClick={() => setActiveProject(x.p.id)}>View reports</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
