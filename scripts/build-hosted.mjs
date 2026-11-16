import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../',import.meta.url));
const output = join(root,'.vercel/output');
async function files(directory,prefix='') {
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const name=prefix+entry.name;
    if(entry.isSymbolicLink()) throw new Error('Hosted assets must not be symbolic links.');
    if(entry.isDirectory()) result.push(...await files(join(directory,entry.name),`${name}/`));
    else result.push(name);
  }
  return result;
}
const assets=await files(join(root,'dist'));
if(!assets.includes('index.html') || assets.some(name=>!/^index\.html$|^favicon\.svg$|^assets\/[A-Za-z0-9_.-]+\.(js|css|png|svg|woff2?)$/.test(name)))
  throw new Error('Build the interface and review unexpected public assets before deployment.');
await rm(output,{recursive:true,force:true});
const functionRoot=join(output,'functions/api/index.func');
await mkdir(functionRoot,{recursive:true});
await cp(join(root,'dist'),join(output,'static'),{recursive:true});
await build({entryPoints:[join(root,'api/[...path].mjs')],outfile:join(functionRoot,'index.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',external:['node:*','pg-native'],banner:{js:"import { createRequire as nextstepCreateRequire } from 'node:module'; const require = nextstepCreateRequire(import.meta.url);"}});
await writeFile(join(functionRoot,'.vc-config.json'),JSON.stringify({runtime:'nodejs24.x',handler:'index.mjs',launcherType:'Nodejs',maxDuration:30,regions:['fra1']},null,2)+'\n');
const configuration=JSON.parse(await readFile(join(root,'vercel.json'),'utf8'));
const headers=Object.fromEntries(configuration.headers[0].headers.map(({key,value})=>[key,value]));
await writeFile(join(output,'config.json'),JSON.stringify({version:3,routes:[
  {src:'/.*',headers,continue:true},
  {src:'/api/(.*)',dest:'/api/index?__nextstep_path=$1'},
  {handle:'filesystem'},
]},null,2)+'\n');
for(const name of await files(output)) {
  if(!/^(static\/(index\.html|favicon\.svg|assets\/[A-Za-z0-9_.-]+\.(js|css|png|svg|woff2?))|functions\/api\/index\.func\/(index\.mjs|\.vc-config\.json)|config\.json)$/.test(name))
    throw new Error('An unexpected file entered the deployment.');
  if(/\.(json|js|mjs|html)$/.test(name)) {
    const text=await readFile(join(output,name),'utf8');
    if(/sb_secret_[A-Za-z0-9_-]{15,}|postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@|BEGIN (?:EC |RSA |)PRIVATE KEY|\/Users\/|\/private\/tmp\/nextstep-/.test(text))
      throw new Error('A private value or local path entered the deployment.');
  }
}
console.log(JSON.stringify({status:'prepared',staticAssets:assets.length,functions:1,output:'.vercel/output',privateWorkspaceFiles:0}));
