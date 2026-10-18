// Metadata checks are separate from Electron's signed download/install flow.
// No CRM data or installation identifier is sent to the update service.
export const releasePage = 'https://github.com/martinrajdl/nextstep/releases/latest';
export function updateFeed(version, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !['arm64', 'x64'].includes(arch)) throw new Error('Unsupported update target.');
  return `https://update.electronjs.org/martinrajdl/nextstep/darwin-${arch}/${version}`;
}
export function releaseMetadata(value, version, arch) {
  const url = new URL(value?.url);
  const match = url.pathname.match(/^\/martinrajdl\/nextstep\/releases\/download\/v(\d+\.\d+\.\d+)\/Nextstep-\1-macOS-(arm64|x64)\.zip$/);
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash || !match || match[2] !== arch) throw new Error('The update service returned an unexpected download.');
  const next = match[1].split('.').map(Number), current = version.split('.').map(Number);
  const difference = next.findIndex((n, i) => n !== current[i]);
  if (difference < 0 || next[difference] < current[difference]) return null;
  return {version: match[1], url: url.href};
}
export function createUpdater({ native, version, platform, arch, packaged, executable, read, write, send = fetch, publish = () => {} }) {
  const supported = packaged && platform === 'darwin' && ['arm64', 'x64'].includes(arch);
  let state = {status: supported ? 'idle' : 'unsupported', currentVersion: version, version: null, error: '', automatic: read().automaticUpdates !== false};
  let stopped = false;
  let request;
  let selected;
  const listeners = [];
  const emit = patch => { state = {...state, ...patch}; if (!stopped) publish({...state}); return {...state}; };
  const listen = (event, handler) => { native.on(event, handler); listeners.push([event,handler]); };
  if (supported) {
    listen('update-available', () => emit({status:'downloading'}));
    listen('update-not-available', () => emit({status:'current', version:null}));
    listen('error', () => emit({status:'error', error:'The update could not be downloaded or verified. Check your connection and try again.'}));
    listen('update-downloaded', (_event, _notes, _name, _date, url) => {
      try {
        const release = releaseMetadata({url}, version, arch);
        if (!release) throw new Error('Not a newer release');
        emit({status:'ready', version:release.version, error:''});
      } catch { emit({status:'error', error:'The downloaded update did not match a newer Nextstep release. Please retry.'}); }
    });
  }
  async function check() {
    if (!supported || stopped || ['checking','downloading','ready'].includes(state.status)) return {...state};
    emit({status:'checking', error:''});
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 15000);
    try {
      const response = await send(updateFeed(version, arch), {signal:request.signal, credentials:'omit', redirect:'error', headers:{Accept:'application/json'}});
      if (stopped) return {...state};
      if (response.status === 204) { selected = null; return emit({status:'current', version:null}); }
      if (!response.ok) throw new Error('Update service unavailable');
      selected = releaseMetadata(await response.json(), version, arch);
      return emit({status: selected ? 'available' : 'current', version:selected?.version || null});
    } catch {
      return emit({status:'error', error:'Could not check for updates. You can keep working and try again later.'});
    } finally { clearTimeout(timeout); request = null; }
  }
  function download() {
    if (!supported || stopped || !selected || !['available','error'].includes(state.status)) return {...state};
    if (executable.includes('/AppTranslocation/') || executable.startsWith('/Volumes/')) return emit({status:'error', error:'Move Nextstep to Applications and reopen it before updating.'});
    emit({status:'downloading', error:''});
    try {
      // Squirrel.Mac verifies the downloaded bundle against this app's signing
      // identity. Never bypass it or replace bundles from renderer-supplied URLs.
      native.setFeedURL({url:updateFeed(version, arch)});
      native.checkForUpdates();
    } catch { emit({status:'error', error:'Could not start the update. Move Nextstep to Applications and try again.'}); }
    return {...state};
  }
  return {
    getState: () => ({...state}), check, download,
    install: () => { if (state.status !== 'ready') throw new Error('Download and verify the update first.'); native.quitAndInstall(); },
    setAutomatic: value => {
      if (typeof value !== 'boolean') throw new Error('Choose whether to check for updates automatically.');
      write({automaticUpdates:value});
      return emit({automatic:value});
    },
    automaticCheck: () => state.automatic ? check() : Promise.resolve({...state}),
    stop: () => { stopped = true; request?.abort(); for (const [event,handler] of listeners) native.removeListener(event,handler); },
  };
}
