import {test,expect,Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
test.beforeAll(()=>mkdirSync('test-results/screenshots',{recursive:true}));

// Reconocimiento de voz simulado: permite probar el flujo del botón, la transcripción
// editable y los errores SIN afirmar que el servicio de voz real del navegador funciona.
const MOCK_SR=`class MockSR{constructor(){(window.__srInstances=window.__srInstances||[]).push(this);}
 start(){this.started=true;const s=this;setTimeout(()=>s.onstart&&s.onstart({type:'start'}),0);}
 stop(){const s=this;setTimeout(()=>s.onend&&s.onend({type:'end'}),0);}
 abort(){const s=this;setTimeout(()=>s.onend&&s.onend({type:'end'}),0);}
 emit(parts){const list={length:parts.length};parts.forEach((p,i)=>{list[i]={0:{transcript:p.t},isFinal:!!p.final,length:1};});if(this.onresult)this.onresult({resultIndex:0,results:list});}
 fail(error){if(this.onerror)this.onerror({error});const s=this;setTimeout(()=>s.onend&&s.onend({type:'end'}),0);}}
window.SpeechRecognition=MockSR;`;

async function lastSr(page:Page,code:string){return page.evaluate(`window.__srInstances[window.__srInstances.length-1].${code}`);}

test('without SpeechRecognition the mic button stays hidden and typing still works',async({page})=>{
 await page.addInitScript(()=>{delete (window as any).SpeechRecognition;delete (window as any).webkitSpeechRecognition;});
 await page.goto('/');await expect(page.locator('#status')).toContainText('SQLite local');
 await expect(page.locator('#voice-toggle')).toBeHidden();
 await expect(page.locator('#voice-hint')).toBeHidden();
 await expect(page.locator('#voice-status')).toContainText('no disponible');
 await page.locator('#text').fill('Pulso 82 lpm');await page.locator('#submit').click();
 await expect(page.locator('#confirm-form')).toBeVisible();await expect(page.locator('#voice-confirm-hint')).toBeHidden();
});

test('dictation fills an editable transcript, never auto-saves and ends in the same confirm flow',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(MOCK_SR);
 await page.goto('/');await expect(page.locator('#status')).toContainText('SQLite local');
 await expect(page.locator('#voice-toggle')).toBeVisible();
 await expect(page.locator('#voice-hint')).toContainText('puede salir de tu equipo');
 await page.locator('#text').fill('Bitácora:');
 await page.locator('#voice-toggle').click();
 await expect(page.locator('#voice-toggle')).toHaveText('Detener dictado');
 await expect(page.locator('#voice-status')).toContainText('Escuchando');
 await lastSr(page,`emit([{t:'Pulso 82'}])`);
 await expect(page.locator('#text')).toHaveValue('Bitácora: Pulso 82');
 await lastSr(page,`emit([{t:'Pulso 82 lpm en reposo',final:true}])`);
 await expect(page.locator('#text')).toHaveValue('Bitácora: Pulso 82 lpm en reposo');
 await expect(page.locator('#count')).toHaveText('0');
 await page.setViewportSize({width:1200,height:1000});
 await page.screenshot({path:'test-results/screenshots/nasa-voice-listening-desktop.png',fullPage:true});
 await page.locator('#voice-toggle').click();
 await expect(page.locator('#voice-toggle')).toHaveText('Dictar por voz');
 await expect(page.locator('#text')).toHaveValue('Bitácora: Pulso 82 lpm en reposo');
 await page.locator('#text').fill('Pulso 82 lpm en reposo');
 await page.locator('#submit').click();
 await expect(page.locator('#confirm-form')).toBeVisible();
 await expect(page.locator('#voice-confirm-hint')).toBeVisible();
 await expect(page.locator('#count')).toHaveText('0');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/screenshots/nasa-voice-confirm-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#origin').fill('Pulsómetro ficticio');
 await page.getByRole('button',{name:'Confirmar registro'}).click();
 await expect(page.locator('#count')).toHaveText('1');
 await expect(page.locator('#voice-confirm-hint')).toBeHidden();
 await expect(page.locator('#entries')).toContainText('Pulso 82 lpm en reposo');
 await expect(page.locator('#entries')).toContainText('Pulsómetro ficticio');
 expect(errors).toEqual([]);
});

test('typed text without dictation does not show the voice review hint',async({page})=>{
 await page.addInitScript(MOCK_SR);
 await page.goto('/');await expect(page.locator('#status')).toContainText('SQLite local');
 await page.locator('#text').fill('Temperatura 37,2 °C');await page.locator('#submit').click();
 await expect(page.locator('#confirm-form')).toBeVisible();
 await expect(page.locator('#voice-confirm-hint')).toBeHidden();
});

test('permission denial and voice-service failure keep text entry and explain themselves',async({page})=>{
 await page.addInitScript(MOCK_SR);
 await page.goto('/');await expect(page.locator('#status')).toContainText('SQLite local');
 await page.locator('#voice-toggle').click();await expect(page.locator('#voice-status')).toContainText('Escuchando');
 await lastSr(page,`fail('not-allowed')`);
 await expect(page.locator('#voice-status')).toContainText('Permiso de micrófono denegado');
 await expect(page.locator('#voice-toggle')).toHaveText('Dictar por voz');
 await page.locator('#voice-toggle').click();
 await lastSr(page,`fail('network')`);
 await expect(page.locator('#voice-status')).toContainText('internet');
 await page.locator('#text').fill('Pulso 80 lpm');await page.locator('#submit').click();
 await expect(page.locator('#confirm-form')).toBeVisible();
});

test('discarding a dictated draft saves nothing',async({page})=>{
 await page.addInitScript(MOCK_SR);
 await page.goto('/');await expect(page.locator('#status')).toContainText('SQLite local');
 await page.locator('#voice-toggle').click();
 await lastSr(page,`emit([{t:'Glucosa 95 mg/dL en ayunas',final:true}])`);
 await page.locator('#submit').click();
 await expect(page.locator('#voice-confirm-hint')).toBeVisible();
 await page.locator('#cancel').click();
 await expect(page.locator('#count')).toHaveText('0');
 await expect(page.locator('#confirm-form')).toBeHidden();
 await expect(page.locator('#voice-confirm-hint')).toBeHidden();
});
