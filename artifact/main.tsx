import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import { StoreProvider } from '@/lib/store';
import Shell from '@/components/Shell';
import Overview from '@/app/page';
import Estimating from '@/app/estimating/page';
import Quotation from '@/app/quotation/page';
import ProjectManagement from '@/app/project-management/page';
import FieldReports from '@/app/field-reports/page';
import Projects from '@/app/projects/page';
import SiteEvidence from '@/app/site-evidence/page';
import Sheets from '@/app/google-sheets/page';
import { useLocation } from './router';

const PAGES: Record<string, ComponentType> = {
  '/': Overview,
  '/estimating': Estimating,
  '/quotation': Quotation,
  '/project-management': ProjectManagement,
  '/field-reports': FieldReports,
  '/projects': Projects,
  '/site-evidence': SiteEvidence,
  '/google-sheets': Sheets,
};

function App() {
  const loc = useLocation();
  const Page = PAGES[loc.path] ?? Overview;
  return (
    <StoreProvider>
      <Shell>
        <Page key={loc.key} />
      </Shell>
    </StoreProvider>
  );
}

createRoot(document.getElementById('neas-root')!).render(<App />);
