import { test, expect } from '@playwright/test';

test('collection layout persists through navigation and reload without leaking to another collection', async ({page, request}) => {
  const a = `layout_a_${Date.now()}`, b = `layout_b_${Date.now()}`;
  expect((await request.post('/api/crm/apply', {data:{id:crypto.randomUUID(),title:'Fictional layout fixtures',operations:[a,b].map(id=>({type:'create_collection',id,name:id,fields:[{key:'status',name:'Status',type:'select',options:['New','Done']}]}))}})).ok()).toBeTruthy();
  await page.goto(`/#/collections/${a}`);
  await page.getByRole('button',{name:'Board view',exact:true}).click();
  await expect(page.getByRole('button',{name:'Board view',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(id=>localStorage.getItem(`nextstep-layout:${id}`),a)).toBe('board');
  await page.getByRole('navigation',{name:'Collections',exact:true}).getByRole('link',{name:b,exact:true}).click();
  await expect(page.getByRole('button',{name:'Table view',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('navigation',{name:'Collections',exact:true}).getByRole('link',{name:a,exact:true}).click();
  await expect(page.getByRole('button',{name:'Board view',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.reload();
  await expect(page.getByRole('button',{name:'Board view',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:'test-results/persistent-pipeline.png'});
  await page.getByRole('button',{name:'Table view',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('button',{name:'Table view',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.evaluate(id=>localStorage.setItem(`nextstep-layout:${id}`,'invalid'),a);
  await page.reload();
  await expect(page.getByRole('button',{name:'Table view',exact:true})).toHaveAttribute('aria-pressed','true');
});
