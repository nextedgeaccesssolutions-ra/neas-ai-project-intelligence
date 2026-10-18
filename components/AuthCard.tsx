import type { ReactNode } from 'react';

export default function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">NE</span>
          <span>
            <div className="auth-brand-name">NEAS INTELLIGENCE</div>
            <div className="brand-sub">PROJECT CONTROL</div>
          </span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="lead">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
