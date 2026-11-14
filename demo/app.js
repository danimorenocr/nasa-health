const $=id=>document.getElementById(id);
const TOKEN_KEY='space-health-demo-session-v2';
let token=sessionStorage.getItem(TOKEN_KEY),pending=null,busy=false;
async function api(path,method='GET',body){
 const r=await fetch(`/api/v1/${path}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=r.status===204?null:await r.json();
 if(!r.ok){const e=new Error(data?.detail||'No se pudo completar la solicitud.');e.status=r.status;throw e;}
 return data;
}
function show(message,urgent=false){$('response').hidden=false;$('response').textContent=message;$('response').className=urgent?'urgent':'';}
function recordResponse(data){$('api-response').textContent=JSON.stringify(data,null,2);}
function disable(value){busy=value;for(const id of ['submit','export','reset','analyze','synthetic'])$(id).disabled=value||!token;for(const b of $('confirm-form').querySelectorAll('button'))b.disabled=value;}
function clearPending(){pending=null;$('confirm-form').hidden=true;$('origin').value='';$('context').value='';$('measured-at').value='';$('voice-confirm-hint').hidden=true;dictated=false;}
async function refresh(){const data=await api('entries');$('count').textContent=String(data.count);$('entries').replaceChildren();if(!data.count){const p=document.createElement('p');p.textContent='Sin registros. Una entrada enviada no se guarda hasta confirmarla.';$('entries').append(p);}
 for(const entry of data.entries){const article=document.createElement('article'),p=document.createElement('p'),small=document.createElement('small');p.textContent=entry.candidate.original_text;small.textContent=`${entry.origin} · medición: ${new Date(entry.measured_at).toLocaleString('es-CO')}${entry.context?' · '+entry.context:''}`;article.append(p,small);$('entries').append(article);}}
async function newSession(){const s=await api('sessions','POST');token=s.token;sessionStorage.setItem(TOKEN_KEY,token);}
async function start(){try{if(token){try{await api('session');}catch(e){if(e.status!==401)throw e;token=null;sessionStorage.removeItem(TOKEN_KEY);show('La sesión anterior venció o fue eliminada. Se inició una nueva.');}}
 if(!token)await newSession();$('status').textContent='Backend conectado · SQLite local · sesión 30 días';disable(false);await refresh();const c=await api('capabilities');for(const source of c.sources){const p=document.createElement('p'),a=document.createElement('a');a.href=source.url;a.textContent=source.title;a.target='_blank';a.rel='noopener noreferrer';p.append(a,document.createTextNode(' · '+source.scope));$('sources').append(p);}for(const text of c.limitations){const li=document.createElement('li');li.textContent=text;$('limitations').append(li);}}catch(e){$('status').textContent=e.message;}}
$('message-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;if(listening&&rec)rec.stop();const wasDictated=dictated;disable(true);try{clearPending();const data=await api('messages','POST',{text:$('text').value});recordResponse(data);show(data.message,data.status==='safety_notice');if(data.pending_id){pending=data.pending_id;$('candidate').textContent=JSON.stringify(data.candidate,null,2);if(wasDictated)$('voice-confirm-hint').hidden=false;$('confirm-form').hidden=false;}}catch(e){show(e.message);}finally{disable(false);}});
$('confirm-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||!pending)return;disable(true);try{const date=$('measured-at').value;const data=await api('confirmations','POST',{pending_id:pending,confirmed:true,origin:$('origin').value,context:$('context').value,...(date?{measured_at:new Date(date).toISOString()}:{})});recordResponse(data);clearPending();show(data.message);$('text').value='';await refresh();}catch(e){show(e.message);}finally{disable(false);}});
$('cancel').addEventListener('click',async()=>{if(busy)return;disable(true);try{await api('pending','DELETE');clearPending();show('Entrada descartada. No se guardó.');}catch(e){show(e.message);}finally{disable(false);}});
for(const b of document.querySelectorAll('[data-example]'))b.addEventListener('click',()=>{$('text').value=b.dataset.example;$('text').focus();});
$('export').addEventListener('click',async()=>{if(busy)return;disable(true);try{const data=await api('export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='bitacora-prueba.json';a.click();URL.revokeObjectURL(url);show('JSON descargado. Archivo local con todos los registros de esta sesión.');}catch(e){show(e.message);}finally{disable(false);}});
$('reset').addEventListener('click',async()=>{if(busy||!confirm('¿Borrar todos los registros y propuestas de esta sesión en SQLite?'))return;disable(true);try{await api('session','DELETE');sessionStorage.removeItem(TOKEN_KEY);token=null;await newSession();clearPending();recordResponse({status:'session_reset'});await refresh();$('history').textContent='Sin consulta.';show('Sesión borrada de la base local. Se inició una sesión vacía. Los archivos JSON descargados no se borran automáticamente.');}catch(e){show(e.message);}finally{disable(false);}});
$('history-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||!token)return;disable(true);try{const data=await api(`history?metric=${encodeURIComponent($('metric').value)}&days=30`);$('history').textContent=JSON.stringify(data,null,2);recordResponse(data);}catch(e){show(e.message);}finally{disable(false);}});
start();

$('research-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;disable(true);const box=$('research');box.textContent='Consultando OSDR (puede tardar hasta 25 segundos)…';try{const data=await api(`research/studies/${encodeURIComponent($('accession').value)}`);recordResponse(data);box.replaceChildren();for(const text of [data.title,`Organismo: ${data.organisms.join(', ')} · Material: ${data.materials.join(', ')}`,`Técnicas: ${data.technologies.join(', ')}`,`Recuperado: ${data.retrieved_at} · ${data.cached?'Copia local':'Consulta real a NASA'}${data.stale?' · DESACTUALIZADO, OSDR no disponible':''}`,`Archivos: ${data.file_count_total??"no verificado"} en la fuente; ${data.files.length} listados${data.files_truncated?" (lista limitada)":""}. No se descargaron mediciones ni se entrenó un modelo.`,...data.description]){const p=document.createElement('p');p.textContent=text;box.append(p);}for(const [label,url]of [['Fuente API',data.api_url],['Términos y cita de datos',data.reuse.terms_url]]){const p=document.createElement('p'),a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);box.append(p);}const note=document.createElement('p');note.className='notice';note.textContent='Investigación, no protocolo clínico ni conexión a signos vitales. '+data.reuse.note;box.append(note);if(data.files_error){const p=document.createElement('p');p.textContent=data.files_error;box.append(p);}}catch(e){box.textContent=e.message;}finally{disable(false);}});

async function analyze(){try{
 const metric=$('analysis-metric').value;
 const off=-new Date().getTimezoneOffset(),a=await api(`analysis/${metric}?days=7&tz_offset_minutes=${off}`),p=a.personal_calculation;
 recordResponse(a);$('analysis-out').hidden=false;$('analysis-personal').textContent=p.message;
 const bars=$('analysis-bars');bars.replaceChildren();
 const groups=[];
 if(metric==='sleep')groups.push({title:null,points:p.nights.map(n=>({date:n.date,values:[n.hours]})),unit:'h',max:12});
 else for(const s of p.series){if(!s.points.length)continue;const mx=Math.max(...s.points.map(pt=>pt.values[0]));groups.push({title:(s.context_label?s.context_label+' · ':'')+s.unit,points:s.points,unit:s.unit,max:mx||1});}
 for(const g of groups){const wrap=document.createElement('div');wrap.className='bar-group';wrap.setAttribute('role','img');if(g.title){const t=document.createElement('p');t.className='bar-group-title';t.textContent=g.title;wrap.append(t);}
  for(const pt of g.points){const row=document.createElement('div');row.className='bar-row';const d=document.createElement('span');d.textContent=pt.date.slice(5);const b=document.createElement('span');b.className='bar';b.style.width=`${Math.max(3,Math.min(100,pt.values[0]/g.max*100))}%`;const v=document.createElement('span');v.textContent=pt.values.map(x=>String(x).replace('.',',')).join('/')+' '+g.unit;row.append(d,b,v);wrap.append(row);}bars.append(wrap);}
 const bits=[];
 if(metric==='sleep'){bits.push(`Cobertura: ${p.nights_recorded} de ${p.days_in_window} días.`,'Fechas por medición declarada, no verificada como noche.');if(p.naps_excluded.length)bits.push(`${p.naps_excluded.length} siesta(s) aparte.`);}
 else{bits.push(`${p.series.reduce((n,s)=>n+s.records,0)} registro(s) en la ventana.`,'Fechas por medición declarada.');if(p.not_processed&&p.not_processed.length){bits.push(`${p.not_processed.length} registro(s) no procesados automáticamente (límite del prototipo o de escala, no un juicio médico), conservados para revisión:`);for(const r of p.not_processed)bits.push(`${r.date}: ${r.values.map(x=>String(x).replace('.',',')).join('/')} ${r.unit} — ${r.detail}.`);}}
 if(metric==='sleep'){if(p.duplicates_collapsed)bits.push(`${p.duplicates_collapsed} duplicado(s) contados una vez.`);if(p.conflicting_dates.length)bits.push(`${p.conflicting_dates.length} fecha(s) en conflicto excluidas.`);}
 $('analysis-detail').textContent=bits.join(' ');
 $('analysis-edu').textContent=a.education.text;$('analysis-scope').textContent=a.education.scope;
 const src=(await api('capabilities')).sources.find(s=>s.id===a.education.source_id);$('analysis-link').href=src.url;$('analysis-link').textContent=src.title;
 $('analysis-cannot').replaceChildren(...a.cannot_conclude.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));
}catch(e){show(e.message);}}
$('analyze').addEventListener('click',analyze);
$('synthetic').addEventListener('click',async()=>{try{await api(`synthetic/${$('analysis-metric').value}`,'POST');await refresh();await analyze();}catch(e){show(e.message);}});

// Dictado por voz con la Web Speech API del navegador. Solo rellena el cuadro de texto
// editable: nunca envía, confirma ni guarda nada por sí solo. El audio no pasa por este
// backend; lo procesa el servicio de voz del navegador (puede requerir internet).
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let rec=null,listening=false,dictated=false,voiceBase='',voiceFinal='';
const VOICE_PRIVACY='El dictado usa el reconocimiento de voz del navegador: el audio puede salir de tu equipo hacia ese servicio y el dictado puede no funcionar sin internet. Revisa siempre la transcripción antes de enviarla; nada se guarda sin tu confirmación.';
const VOICE_ERRORS={'not-allowed':'Permiso de micrófono denegado. El dictado necesita tu permiso; puedes seguir escribiendo con el teclado.','service-not-allowed':'Permiso de micrófono denegado. El dictado necesita tu permiso; puedes seguir escribiendo con el teclado.','audio-capture':'No se encontró un micrófono disponible. Puedes seguir escribiendo con el teclado.','network':'El servicio de voz del navegador no respondió; suele necesitar internet. Puedes seguir escribiendo con el teclado.','no-speech':'No se detectó voz. Intenta de nuevo o escribe con el teclado.','language-not-supported':'El navegador no acepta el idioma configurado para el dictado. Puedes seguir escribiendo con el teclado.','aborted':''};
function voiceButton(){const b=$('voice-toggle');b.textContent=listening?'Detener dictado':'Dictar por voz';b.classList.toggle('listening',listening);}
function voiceSetup(){
 if(!SR){$('voice-status').textContent='Dictado por voz no disponible en este navegador; escribe con el teclado.';return;}
 $('voice-toggle').hidden=false;$('voice-hint').hidden=false;$('voice-hint').textContent=VOICE_PRIVACY;
 $('voice-toggle').addEventListener('click',()=>{
  if(listening){rec.stop();return;}
  voiceBase=$('text').value.trim();voiceFinal='';
  rec=new SR();rec.lang='es-CO';rec.continuous=true;rec.interimResults=true;
  rec.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i],t=r[0].transcript;if(r.isFinal){voiceFinal=(voiceFinal+' '+t).trim();dictated=true;}else interim+=t;}
   const spoken=(voiceFinal+' '+interim).trim();$('text').value=[voiceBase,spoken].filter(Boolean).join(' ');};
  rec.onerror=e=>{const m=VOICE_ERRORS[e.error]||`El dictado se detuvo (${e.error}). Puedes seguir escribiendo con el teclado.`;if(m)$('voice-status').textContent=m;};
  rec.onend=()=>{listening=false;voiceButton();if($('voice-status').textContent.startsWith('Escuchando'))$('voice-status').textContent='';};
  listening=true;voiceButton();$('voice-status').textContent='Escuchando… habla con calma; al detener, revisa y corrige el texto antes de enviarlo.';
  try{rec.start();}catch(err){listening=false;voiceButton();$('voice-status').textContent='No se pudo iniciar el dictado. Puedes seguir escribiendo con el teclado.';}
 });
}
voiceSetup();
