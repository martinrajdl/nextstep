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
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByText(user.email,{exact:true})).toBeVisible();
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
