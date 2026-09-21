import { build } from 'esbuild';
import { packager } from '@electron/packager';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from '../server/config.mjs';
import { archiveMacRelease, packagingTarget, signingOptions } from './macos-release.mjs';

const {platform,arch,release} = packagingTarget(process.argv.slice(2));
const signing = release ? await signingOptions({root}) : null;
const stage = resolve(root,'.desktop-staging');
const manifest = JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
rmSync(stage,{recursive:true,force:true}); mkdirSync(stage,{recursive:true});
await build({entryPoints:[resolve(root,'desktop/main.mjs')],outfile:resolve(stage,'main.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',external:['electron','node:*'],banner:{js:"import { createRequire as nextstepCreateRequire } from 'node:module'; const require = nextstepCreateRequire(import.meta.url);"}});
cpSync(resolve(root,'dist'),resolve(stage,'dist'),{recursive:true});
for (const file of ['LICENSE','THIRD_PARTY_NOTICES.md']) cpSync(resolve(root,file),resolve(stage,file));
// Include installed dependency notices even when bundling removes node_modules.
// Keeping extra build-tool notices is harmless and avoids omitting a transitive license.
const licenses = new Map();
function collectLicenses(directory) {
  for (const entry of readdirSync(directory,{withFileTypes:true})) {
    if (!entry.isDirectory()) continue;
    const folder = resolve(directory,entry.name);
    if (entry.name.startsWith('@')) { collectLicenses(folder); continue; }
    const packageFile = resolve(folder,'package.json');
    if (!existsSync(packageFile)) continue;
    const pkg = JSON.parse(readFileSync(packageFile,'utf8'));
    const name = `${pkg.name}@${pkg.version}`;
    if (licenses.has(name)) continue;
    const notices = readdirSync(folder,{withFileTypes:true}).filter(file => file.isFile() && /^(licen[cs]e|notice|copying|copyright)([.-]|$)/i.test(file.name));
    licenses.set(name,`${name}\nDeclared license: ${JSON.stringify(pkg.license ?? 'See package notices')}\n${notices.map(file => `\n${file.name}\n${readFileSync(resolve(folder,file.name),'utf8')}`).join('\n')}`);
  }
}
const installed = resolve(root,'node_modules/.pnpm');
for (const entry of readdirSync(installed,{withFileTypes:true})) {
  const directory = resolve(installed,entry.name,'node_modules');
  if (entry.isDirectory() && existsSync(directory)) collectLicenses(directory);
}
writeFileSync(resolve(stage,'DEPENDENCY_LICENSES.txt'),[...licenses.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,notice]) => notice).join('\n\n--------------------\n\n'));
writeFileSync(resolve(stage,'package.json'),JSON.stringify({name:'nextstep',productName:'Nextstep',version:manifest.version,description:manifest.description,main:'main.mjs',type:'module',license:'MIT'},null,2));
if (release) console.log(`Signing with ${signing.identity.name}. Apple notarization may take several minutes.`);
const output = await packager({dir:stage,name:'Nextstep',out:resolve(root,release ? 'desktop-releases/signed' : 'desktop-releases'),platform,arch,electronVersion:manifest.devDependencies.electron,overwrite:true,asar:true,prune:false,appBundleId:'app.nextstep.crm',appCategoryType:'public.app-category.productivity',...(signing?.options ?? {})});
if (release) {
  const app = resolve(output[0],'Nextstep.app');
  const archive = resolve(root,'desktop-releases',`Nextstep-${manifest.version}-macOS-${arch}.zip`);
  await archiveMacRelease({app,archive,identity:signing.identity});
  console.log(`Signed, notarized, stapled and Gatekeeper-verified macOS release: ${archive}`);
} else console.log(`Desktop app ready: ${output.join(', ')}\nThis build is unsigned. Use pnpm desktop:release for a signed macOS release. See docs/desktop.md.`);
