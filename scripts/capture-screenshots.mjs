// Public documentation uses a fresh, fictional database and an ephemeral port.
// This script never reads the configured user database or desktop settings.
import { chromium, _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/http.mjs';
import { root } from '../server/config.mjs';
const directory = mkdtempSync(join(tmpdir(), 'nextstep-docs-'));
const service = await startServer({database:join(directory,'fictional.sqlite'),port:0,dist:join(root,'dist')});
const store = service.store;
const change = operations => ({id:randomUUID(),title:'Fictional studio example',actor:'Example agent',operations});
const output=join(root,'docs/images'); mkdirSync(output,{recursive:true});
let browser;
let app;
try {
  app = await electron.launch({args:[root,'--database',join(directory,'fictional.sqlite')],env:{...process.env,NEXTSTEP_DB_PATH:'',DB_PATH:'',NEXTSTEP_USER_DATA:join(directory,'profile'),NEXTSTEP_AGENT_CONFIG_HOME:join(directory,'agents')}});
  const firstLaunch = await app.firstWindow();
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
  await expect(firstLaunch.getByRole('heading',{name:'Connect your agent.'})).toBeVisible();
  const available = await firstLaunch.evaluate(() => window.nextstepDesktop.getAgents());
  for (const agent of available.filter(value=>value.canConnect)) await expect(firstLaunch.getByRole('button',{name:new RegExp(`Connect ${agent.label}`)})).toBeEnabled();
  await firstLaunch.screenshot({path:join(output,'onboarding.png'),scale:'css'});
  await app.close(); app = null;
  store.updateOnboarding({version:0,step:0,status:'dismissed'});
  for (const [company,role,stage,nextStep,location] of [
    ['Cedar Studio','Product Engineer','prospect','Review the product team and role.','Remote · Europe'],
    ['Meadow Systems','Frontend Engineer','prospect','Explore the developer experience team.','Remote'],
    ['Northstar Labs','Design Engineer','interested','Share a small selection of recent work.','Hybrid · Example City'],
    ['Papertrail Works','Senior Engineer','applied','Follow up after the application review.','Remote'],
    ['Orbit Workshop','Product Engineer','screening','Prepare questions about the roadmap.','Remote · Europe'],
    ['Daylight Studio','Frontend Lead','interview','Discuss ownership with the product team.','Remote'],
  ]) store.create({company,role,stage,nextStep,location,url:'https://example.com/careers'});
  store.crm.apply(change([
    {type:'create_collection',id:'people',name:'People',description:'Good work starts with good people.',fields:[
      {key:'company',name:'Company',type:'text'},
      {key:'email',name:'Email',type:'email'},
      {key:'relationship',name:'Relationship',type:'select',options:['New','In touch','Collaborating']},
      {key:'next_step',name:'Next step',type:'text'},
    ]},
    {type:'create_collection',id:'projects',name:'Projects',fields:[{key:'status',name:'Status',type:'select',options:['Idea','In progress','Done']}]},
    {type:'create_collection',id:'research',name:'Research',fields:[{key:'source',name:'Source',type:'url'}]},
  ]));
  store.crm.apply(change([
    ...[
      ['Avery Morgan','Cedar Studio','avery','Collaborating','Review the first prototype'],
      ['Jordan Ellis','Meadow Systems','jordan','In touch','Share the project brief'],
      ['Riley Chen','Papertrail Works','riley','New','Introduce the studio'],
      ['Sam Rivera','Daylight Studio','sam','Collaborating','Plan the next workshop'],
      ['Alex Bennett','Northstar Labs','alex','In touch','Compare research notes'],
    ].map(([title,company,email,relationship,next_step]) => ({type:'create_record',collectionId:'people',collectionVersion:1,title,values:{company,email:email+'@example.com',relationship,next_step}})),
    {type:'create_record',collectionId:'projects',collectionVersion:1,title:'Studio collaboration',values:{status:'In progress'}},
    {type:'create_record',collectionId:'research',collectionVersion:1,title:'Useful field notes',values:{source:'https://example.com/research'}},
  ]));
  browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined});
  const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
  const errors=[]; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.url+'/#/collections/people');
  await expect(page.getByRole('heading',{name:'People',exact:true})).toBeVisible();
  await page.screenshot({path:join(output,'workspace.png')});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:join(output,'settings-dark.png')});
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.screenshot({path:join(output,'workspace-dark.png')});
  await page.getByRole('link',{name:'Job search',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Job search',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Hide uninterested',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open Cedar Studio',exact:true})).toBeVisible();
  await page.screenshot({path:join(output,'board-dark.png')});
  await page.getByRole('button',{name:'App settings',exact:true}).click();
  await page.getByRole('button',{name:'Light mode',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.screenshot({path:join(output,'board.png')});
  expect(errors).toEqual([]);
  console.log('Captured six documentation screenshots using an isolated database and fictional records.');
} finally {
  await app?.close();
  await browser?.close();
  await service.close();
  rmSync(directory,{recursive:true,force:true});
}
