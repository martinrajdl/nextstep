import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import WorkspaceApp from './workspace';
import AppSettings from '@/components/app-settings';
const JobWorkspace = lazy(() => import('./page'));
import './globals.css';
createRoot(document.getElementById('root')!).render(
  <AppSettings>
    {window.location.pathname === '/jobs' ? (
      <Suspense fallback={<p>Opening job search…</p>}>
        <JobWorkspace />
      </Suspense>
    ) : (
      <WorkspaceApp />
    )}
  </AppSettings>,
);
