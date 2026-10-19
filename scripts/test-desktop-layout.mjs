import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { root } from '../server/config.mjs';
const directory=mkdtempSync(join(tmpdir(),'nextstep-layout-')), database=join(directory,'one.sqlite'), otherDatabase=join(directory,'two.sqlite'), userData=join(directory,'profile');
const store=openStore(database);store.create({company:'Fictional Layout Record'});const before=store.list();
const other=openStore(otherDatabase);other.create({company:'Fictional Other Record'});other.close();
const executablePath=process.argv[2];let app;
const launch=async path => {
  app=await electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[]:[root]),'--database',path],env:{...process.env,NEXTSTEP_USER_DATA:userData,NEXTSTEP_DB_PATH:'',DB_PATH:'',NEXTSTEP_DEV_ICON:'1',NEXTSTEP_DISABLE_UPDATES:'1',NEXTSTEP_DISABLE_USAGE:'1',NEXTSTEP_AGENT_CONFIG_HOME:join(directory,'agents')}});
  const page=await app.firstWindow();await page.getByRole('link',{name:'Job search',exact:true}).click();return page;
};
try {
  let page=await launch(database);
  await page.getByRole('button',{name:'Table view',exact:true}).click();
  await expect.poll(()=>page.evaluate(id=>window.nextstepDesktop.getCollectionLayout(id),store.compatibilityCollection())).toBe('table');
  const firstOrigin=new URL(page.url()).origin;
  await app.close();app=null;
  page=await launch(database);
  expect(new URL(page.url()).origin).not.toBe(firstOrigin);
  await expect(page.getByRole('button',{name:'Table view',exact:true})).toHaveAttribute('aria-pressed','true');
  await app.close();app=null;
  page=await launch(otherDatabase);
  await expect(page.getByRole('button',{name:'Board view',exact:true})).toHaveAttribute('aria-pressed','true');
  await app.close();app=null;
  page=await launch(database);
  await expect(page.getByRole('button',{name:'Table view',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Board view',exact:true}).click();
  await expect.poll(()=>page.evaluate(id=>window.nextstepDesktop.getCollectionLayout(id),store.compatibilityCollection())).toBe('board');
  await app.close();app=null;
  page=await launch(database);
  await expect(page.getByRole('button',{name:'Board view',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(store.list()).toEqual(before);
  console.log('Desktop layouts persist across changing ports/restarts, stay scoped per database, and preserve records.');
} finally {await app?.close();store.close();rmSync(directory,{recursive:true,force:true});}
