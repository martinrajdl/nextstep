import { test, expect } from '@playwright/test';
test.beforeEach(async ({request}) => {
  const state = await (await request.get('/api/agent')).json();
  await request.delete('/api/agent/schedule',{data:{version:state.schedule.version}});
  const {profile} = await (await request.get('/api/profile')).json();
  await request.patch('/api/profile',{data:{version:profile.version,roles:'',locations:'',workStyle:''}});
  const {onboarding} = await (await request.get('/api/agent')).json();
  await request.patch('/api/onboarding',{data:{version:onboarding.version,status:'new',step:0}});
});
test('first launch is generic, can be skipped, stays skipped, and can be resumed',async ({page,request}) => {
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Roles and work you want')).toHaveValue('');
  await expect(page.getByLabel('Location and work eligibility')).toHaveValue('');
  await page.screenshot({path:'test-results/onboarding-welcome.png'});
  await page.getByRole('button',{name:'Use the board for now'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button',{name:'New opportunity',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Search agent',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('what kind of work');
  await page.getByLabel('Roles and work you want').fill('Museum education and public programmes');
  await page.getByLabel('Location and work eligibility').fill('The region I chose');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A little help finding your next role.'})).toBeVisible();
  await expect(page.getByLabel('When should it look for jobs?')).toHaveValue('demand');
  await page.getByRole('button',{name:'Close setup'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await page.getByRole('button',{name:'Search agent',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A little help finding your next role.'})).toBeVisible();
  const {profile} = await (await request.get('/api/profile')).json(); expect(profile.roles).toBe('Museum education and public programmes');
});
test('manual browser connection and on-demand handoff are honest and contain the exact database',async ({page,request}) => {
  await page.goto('/');
  await page.getByLabel('Roles and work you want').fill('Restoration work');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Codex',exact:false}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Copy setup request',exact:true})).toBeDisabled();
  await page.getByText('Advanced connection',{exact:true}).click();
  await page.getByLabel('I added the connection in my agent').check();
  await expect(page.getByRole('button',{name:'Copy setup request',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Copy setup request',exact:true}).click();
  await page.getByText('View setup request',{exact:true}).click();
  const state = await (await request.get('/api/agent')).json();
  await expect(page.getByLabel('Setup request',{exact:true})).toContainText(state.database);
  await expect(page.getByLabel('Setup request',{exact:true})).toContainText('I selected on-demand searches');
  await expect(page.getByText('Waiting for your agent to connect',{exact:true})).toBeVisible();
  expect(state.onboarding.connectedAt).toBeNull(); expect(state.schedule.taskId).toBe('');
  await page.getByRole('button',{name:'Go to my board'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('mobile setup keeps profile drafts on conflict and has no horizontal overflow',async ({page,request}) => {
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await page.getByLabel('Roles and work you want').fill('My unsaved search');
  const {profile} = await (await request.get('/api/profile')).json();
  await request.patch('/api/profile',{data:{version:profile.version,roles:'Another confirmed preference'}});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('changed elsewhere');
  await expect(page.getByLabel('Roles and work you want')).toHaveValue('My unsaved search');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/onboarding-mobile.png'});
  await page.getByRole('button',{name:'Close setup'}).click();
  await page.getByRole('button',{name:'Keep editing'}).click();
  await expect(page.getByLabel('Roles and work you want')).toHaveValue('My unsaved search');
});

for (const provider of ['claude-code','codex'] as const) {
  test(`${provider} onboarding opens a prepared conversation even without clipboard access`,async ({page,request}) => {
    await page.addInitScript(provider => {
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async () => { throw new Error('Clipboard blocked'); }}});
      window.nextstepDesktop = {
        getAgents:async () => [{provider,label:provider,installed:true,canConnect:true}],
        connectAgent:async () => { throw new Error('Opening must perform connection setup in the main process'); },
        openAgent:async (selected,purpose) => {
          if (selected !== provider || purpose !== 'setup') throw new Error('Incorrect handoff target');
          return (await fetch('/api/agent/setup')).json();
        },
      };
    },provider);
    await page.goto('/');
    await page.getByLabel('Roles and work you want').fill('Fictional research preferences');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    const label = provider === 'claude-code' ? 'Claude Code' : 'Codex';
    await page.getByRole('button',{name:label,exact:false}).click();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('button',{name:`Open setup in ${label}`,exact:true}).click();
    await expect(page.locator('.agent-notice')).toContainText('request filled in');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByText('View setup request',{exact:true}).click();
    const state = await (await request.get('/api/agent')).json();
    await expect(page.getByLabel('Setup request',{exact:true})).toContainText(state.database);
    await expect(page.getByText('Waiting for your agent to connect',{exact:true})).toBeVisible();
    expect(state.onboarding.connectedAt).toBeNull();
    await page.screenshot({path:`test-results/onboarding-handoff-${provider}.png`});
  });
}

test('a failed desktop launch keeps the request available without claiming a connection',async ({page}) => {
  await page.addInitScript(() => {
    window.nextstepDesktop = {
      getAgents:async () => [{provider:'claude-code',label:'Claude Code',installed:true,canConnect:true}],
      connectAgent:async () => ({configured:true}),
      openAgent:async () => { throw new Error('Could not open a new Claude Code conversation'); },
    };
  });
  await page.goto('/');
  await page.getByLabel('Roles and work you want').fill('Fictional research preferences');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Claude Code',exact:false}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Open setup in Claude Code',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Could not open a new Claude Code conversation');
  await expect(page.getByLabel('Setup request',{exact:true})).toBeVisible();
  await expect(page.getByText('Waiting for your agent to connect',{exact:true})).toBeVisible();
});
