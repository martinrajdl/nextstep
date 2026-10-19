import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { forwardDesktopActivation } from '../desktop/reopen.mjs';

test('a background connector forwards repeated reopen requests without sharing its MCP stream or database override', () => {
  const app = Object.assign(new EventEmitter(), { isPackaged: true });
  const calls = [];
  let time = 0;
  const env = { NEXTSTEP_DB_PATH: '/connector.sqlite', DB_PATH: '/legacy.sqlite', ELECTRON_RUN_AS_NODE: '1', NEXTSTEP_USER_DATA: '/profile' };
  const remove = forwardDesktopActivation(app, { executable: '/Nextstep', env, now: () => time, launch: (...args) => {
    calls.push(args);
    return Object.assign(new EventEmitter(), { unref() {} });
  } });
  assert.equal(calls.length, 0);
  app.emit('activate'); app.emit('activate');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['/Nextstep', [], { detached: true, stdio: 'ignore', env: { NEXTSTEP_USER_DATA: '/profile' } }]);
  assert.equal(env.DB_PATH, '/legacy.sqlite');
  time = 1001; app.emit('activate');
  assert.equal(calls.length, 2);
  remove(); time = 2002; app.emit('activate');
  assert.equal(calls.length, 2);
});

test('source launches include the app path and failed launches remain retryable', () => {
  const app = Object.assign(new EventEmitter(), { isPackaged: false, getAppPath: () => '/source' });
  const calls = [], errors = [], children = [];
  forwardDesktopActivation(app, { executable: '/electron', env: {}, report: e => errors.push(e), launch: (...args) => {
    calls.push(args); const child = Object.assign(new EventEmitter(), { unref() {} }); children.push(child); return child;
  } });
  app.emit('activate'); children[0].emit('error', new Error('not found')); app.emit('activate');
  assert.deepEqual(calls[0][1], ['/source']);
  assert.equal(calls.length, 2);
  assert.match(errors[0], /not found/);
});
