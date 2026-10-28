'use client';
// Project map: every project placed at the middle of its photos' GPS points (only real GPS, never guessed),
// shown together on one map (OpenStreetMap tiles) with a list underneath.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import 'leaflet/dist/leaflet.css';
import { useStore } from '@/lib/store';
import { mapUrl } from '@/lib/geo';

export default function ProjectMap() {
  const { state, setActiveProject } = useStore();
  const places = state.projects.map((p) => {
    const pts = state.evidence.filter((e) => e.projectId === p.id && e.gps && (e.gpsStatus === 'captured' || e.gpsStatus === 'manual')).map((e) => e.gps!);
    if (!pts.length) return null;
    return { p, lat: pts.reduce((s, g) => s + g.lat, 0) / pts.length, lng: pts.reduce((s, g) => s + g.lng, 0) / pts.length, n: pts.length };
  }).filter((x): x is NonNullable<typeof x> => !!x);
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const markers = useRef(new Map<string, import('leaflet').CircleMarker>());
  const key = places.map((x) => `${x.p.id}:${x.p.code}:${x.p.name}:${x.lat.toFixed(5)},${x.lng.toFixed(5)}`).join('|');

  useEffect(() => {
    if (!box.current || !places.length) return;
    let gone = false;
    void import('leaflet').then((L) => {
      if (gone || !box.current) return;
      map.current?.remove();
      const m = L.map(box.current, { scrollWheelZoom: false });
      map.current = m;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
      markers.current.clear();
      for (const x of places) {
        const mk = L.circleMarker([x.lat, x.lng], { radius: 9, color: '#071d29', weight: 2, fillColor: '#ca9332', fillOpacity: 0.95 }).addTo(m);
        const label = document.createElement('div');
        label.textContent = `${x.p.code ?? ''} · ${x.p.name}`;
        mk.bindPopup(label);
        mk.on('click', () => setSel(x.p.id));
        markers.current.set(x.p.id, mk);
      }
      m.fitBounds(L.latLngBounds(places.map((x) => [x.lat, x.lng] as [number, number])).pad(0.3), { maxZoom: 16 });
    });
    return () => { gone = true; map.current?.remove(); map.current = null; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const focus = (id: string) => {
    setSel(id);
    const mk = markers.current.get(id);
    if (mk && map.current) { map.current.setView(mk.getLatLng(), 16); mk.openPopup(); box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  };

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Projects</div><h1>Project map</h1><p className="lead">Projects placed by the GPS of their site photos. Projects without GPS photos are not shown.</p></div></div>
      {!places.length ? <div className="card empty">No project has photos with GPS yet.</div> : (
        <section className="card fr-card">
          <div ref={box} className="map-frame" role="region" aria-label={`Map of ${places.length} project(s)`} />
          <ul className="more-list">
            {places.map((x) => (
              <li key={x.p.id}>
                <button type="button" className={x.p.id === sel ? 'on' : ''} onClick={() => focus(x.p.id)}>
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
