import { execFile } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const run = (command,args) => execute(command,args,{encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000,env:{...process.env,LC_ALL:'C',LANG:'C'}});

export function packagingTarget(args,host = process) {
  const flags = args.filter(arg => arg.startsWith('--'));
  const positional = args.filter(arg => !arg.startsWith('--'));
  if (flags.some(flag => flag !== '--release') || flags.length > 1 || positional.length > 2) throw new Error('Use [darwin|win32|linux] [arm64|x64] [--release].');
  const [platform = host.platform,arch = host.arch] = positional;
  if (!['darwin','win32','linux'].includes(platform) || !['arm64','x64'].includes(arch)) throw new Error('Choose darwin, win32 or linux and arm64 or x64.');
  const release = flags.includes('--release');
  if (release && (platform !== 'darwin' || host.platform !== 'darwin')) throw new Error('Signed macOS releases must be built on a Mac with a darwin target.');
  return {platform,arch,release};
}

export function developerIdentity(output,requested) {
  if (!requested?.trim()) throw new Error('Set NEXTSTEP_SIGN_IDENTITY to the exact Developer ID Application certificate name or SHA-1 fingerprint.');
  const identities = [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: .+ \(([A-Z0-9]{10})\))"\s*$/gm)].map(([,hash,name,teamId]) => ({hash,name,teamId}));
  const selected = identities.filter(item => item.hash.toLowerCase() === requested.trim().toLowerCase() || item.name === requested.trim());
  if (selected.length !== 1) throw new Error('The selected valid Developer ID Application identity and private key are unavailable or ambiguous. Check security find-identity -v -p codesigning. Development and ad-hoc signatures are not accepted for releases.');
  return selected[0];
}

export async function signingOptions({root,env = process.env,execute = run}) {
  if (!env.NEXTSTEP_SIGN_IDENTITY?.trim()) developerIdentity('',env.NEXTSTEP_SIGN_IDENTITY);
  if (!env.NEXTSTEP_NOTARY_PROFILE?.trim()) throw new Error('Set NEXTSTEP_NOTARY_PROFILE to a validated notarytool Keychain profile. See docs/macos-signing.md.');
  const keychain = env.NEXTSTEP_SIGN_KEYCHAIN?.trim();
  const notaryKeychain = env.NEXTSTEP_NOTARY_KEYCHAIN?.trim();
  const result = await execute('security',['find-identity','-v','-p','codesigning',...(keychain ? [keychain] : [])]);
  const identity = developerIdentity(result.stdout,env.NEXTSTEP_SIGN_IDENTITY);
  // Validate authentication before replacing build outputs or uploading an app.
  await execute('xcrun',['notarytool','history','--keychain-profile',env.NEXTSTEP_NOTARY_PROFILE.trim(),...(notaryKeychain ? ['--keychain',notaryKeychain] : []),'--output-format','json']);
  return {
    identity,
    options:{
      osxSign:{identity:identity.hash,identityValidation:true,continueOnError:false,strictVerify:true,preAutoEntitlements:false,preEmbedProvisioningProfile:false,...(keychain ? {keychain} : {}),optionsForFile:() => ({entitlements:resolve(root,'desktop/entitlements.mac.plist'),hardenedRuntime:true})},
      osxNotarize:{keychainProfile:env.NEXTSTEP_NOTARY_PROFILE.trim(),...(notaryKeychain ? {keychain:notaryKeychain} : {})}
    }
  };
}

export function validateSignature(details,identity) {
  if (!details.split(/\r?\n/).includes(`Authority=${identity.name}`) || !details.split(/\r?\n/).includes(`TeamIdentifier=${identity.teamId}`)) throw new Error('The signed app does not match the selected Developer ID identity.');
  if (!/\bflags=0x[a-f0-9]+\([^\n]*\bruntime\b/i.test(details)) throw new Error('Hardened Runtime is missing from the app signature.');
  if (!/^Timestamp=.+$/m.test(details)) throw new Error('The app signature has no secure timestamp.');
}

export async function verifyMacRelease(app,identity,execute = run) {
  await execute('codesign',['--verify','--deep','--strict','--verbose=2',app]);
  const details = await execute('codesign',['--display','--verbose=4',app]);
  validateSignature(details.stdout + details.stderr,identity);
  await execute('xcrun',['stapler','validate',app]);
  const assessment = await execute('spctl',['--assess','--type','execute','--verbose=2',app]);
  if (!/source=Notarized Developer ID/.test(assessment.stdout + assessment.stderr)) throw new Error('Gatekeeper did not classify this app as notarized Developer ID software.');
}

export async function archiveMacRelease({app,archive,identity,execute = run}) {
  await verifyMacRelease(app,identity,execute);
  const pending = `${archive}.partial`;
  try {
    await execute('ditto',['-c','-k','--sequesterRsrc','--keepParent',app,pending]);
    await rename(pending,archive);
  } finally { await rm(pending,{force:true}); }
}
