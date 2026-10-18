import { createRoot } from 'react-dom/client';
import WorkspaceApp from './workspace';
import AppSettings from '@/components/app-settings';
import { AppTooltipProvider } from '@/components/app-button';
import './globals.css';
import './focus.css';
if (window.nextstepDesktop) document.documentElement.dataset.desktop = window.nextstepDesktop.platform;
createRoot(document.getElementById('root')!).render(
  <AppTooltipProvider>
    <AppSettings>
      <WorkspaceApp />
    </AppSettings>
  </AppTooltipProvider>,
);
