import { test, expect } from '@playwright/test';

const workspace = { id:'00000000-0000-4000-8000-000000000001',name:'Fictional team',role:'owner' };
const user = { id:'00000000-0000-4000-8000-000000000002',email:'owner@example.com' };

test('hosted sign-in shows no CRM data or setup before admission at desktop and mobile sizes',async({page},testInfo)=>{
  let crmRequests=0;
  page.on('request',request=>{ if(new URL(request.url()).pathname.startsWith('/api/crm/')) crmRequests++; });
  await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'hosted',authenticated:false}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Sign in to Nextstep.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Continue with Apple'})).toHaveAttribute('href','/api/auth/login');
  await expect(page.getByText('Share My Email',{exact:false})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('hosted-signin-desktop.png')});
  await page.setViewportSize({width:375,height:812});
  await expect(page.getByRole('link',{name:'Continue with Apple'})).toBeInViewport();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',375);
  await page.screenshot({path:testInfo.outputPath('hosted-signin-mobile.png')});
  expect(crmRequests).toBe(0);
});

test('a signed-in uninvited person cannot mount or request the workspace',async({page})=>{
  let crmRequests=0;
  page.on('request',request=>{ if(new URL(request.url()).pathname.startsWith('/api/crm/')) crmRequests++; });
  await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'hosted',authenticated:true,user,workspaces:[]}}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'An invitation is needed.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Use another account'})).toBeVisible();
  expect(crmRequests).toBe(0);
});

test('admitted users keep the existing workspace and can sign out from settings',async({page})=>{
  let signedOut=false;
  await page.route('**/api/auth/session',route=>route.fulfill({json:signedOut?{mode:'hosted',authenticated:false}:{mode:'hosted',authenticated:true,user,workspaces:[workspace]}}));
  await page.route('**/api/auth/logout',route=>{signedOut=true;return route.fulfill({json:{signedOut:true}});});
  await page.route('**/api/crm/context',async route=>{
    const response=await route.fetch();const context=await response.json();
    await route.fulfill({json:{...context,hosted:{workspaceId:workspace.id,workspaceName:workspace.name,role:'owner',origin:'http://127.0.0.1:4321'}}});
  });
  await page.goto('/');
  await expect(page.getByText('Shared',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Notes',exact:true}).click();
  await expect(page.getByRole('heading',{name:/^Notes/})).toBeVisible();
  await expect(page.getByText(/iCloud Drive|Folder sync/)).toHaveCount(0);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByText(user.email,{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Notes folder sync'})).toHaveCount(0);
  await expect(page.getByText('Records, notes and their history are saved in your shared workspace.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sign in to Nextstep.'})).toBeVisible();
});

test('expired or revoked access unmounts previously displayed workspace data',async({page})=>{
  let revoked=false;
  await page.route('**/api/auth/session',route=>route.fulfill({json:revoked?{mode:'hosted',authenticated:true,user,workspaces:[]}:{mode:'hosted',authenticated:true,user,workspaces:[workspace]}}));
  await page.route('**/api/crm/context',async route=>{
    if(revoked) return route.fulfill({status:403,json:{error:'Access removed.',authRequired:true}});
    const response=await route.fetch();await route.fulfill({json:await response.json()});
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
  revoked=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading',{name:'An invitation is needed.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveCount(0);
});

test('hosted agent setup gives local agents a separate MCP connection without copying its credential',async({page},testInfo)=>{
  const credential=`nextstep_${'a'.repeat(43)}`, token={id:'00000000-0000-4000-8000-000000000003',label:'Fictional agent',expires_at:'2027-01-01T00:00:00Z',revoked_at:null};
  await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'hosted',authenticated:true,user,workspaces:[workspace]}}));
  await page.route('**/api/crm/context',async route=>{
    const response=await route.fetch();
    await route.fulfill({json:{...await response.json(),hosted:{workspaceId:workspace.id,workspaceName:workspace.name,role:'owner',origin:'http://127.0.0.1:4321'}}});
  });
  await page.route('**/api/account/agent-tokens',route=>route.fulfill({json:route.request().method() === 'POST' ? {...token,token:credential} : {tokens:[]}}));
  await page.route(`**/api/account/agent-tokens/${token.id}`,route=>route.fulfill({json:{revoked:true}}));
  await page.goto('/#/agents');
  await page.getByRole('button',{name:'Connection & instructions',exact:true}).click();
  await page.getByRole('button',{name:'Create agent connection',exact:true}).click();
  await expect(page.getByLabel('New agent credential')).toHaveText(credential);
  await expect(page.getByRole('button',{name:'Copy MCP connection',exact:true})).toBeDisabled();
  await page.getByLabel('Private credential file',{exact:true}).fill('/private/example/nextstep-shared');
  await page.getByRole('button',{name:'Connection configuration',exact:true}).click();
  const configuration=JSON.parse(await page.getByLabel('Hosted MCP configuration').innerText());
  expect(Object.keys(configuration.mcpServers)).toEqual(['nextstep-shared']);
  const connection=configuration.mcpServers['nextstep-shared'];
  expect(connection.command).toBe('/Applications/Nextstep.app/Contents/MacOS/Nextstep');
  expect(connection.args).toEqual(['--crm-mcp','--server','http://127.0.0.1:4321','--workspace',workspace.id,'--credential-file','/private/example/nextstep-shared']);
  expect(JSON.stringify(configuration)).not.toContain(credential);
  await expect(page.getByRole('button',{name:'Copy MCP connection',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Hide credential',exact:true}).click();
  await page.screenshot({path:testInfo.outputPath('hosted-agent-setup.png'),fullPage:true});
  await page.getByRole('button',{name:'Source checkout',exact:true}).click();
  await expect(page.getByRole('button',{name:'Copy MCP connection',exact:true})).toBeDisabled();
  await page.getByLabel('Connector script',{exact:true}).fill('/example/nextstep/mcp/crm-stdio.mjs');
  const source=JSON.parse(await page.getByLabel('Hosted MCP configuration').innerText()).mcpServers['nextstep-shared'];
  expect(source.command).toBe('node');
  expect(source.args[0]).toBe('/example/nextstep/mcp/crm-stdio.mjs');
  await page.getByRole('button',{name:'Revoke',exact:true}).click();
  await expect(page.getByText('Fictional agent',{exact:true})).toHaveCount(0);
});
