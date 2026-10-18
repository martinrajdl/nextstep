import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdater, releaseMetadata, updateFeed } from '../desktop/updates.mjs';
const release = version => ({url:`https://github.com/martinrajdl/nextstep/releases/download/v${version}/Nextstep-${version}-macOS-arm64.zip`});
function fixture(options = {}) {
  const native = new EventEmitter();
  const calls = [];
  native.setFeedURL = value => calls.push(['feed',value]);
  native.checkForUpdates = () => calls.push(['download']);
  native.quitAndInstall = () => calls.push(['install']);
  let settings = {database:'/private/example.sqlite',usageAnalytics:{enabled:false}};
  const requests = [];
  const updater = createUpdater({native,version:'0.4.2',platform:'darwin',arch:'arm64',packaged:true,executable:'/Applications/Nextstep.app/Contents/MacOS/Nextstep',read:() => settings,write:value => {settings={...settings,...value};},send:async (url,init) => {requests.push({url,init});return new Response(JSON.stringify(release('0.4.3')));},...options});
  return {native,calls,requests,updater,get settings(){return settings;}};
}
test('availability checks do not download; download verifies through Electron, then restart is explicit',async () => {
  const f=fixture();
  assert.throws(() => f.updater.install(),/Download/);
  assert.equal((await f.updater.check()).status,'available');
  assert.equal(f.updater.getState().version,'0.4.3');
  assert.deepEqual(f.calls,[]);
  assert.equal(f.requests[0].url,updateFeed('0.4.2','arm64'));
  assert.equal(f.requests[0].init.credentials,'omit');
  assert.equal(f.requests[0].init.body,undefined);
  assert.equal(f.updater.download().status,'downloading');
  f.updater.download(); await f.updater.check();
  assert.equal(f.calls.filter(([kind]) => kind === 'download').length,1);
  assert.equal(f.requests.length,1);
  assert.throws(() => f.updater.install(),/Download/);
  f.native.emit('update-downloaded',null,'Notes','Nextstep 0.4.3',new Date(),release('0.4.3').url);
  assert.equal(f.updater.getState().status,'ready');
  assert.equal(f.calls.some(([kind]) => kind === 'install'),false);
  f.updater.install();
  assert.deepEqual(f.calls.at(-1),['install']);
  assert.equal(f.settings.database,'/private/example.sqlite');
  assert.deepEqual(f.settings.usageAnalytics,{enabled:false});
  f.updater.stop();
  assert.equal(f.native.listenerCount('error'),0);
});
test('unsupported platforms and development never check; automatic checks can be disabled independently of usage',async () => {
  for (const options of [{platform:'linux'},{platform:'win32'},{packaged:false},{arch:'ia32'}]) {
    const f=fixture(options); await f.updater.check(); f.updater.download();
    assert.equal(f.updater.getState().status,'unsupported');assert.deepEqual(f.requests,[]);assert.deepEqual(f.calls,[]);
  }
  const f=fixture();f.updater.setAutomatic(false);await f.updater.automaticCheck();assert.equal(f.requests.length,0);
  await f.updater.check();assert.equal(f.requests.length,1);
  assert.equal(f.settings.automaticUpdates,false);assert.deepEqual(f.settings.usageAnalytics,{enabled:false});
  assert.throws(() => f.updater.setAutomatic('yes'));
});
test('offline checks recover, concurrent checks are deduplicated, and native failures allow a retry',async () => {
  let finish, count=0;
  const f=fixture({send:async () => {count++;return new Promise(resolve => {finish=resolve;});}});
  const first=f.updater.check();await f.updater.check();assert.equal(count,1);
  finish(new Response(null,{status:503}));await first;assert.equal(f.updater.getState().status,'error');
  const second=f.updater.check();finish(new Response(JSON.stringify(release('0.4.3'))));await second;
  f.updater.download();f.native.emit('error',new Error('Offline'));
  assert.equal(f.updater.getState().status,'error');f.updater.download();assert.equal(f.updater.getState().status,'downloading');
  f.native.emit('update-not-available');assert.equal(f.updater.getState().status,'current');
  const current=fixture({send:async () => new Response(null,{status:204})});
  assert.equal((await current.updater.check()).status,'current');
});
test('wrong repository, architecture, unsigned asset type and downgrade metadata are refused',async () => {
  assert.equal(releaseMetadata(release('0.4.2'),'0.4.2','arm64'),null);
  assert.equal(releaseMetadata(release('0.3.9'),'0.4.2','arm64'),null);
  for (const url of [release('0.4.3').url.replace('github.com','example.com'),release('0.4.3').url.replace('/nextstep/','/other/'),release('0.4.3').url.replace('arm64','x64'),release('0.4.3').url.replace('.zip','.dmg'),release('0.4.3').url+'?url=untrusted']) {
    const f=fixture({send:async () => new Response(JSON.stringify({url}))});
    assert.equal((await f.updater.check()).status,'error');f.updater.download();assert.deepEqual(f.calls,[]);
  }
  const f=fixture({executable:'/Volumes/Nextstep/Nextstep.app/Contents/MacOS/Nextstep'});await f.updater.check();
  assert.equal(f.updater.download().status,'error');assert.deepEqual(f.calls,[]);
});
