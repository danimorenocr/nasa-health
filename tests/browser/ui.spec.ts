import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
test.beforeAll(()=>mkdirSync('test-results/screenshots',{recursive:true}));
test('text flow, reload persistence, history, urgency and deletion',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#status')).toContainText('SQLite local');
 await page.locator('#text').fill('Pulso 82 lpm');await page.locator('#submit').click();await expect(page.locator('#confirm-form')).toBeVisible();await expect(page.locator('#count')).toHaveText('0');
 await page.locator('#origin').fill('Pulsómetro ficticio');await page.locator('#context').fill('Solo prueba');await page.getByRole('button',{name:'Confirmar registro'}).click();await expect(page.locator('#count')).toHaveText('1');
 await page.reload();await expect(page.locator('#count')).toHaveText('1');await expect(page.locator('#entries')).toContainText('Pulso 82 lpm');
 await page.getByRole('button',{name:'Consultar últimos 30 días'}).click();await expect(page.locator('#history')).toContainText('82');
 await page.setViewportSize({width:1200,height:1000});await page.screenshot({path:'test-results/screenshots/nasa-fastapi-desktop.png',fullPage:true});
 await page.locator('#text').fill('Me duele el pecho y me falta el aire');await page.locator('#submit').click();await expect(page.locator('#response')).toContainText('no ha avisado a nadie');await expect(page.locator('#confirm-form')).toBeHidden();await expect(page.locator('#count')).toHaveText('1');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/screenshots/nasa-fastapi-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('bitacora-prueba.json');
 page.once('dialog',d=>d.accept());await page.locator('#reset').click();await expect(page.locator('#count')).toHaveText('0');expect(errors).toEqual([]);
});
test('OSDR real public metadata snapshot is separate from health records',async({page})=>{
 await page.goto('/demo');await expect(page.locator('#status')).toContainText('SQLite local');await page.locator('#research-form button').click();await expect(page.locator('#research')).toContainText('SpaceX Inspiration4');await expect(page.locator('#research')).toContainText('Homo sapiens');await expect(page.locator('#research')).toContainText('No se descargaron mediciones');await expect(page.locator('#count')).toHaveText('0');
 await page.setViewportSize({width:900,height:1000});await page.locator('#research').evaluate(el=>el.parentElement!.setAttribute('id','research-section'));await page.locator('#research-section').screenshot({path:'test-results/screenshots/nasa-fastapi-osdr.png'});
 const links=await page.locator('#research a').evaluateAll(els=>els.map(e=>(e as HTMLAnchorElement).href));expect(links).toContain('https://visualization.osdr.nasa.gov/biodata/api/v2/dataset/OSD-656/');
});
test('untrusted input stays plain text',async({page})=>{
 await page.goto('/');await expect(page.locator('#status')).toContainText('SQLite local');await page.locator('#text').fill('<img src=x onerror=alert()> me siento mareado');await page.locator('#submit').click();await page.locator('#origin').fill('Declarado ficticio');await page.getByRole('button',{name:'Confirmar registro'}).click();await expect(page.locator('#entries')).toContainText('<img');await expect(page.locator('#entries img')).toHaveCount(0);
});
