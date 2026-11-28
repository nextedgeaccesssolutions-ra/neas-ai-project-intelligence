import type { ReactNode } from 'react';

// Shared sign-in layout (staff, client passcode, activation, password set-up): a brand panel
// with the page's purpose beside the form panel; stacks to one column on phones.
export default function AuthCard({ title, subtitle, eyebrow = 'NEAS Project Control', note, children }: { title: string; subtitle?: string; eyebrow?: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-grid">
        <section className="auth-hero" aria-labelledby="auth-title">
          <div className="auth-brand">
            <img className="brand-mark brand-logo" src="/neas-logo.png" alt="NEAS — NextEdge Access Solutions" width={48} height={48} />
            <span>
              <div className="auth-brand-name">NEAS INTELLIGENCE</div>
              <div className="brand-sub">PROJECT CONTROL</div>
            </span>
          </div>
          <div className="auth-eyebrow">{eyebrow}</div>
          <h1 id="auth-title">{title}</h1>
          {subtitle && <p className="lead">{subtitle}</p>}
          {note && <div className="auth-note">{note}</div>}
        </section>
        {children && <div className="auth-card">{children}</div>}
      </div>
    </div>
  );
}
