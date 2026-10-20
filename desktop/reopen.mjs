import { spawn } from 'node:child_process';

// LaunchServices can deliver an app-open request to a windowless MCP process
// because it uses the same executable/bundle ID as the desktop application.
export function forwardDesktopActivation(app, { launch = spawn, executable = process.execPath, env = process.env, now = Date.now, report = console.error } = {}) {
  let lastLaunch = -Infinity;
  const activate = () => {
    // macOS can promote a hidden connector back into the Dock when its bundle
    // is opened. Reset its policy even inside the debounce: dock.hide() can
    // ignore calls made less than a second apart.
    app.setActivationPolicy('accessory');
    if (now() - lastLaunch < 1000) return;
    lastLaunch = now();
    const desktopEnv = { ...env };
    // The GUI should use its saved selection, not the connector's database.
    delete desktopEnv.NEXTSTEP_DB_PATH;
    delete desktopEnv.DB_PATH;
    delete desktopEnv.ELECTRON_RUN_AS_NODE;
    try {
      const child = launch(executable, app.isPackaged ? [] : [app.getAppPath()], {
        detached: true, stdio: 'ignore', env: desktopEnv,
      });
      child.once('error', error => { lastLaunch = -Infinity; report(`Could not reopen Nextstep: ${error.message}`); });
      child.unref();
    } catch (error) {
      lastLaunch = -Infinity;
      report(`Could not reopen Nextstep: ${error.message}`);
    }
  };
  app.on('activate', activate);
  return () => app.removeListener('activate', activate);
}
