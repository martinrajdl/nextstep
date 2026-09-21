import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveMacRelease, developerIdentity, packagingTarget, signingOptions, validateSignature, verifyMacRelease } from '../scripts/macos-release.mjs';

const hash = 'A'.repeat(40);
const name = 'Developer ID Application: Example Publisher (EXAMPLE123)';
const identity = {hash,name,teamId:'EXAMPLE123'};
const listed = `  1) ${'B'.repeat(40)} "Apple Development: Example (EXAMPLE123)"\n  2) ${hash} "${name}"\n  2 valid identities found`;
const details = `Authority=${name}\nTeamIdentifier=EXAMPLE123\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=Sep 21, 2026\n`;
const env = {NEXTSTEP_SIGN_IDENTITY:name,NEXTSTEP_NOTARY_PROFILE:'test-notary'};
const output = (stdout = '',stderr = '') => ({stdout,stderr});

test('release packaging is explicit and cannot silently use a different platform',() => {
  assert.deepEqual(packagingTarget([],{platform:'darwin',arch:'arm64'}),{platform:'darwin',arch:'arm64',release:false});
  assert.deepEqual(packagingTarget(['darwin','--release','x64'],{platform:'darwin',arch:'arm64'}),{platform:'darwin',arch:'x64',release:true});
  assert.throws(() => packagingTarget(['darwin','--release'],{platform:'linux',arch:'x64'}));
  assert.throws(() => packagingTarget(['win32','--release'],{platform:'darwin',arch:'arm64'}));
  assert.throws(() => packagingTarget(['--relese']));
});

test('only one exact valid Developer ID Application identity can be selected',() => {
  assert.deepEqual(developerIdentity(listed,name),identity);
  assert.deepEqual(developerIdentity(listed,hash.toLowerCase()),identity);
  assert.throws(() => developerIdentity(listed,'Apple Development: Example (EXAMPLE123)'));
  assert.throws(() => developerIdentity(listed,'-'));
  assert.throws(() => developerIdentity(listed,undefined));
  assert.throws(() => developerIdentity(`${listed}\n  3) ${'C'.repeat(40)} "${name}"`,name));
});

test('release preflight validates local credentials and never falls back to unsigned output',async () => {
  const calls = [];
  const result = await signingOptions({root:'/example',env,execute:async (command,args) => { calls.push([command,args]); return command === 'security' ? output(listed) : output('{}'); }});
  assert.deepEqual(result.identity,identity);
  assert.equal(result.options.osxSign.continueOnError,false);
  assert.equal(result.options.osxSign.identityValidation,true);
  assert.equal(result.options.osxSign.preEmbedProvisioningProfile,false);
  assert.equal(result.options.osxSign.optionsForFile().hardenedRuntime,true);
  assert.match(result.options.osxSign.optionsForFile().entitlements,/entitlements\.mac\.plist$/);
  assert.equal(result.options.osxNotarize.keychainProfile,'test-notary');
  assert.deepEqual(calls[1],['xcrun',['notarytool','history','--keychain-profile','test-notary','--output-format','json']]);
  const unexpected = async () => { throw new Error('External command should not run'); };
  await assert.rejects(signingOptions({root:'/example',env:{},execute:unexpected}),/NEXTSTEP_SIGN_IDENTITY/);
  await assert.rejects(signingOptions({root:'/example',env:{NEXTSTEP_SIGN_IDENTITY:name},execute:unexpected}),/NEXTSTEP_NOTARY_PROFILE/);
  await assert.rejects(signingOptions({root:'/example',env,execute:async command => { if (command === 'security') return output(listed); throw new Error('Notarization authentication failed'); }}),/authentication failed/);
});

test('release verification rejects an unexpected publisher, missing runtime or missing timestamp',() => {
  validateSignature(details,identity);
  assert.throws(() => validateSignature(details.replace('Authority=','Other='),identity));
  assert.throws(() => validateSignature(details.replace('TeamIdentifier=EXAMPLE123','TeamIdentifier=OTHER12345'),identity));
  assert.throws(() => validateSignature(details.replace('(runtime)','(none)'),identity));
  assert.throws(() => validateSignature(details.replace('Timestamp=','Time='),identity));
});

test('a release needs valid nested signatures, a stapled ticket, and Gatekeeper notarization',async () => {
  const commands = [];
  const execute = async (command,args) => {
    commands.push([command,...args]);
    if (args.includes('--display')) return output('',details);
    if (command === 'spctl') return output('','source=Notarized Developer ID');
    return output();
  };
  await verifyMacRelease('/example/Nextstep.app',identity,execute);
  assert.equal(commands.length,4);
  assert.ok(commands[0].includes('--deep'));
  assert.deepEqual(commands[2],['xcrun','stapler','validate','/example/Nextstep.app']);
  await assert.rejects(verifyMacRelease('/example/Nextstep.app',identity,async (command,args) => command === 'spctl' ? output('assessments disabled') : execute(command,args)),/Gatekeeper/);
  await assert.rejects(verifyMacRelease('/example/Nextstep.app',identity,async (command,args) => { if (command === 'xcrun') throw new Error('No stapled ticket'); return execute(command,args); }),/No stapled ticket/);
});

test('a release ZIP is published only after successful verification and archive creation',async () => {
  const directory = mkdtempSync(join(tmpdir(),'nextstep-release-'));
  const archive = join(directory,'Nextstep.zip');
  const execute = async (command,args) => {
    if (args.includes('--display')) return output('',details);
    if (command === 'spctl') return output('','source=Notarized Developer ID');
    if (command === 'ditto') writeFileSync(args.at(-1),'test archive');
    return output();
  };
  try {
    await assert.rejects(archiveMacRelease({app:'/example/Nextstep.app',archive,identity,execute:async () => { throw new Error('Invalid signature'); }}),/Invalid signature/);
    assert.equal(existsSync(archive),false);
    await assert.rejects(archiveMacRelease({app:'/example/Nextstep.app',archive,identity,execute:async (command,args) => { if (command === 'ditto') { writeFileSync(args.at(-1),'incomplete'); throw new Error('Archive interrupted'); } return execute(command,args); }}),/Archive interrupted/);
    assert.equal(existsSync(archive),false); assert.equal(existsSync(`${archive}.partial`),false);
    await archiveMacRelease({app:'/example/Nextstep.app',archive,identity,execute});
    assert.equal(existsSync(archive),true); assert.equal(existsSync(`${archive}.partial`),false);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
