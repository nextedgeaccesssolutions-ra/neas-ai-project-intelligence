// Line icons for the field screens (report types, weather, quick actions). 24×24, drawn in currentColor.
const P: Record<string, string> = {
  progress: 'M5 20V12M10 20V8M15 20V4M20 20v-6',
  inspection: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  issue: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  other: 'M6 12h.01M12 12h.01M18 12h.01',
  sunny: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  cloudy: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z',
  rainy: 'M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3',
  windy: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8',
  camera: 'M4 7h3l2-3h6l2 3h3v13H4zM12 10a4 4 0 1 0 0 8a4 4 0 1 0 0-8',
  photos: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8h.01',
  offline: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18zM12 10v6M9 13l3 3 3-3',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  report: 'M7 3h10v18H7zM10 8h4M10 12h4M10 16h2',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
};

export default function FieldIcon({ name, size = 22 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'other' || name === 'drag' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
