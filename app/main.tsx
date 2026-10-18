import { createRoot } from 'react-dom/client';
import WorkspaceApp from './workspace';
import AppSettings from '@/components/app-settings';
import './globals.css';
if (window.nextstepDesktop) document.documentElement.dataset.desktop = window.nextstepDesktop.platform;
createRoot(document.getElementById('root')!).render(
  <AppSettings>
    <WorkspaceApp />
  </AppSettings>,
);
