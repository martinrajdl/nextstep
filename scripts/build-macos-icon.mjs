import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Regenerate the macOS icon on a Mac with sips and iconutil. Packaged builds use the committed .icns file.');
const root = fileURLToPath(new URL('../',import.meta.url));
const source = resolve(root,'desktop/icons/nextstep.png');
const output = resolve(root,'desktop/icons/nextstep.icns');
const run = (command,args) => execFileSync(command,args,{encoding:'utf8',timeout:30000});
const metadata = run('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight','-g','hasAlpha',source]);
if (!/pixelWidth: 1024\b/.test(metadata) || !/pixelHeight: 1024\b/.test(metadata) || !/hasAlpha: yes\b/.test(metadata)) {
  throw new Error('The icon master must be a 1024 × 1024 PNG with an alpha channel.');
}

const directory = mkdtempSync(resolve(tmpdir(),'nextstep-icon-'));
try {
  const iconset = resolve(directory,'nextstep.iconset');
  mkdirSync(iconset);
  for (const size of [16,32,128,256,512]) {
    for (const scale of [1,2]) {
      const pixels = size*scale;
      const file = resolve(iconset,`icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
      if (pixels === 1024) copyFileSync(source,file);
      else run('/usr/bin/sips',['-z',String(pixels),String(pixels),source,'--out',file]);
    }
  }
  const result = resolve(directory,'nextstep.icns');
  run('/usr/bin/iconutil',['--convert','icns','--output',result,iconset]);
  copyFileSync(result,output);
  console.log(`macOS icon ready: ${output} (16–1024 px, standard and Retina sizes)`);
} finally {
  rmSync(directory,{recursive:true,force:true});
}
