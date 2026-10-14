import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageReporter, usageEndpoint } from '../desktop/usage.mjs';

function fixture(send) {
  let preferences = {database:'/private/example.sqlite',accent:'#777777'};
  let timestamp = Date.UTC(2026,9,13,12);
  const requests = [];
  const options = {read:() => preferences,write:patch => {preferences={...preferences,...patch};},version:'0.4.1',platform:'darwin',now:() => timestamp,send:send || (async (url,options) => {requests.push({url,options});return {status:204};})};
  return {options,requests,get preferences(){return preferences;},advance:ms => {timestamp+=ms;}};
}
test('usage is opt-in, deduplicates across restarts and sends only the documented daily fields',async () => {
  const f=fixture(); let reporter=createUsageReporter(f.options);
  assert.equal(await reporter.checkIn(),false);
  assert.equal(f.preferences.usageAnalytics,undefined);
  assert.deepEqual(f.requests,[]);
  reporter.setEnabled(true);
  const seed=f.preferences.usageAnalytics.seed;
  assert.equal(await reporter.checkIn(),true);
  const first=JSON.parse(f.requests[0].options.body);
  assert.equal(f.requests[0].url,usageEndpoint);
  assert.deepEqual(Object.keys(first).sort(),['dailyId','day','platform','schema','version']);
  assert.equal(first.day,'2026-10-13');
  assert.match(first.dailyId,/^[0-9a-f]{64}$/);
  assert.notEqual(first.dailyId,seed);
  assert.equal(f.requests[0].options.body.includes('/private/'),false);
  assert.equal(f.requests[0].options.credentials,'omit');
  assert.equal(f.requests[0].options.redirect,'error');
  reporter=createUsageReporter(f.options);
  assert.equal(await reporter.checkIn(),false);
  f.advance(86400000);
  assert.equal(await reporter.checkIn(),true);
  assert.notEqual(JSON.parse(f.requests[1].options.body).dailyId,first.dailyId);
  reporter.setEnabled(false);
  assert.deepEqual(f.preferences.usageAnalytics,{enabled:false});
  f.advance(86400000);
  assert.equal(await reporter.checkIn(),false);
  assert.equal(f.requests.length,2);
  assert.equal(f.preferences.database,'/private/example.sqlite');
  assert.throws(() => reporter.setEnabled('yes'));
});
test('offline usage retries are bounded and never block the app',async () => {
  let attempts=0;
  const f=fixture(async()=>{attempts++;throw new Error('Offline');});
  const reporter=createUsageReporter(f.options);
  reporter.setEnabled(true);
  assert.equal(await reporter.checkIn(),false);
  assert.equal(await reporter.checkIn(),false);
  assert.equal(attempts,1);
  f.advance(3600000);
  assert.equal(await reporter.checkIn(),false);
  assert.equal(attempts,2);
  assert.equal(f.preferences.usageAnalytics.lastSentDay,null);
});
test('disabling usage aborts an in-flight request without restoring consent or its identifier',async () => {
  let finish, signal;
  const f=fixture(async(_url,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});});
  const reporter=createUsageReporter(f.options);
  reporter.setEnabled(true);
  const pending=reporter.checkIn();
  assert.equal(await reporter.checkIn(),false);
  reporter.setEnabled(false);
  assert.equal(signal.aborted,true);
  finish({status:204});
  assert.equal(await pending,false);
  assert.deepEqual(f.preferences.usageAnalytics,{enabled:false});
});
test('development, helper and inactive-window contexts do not report',async()=>{
  const f=fixture();
  const reporter=createUsageReporter({...f.options,eligible:()=>false});
  reporter.setEnabled(true);
  assert.equal(await reporter.checkIn(),false);
  assert.deepEqual(f.requests,[]);
});
