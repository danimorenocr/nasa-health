const $ = id => document.getElementById(id);
const TOKEN_KEY = 'space-health-demo-session-v2';
let token = sessionStorage.getItem(TOKEN_KEY), pending = null, busy = false;
let currentCandidate = null;

const METRIC_NAMES = {
  heart_rate: 'Pulso / Frecuencia cardíaca',
  temperature: 'Temperatura corporal',
  blood_pressure: 'Presión arterial',
  oxygen_saturation: 'Saturación de oxígeno (SpO2)',
  glucose: 'Glucosa en sangre',
  sleep: 'Horas de sueño'
};

async function api(path, method = 'GET', body = null, rawBody = null, contentType = null) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (contentType) headers['Content-Type'] = contentType;
  else if (body) headers['Content-Type'] = 'application/json';

  const r = await fetch(`/api/v1/${path}`, {
    method,
    headers,
    body: rawBody || (body ? JSON.stringify(body) : undefined)
  });
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) {
    const e = new Error(data?.detail || data?.message || 'No se pudo completar la solicitud.');
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

function show(message, urgent = false) {
  $('response').hidden = false;
  $('response').textContent = message;
  $('response').className = urgent ? 'urgent' : '';
  if (synthSupported) {
    $('tts-speak').hidden = false;
    updateTtsButtons();
    if (ttsEnabled) speak(message);
  }
}

function recordResponse(data) {
  $('api-response').textContent = JSON.stringify(data, null, 2);
}

function disable(value) {
  busy = value;
  for (const id of ['submit', 'export', 'reset', 'analyze', 'synthetic', 'confirm-submit-btn', 'record-btn']) {
    const el = $(id);
    if (el) el.disabled = value || !token;
  }
  for (const b of $('confirm-form').querySelectorAll('button')) b.disabled = value;
}

function setFlowState(state, message = '') {
  const box = $('flow-status');
  if (!box) return;
  box.className = 'flow-status-box';

  if (state === 'idle') {
    box.hidden = true;
    box.textContent = '';
    return;
  }

  box.hidden = false;
  box.classList.add(`state-${state}`);

  if (state === 'revisar') {
    box.textContent = message || '📋 Revisa las mediciones propuestas en el formulario antes de confirmar.';
  } else if (state === 'guardando') {
    box.textContent = '💾 Guardando registro en SQLite local...';
  } else if (state === 'guardado') {
    box.textContent = message ? `✅ ${message}` : '✅ Registro guardado exitosamente en SQLite local.';
  } else if (state === 'error') {
    box.textContent = message ? `⚠️ ${message}` : '⚠️ Ocurrió un error en el flujo.';
  }
}

function formatCandidateItem(item) {
  const name = METRIC_NAMES[item.metric] || item.metric || 'Medición';
  const valStr = (item.values || []).map(v => String(v).replace('.', ',')).join('/');
  return `${valStr} ${item.unit || ''}`.trim();
}

let currentCandidateSpeechText = '';

function buildCandidateSpeechText(candidate) {
  if (!candidate) return '';
  if (candidate.kind === 'batch') {
    const parts = candidate.measurements.map(m => `${METRIC_NAMES[m.metric] || m.metric}: ${m.values.map(x => String(x).replace('.', ',')).join(' con ')} ${m.unit}`);
    return `Propuesta de múltiples mediciones: ${parts.join(', ')}. Origen propuesto: ${candidate.suggested_origin || 'instrumento clínico'}. Revisa y confirma antes de guardar.`;
  }
  if (candidate.kind === 'measurement') {
    const name = METRIC_NAMES[candidate.metric] || candidate.metric;
    const vals = candidate.values.map(x => String(x).replace('.', ',')).join(' con ');
    return `Propuesta detectada: ${name}, valor ${vals} ${candidate.unit}. Origen propuesto: ${candidate.suggested_origin || 'instrumento clínico'}. Revisa y confirma antes de guardar.`;
  }
  if (candidate.kind === 'symptom') {
    return `Propuesta de síntoma: ${candidate.original_text}. Revisa y confirma antes de guardar.`;
  }
  return '';
}

function renderCandidateSummary(candidate) {
  const box = $('candidate-summary');
  const btn = $('candidate-speak-btn');
  if (!box) return;
  box.replaceChildren();

  if (!candidate) {
    box.hidden = true;
    currentCandidateSpeechText = '';
    if (btn) btn.hidden = true;
    return;
  }
  box.hidden = false;
  currentCandidateSpeechText = buildCandidateSpeechText(candidate);
  if (btn) btn.hidden = !currentCandidateSpeechText;

  if (candidate.kind === 'batch') {
    const title = document.createElement('strong');
    title.textContent = `Mediciones detectadas en el audio (${candidate.measurements.length}):`;
    title.style.display = 'block';
    title.style.marginBottom = '8px';
    box.append(title);

    for (const m of candidate.measurements) {
      const row = document.createElement('div');
      row.className = 'candidate-item';
      const nameEl = document.createElement('span');
      nameEl.className = 'metric-name';
      nameEl.textContent = METRIC_NAMES[m.metric] || m.metric;
      const valEl = document.createElement('span');
      valEl.className = 'metric-value';
      valEl.textContent = formatCandidateItem(m);
      row.append(nameEl, valEl);
      box.append(row);
    }
  } else if (candidate.kind === 'measurement') {
    const row = document.createElement('div');
    row.className = 'candidate-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'metric-name';
    nameEl.textContent = METRIC_NAMES[candidate.metric] || candidate.metric;
    const valEl = document.createElement('span');
    valEl.className = 'metric-value';
    valEl.textContent = formatCandidateItem(candidate);
    row.append(nameEl, valEl);
    box.append(row);
  } else if (candidate.kind === 'symptom') {
    const row = document.createElement('div');
    row.className = 'candidate-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'metric-name';
    nameEl.textContent = 'Síntoma declarado';
    const valEl = document.createElement('span');
    valEl.className = 'metric-value';
    valEl.textContent = candidate.original_text || '';
    row.append(nameEl, valEl);
    box.append(row);
  }
}

function clearPending() {
  pending = null;
  currentCandidate = null;
  $('confirm-form').hidden = true;
  $('origin').value = '';
  $('context').value = '';
  $('measured-at').value = '';
  $('voice-confirm-hint').hidden = true;
  dictated = false;
  currentCandidateSpeechText = '';
  if ($('candidate-speak-btn')) $('candidate-speak-btn').hidden = true;
  renderCandidateSummary(null);
}

async function refresh() {
  const data = await api('entries');
  $('count').textContent = String(data.count);
  $('entries').replaceChildren();
  if (!data.count) {
    const p = document.createElement('p');
    p.textContent = 'Sin registros. Una entrada enviada no se guarda hasta confirmarla.';
    $('entries').append(p);
  }
  for (const entry of data.entries) {
    const article = document.createElement('article'), p = document.createElement('p'), small = document.createElement('small');
    p.textContent = entry.candidate.original_text || (entry.candidate.metric ? formatCandidateItem(entry.candidate) : 'Registro');
    small.textContent = `${entry.origin} · medición: ${new Date(entry.measured_at).toLocaleString('es-CO')}${entry.context ? ' · ' + entry.context : ''}`;
    article.append(p, small);
    $('entries').append(article);
  }
}

async function newSession() {
  const s = await api('sessions', 'POST');
  token = s.token;
  sessionStorage.setItem(TOKEN_KEY, token);
}

async function start() {
  try {
    if (token) {
      try {
        await api('session');
      } catch (e) {
        if (e.status !== 401) throw e;
        token = null;
        sessionStorage.removeItem(TOKEN_KEY);
        show('La sesión anterior venció o fue eliminada. Se inició una nueva.');
      }
    }
    if (!token) await newSession();
    $('status').textContent = 'Backend conectado · SQLite local · sesión 30 días';
    disable(false);
    await refresh();
    const c = await api('capabilities');
    for (const source of c.sources) {
      const p = document.createElement('p'), a = document.createElement('a');
      a.href = source.url;
      a.textContent = source.title;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      p.append(a, document.createTextNode(' · ' + source.scope));
      $('sources').append(p);
    }
    for (const text of c.limitations) {
      const li = document.createElement('li');
      li.textContent = text;
      $('limitations').append(li);
    }
  } catch (e) {
    $('status').textContent = e.message;
  }
}

async function submitMessage(isFromVoice = false) {
  if (busy) return;
  stopSpeaking();
  if (listening && rec) rec.stop();
  const wasDictated = isFromVoice || dictated;
  disable(true);
  try {
    clearPending();
    const data = await api('messages', 'POST', { text: $('text').value });
    recordResponse(data);
    show(data.message, data.status === 'safety_notice');

    if (data.pending_id) {
      pending = data.pending_id;
      currentCandidate = data.candidate;
      $('candidate').textContent = JSON.stringify(data.candidate, null, 2);
      renderCandidateSummary(data.candidate);

      if (data.candidate && data.candidate.suggested_origin) {
        $('origin').value = data.candidate.suggested_origin;
      } else if (wasDictated && !$('origin').value) {
        $('origin').value = 'Dictado de voz / instrumento declarado';
      }

      if (data.candidate && data.candidate.suggested_measured_at) {
        $('measured-at').value = data.candidate.suggested_measured_at;
      }

      if (wasDictated) {
        $('voice-confirm-hint').hidden = false;
      }

      if (data.recommendations) {
        $('recommendations-panel').hidden = false;
        const box = $('rec-content');
        box.replaceChildren();
        const aiCard = document.createElement('div');
        aiCard.className = 'ai-rec-card';
        const aiTitle = document.createElement('h4');
        aiTitle.textContent = '🚀 Recomendación ASTRA · Asistente IA de Vuelo (Evidencia NASA)';
        aiCard.append(aiTitle);
        const recList = Array.isArray(data.recommendations) ? data.recommendations : [data.recommendations];
        for (const item of recList) {
          const p = document.createElement('p');
          p.textContent = (recList.length > 1 ? '• ' : '') + item;
          aiCard.append(p);
        }
        box.append(aiCard);
        currentRecommendationText = `Recomendación de vuelo espacial: ${recList.join('. ')}`;
      }

      $('confirm-form').hidden = false;
      setFlowState('revisar');
    } else {
      setFlowState('idle');
    }
  } catch (e) {
    setFlowState('error', e.message);
    show(e.message);
  } finally {
    disable(false);
  }
}

$('message-form').addEventListener('submit', async e => {
  e.preventDefault();
  await submitMessage(false);
});

async function loadRecommendations(metric) {
  if (!metric) return;
  try {
    const off = -new Date().getTimezoneOffset();
    const a = await api(`analysis/${metric}?days=7&tz_offset_minutes=${off}`);
    const box = $('rec-content');
    box.replaceChildren();

    if (a.ai_recommendation) {
      const aiCard = document.createElement('div');
      aiCard.className = 'ai-rec-card';
      const aiTitle = document.createElement('h4');
      aiTitle.textContent = '🚀 Recomendación ASTRA · Asistente IA de Vuelo (Evidencia NASA)';
      const aiP = document.createElement('p');
      aiP.textContent = a.ai_recommendation;
      aiCard.append(aiTitle, aiP);
      box.append(aiCard);
    }

    const p = a.personal_calculation;
    const personalP = document.createElement('p');
    personalP.className = 'rec-personal';
    personalP.textContent = `Cálculo de registros: ${p.message}`;
    box.append(personalP);

    const eduP = document.createElement('p');
    eduP.className = 'rec-edu';
    eduP.textContent = `Información de la fuente (NASA): ${a.education.text}`;
    box.append(eduP);

    if (a.cannot_conclude && a.cannot_conclude.length) {
      const cannotP = document.createElement('p');
      cannotP.className = 'rec-cannot';
      cannotP.textContent = `Límites clínicos: ${a.cannot_conclude.join('; ')}.`;
      box.append(cannotP);
    }

    $('recommendations-panel').hidden = false;

    // Full text to speak: prioritize the AI contextual recommendation
    if (a.ai_recommendation) {
      currentRecommendationText = a.ai_recommendation;
    } else {
      const speechLines = [
        `Recomendaciones para ${METRIC_NAMES[metric] || metric}.`,
        p.message,
        a.education.text,
        `Límites: ${a.cannot_conclude.join('. ')}`
      ].filter(Boolean);
      currentRecommendationText = speechLines.join(' ');
    }

    if (ttsEnabled) {
      speak(currentRecommendationText);
    }
  } catch (err) {
    // Failure in recommendations or speech must not undo the saved record!
    console.error('Error al cargar recomendaciones:', err);
  }
}

let currentRecommendationText = '';

$('rec-speak-btn').addEventListener('click', () => {
  if (isSpeaking) {
    stopSpeaking();
  } else if (currentRecommendationText) {
    speak(currentRecommendationText);
  }
});

$('rec-replay-btn').addEventListener('click', () => {
  stopSpeaking();
  if (currentRecommendationText) {
    speak(currentRecommendationText);
  }
});

$('rec-stop-btn').addEventListener('click', () => {
  stopSpeaking();
});

$('confirm-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy || !pending) return;
  stopSpeaking();
  disable(true);
  setFlowState('guardando');

  try {
    const date = $('measured-at').value;
    const data = await api('confirmations', 'POST', {
      pending_id: pending,
      confirmed: true,
      origin: $('origin').value,
      context: $('context').value,
      ...(date ? { measured_at: new Date(date).toISOString() } : {})
    });
    recordResponse(data);

    // Save metric before clearing pending to fetch recommendations
    let savedMetric = null;
    if (currentCandidate) {
      if (currentCandidate.kind === 'batch' && currentCandidate.measurements?.length) {
        savedMetric = currentCandidate.measurements[0].metric;
      } else if (currentCandidate.metric) {
        savedMetric = currentCandidate.metric;
      }
    }

    clearPending();
    setFlowState('guardado', data.message);
    show(data.message);
    $('text').value = '';
    await refresh();

    if (savedMetric) {
      await loadRecommendations(savedMetric);
    }
  } catch (err) {
    setFlowState('error', err.message);
    show(err.message);
  } finally {
    disable(false);
  }
});

$('cancel').addEventListener('click', async () => {
  if (busy) return;
  stopSpeaking();
  disable(true);
  try {
    await api('pending', 'DELETE');
    clearPending();
    setFlowState('idle');
    show('Entrada descartada. No se guardó.');
  } catch (e) {
    show(e.message);
  } finally {
    disable(false);
  }
});

for (const b of document.querySelectorAll('[data-example]')) {
  b.addEventListener('click', () => {
    $('text').value = b.dataset.example;
    $('text').focus();
  });
}

$('export').addEventListener('click', async () => {
  if (busy) return;
  disable(true);
  try {
    const data = await api('export'), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url;
    a.download = 'bitacora-prueba.json';
    a.click();
    URL.revokeObjectURL(url);
    show('JSON descargado. Archivo local con todos los registros de esta sesión.');
  } catch (e) {
    show(e.message);
  } finally {
    disable(false);
  }
});

$('reset').addEventListener('click', async () => {
  if (busy || !confirm('¿Borrar todos los registros y propuestas de esta sesión en SQLite?')) return;
  stopSpeaking();
  disable(true);
  try {
    await api('session', 'DELETE');
    sessionStorage.removeItem(TOKEN_KEY);
    token = null;
    await newSession();
    clearPending();
    setFlowState('idle');
    $('recommendations-panel').hidden = true;
    recordResponse({ status: 'session_reset' });
    await refresh();
    $('history').textContent = 'Sin consulta.';
    show('Sesión borrada de la base local. Se inició una sesión vacía. Los archivos JSON descargados no se borran automáticamente.');
  } catch (e) {
    show(e.message);
  } finally {
    disable(false);
  }
});

let currentHistorySpeechText = '';

$('history-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy || !token) return;
  stopSpeaking();
  disable(true);
  try {
    const metric = $('metric').value;
    const metricName = METRIC_NAMES[metric] || metric;
    const data = await api(`history?metric=${encodeURIComponent(metric)}&days=30`);
    $('history').textContent = JSON.stringify(data, null, 2);
    recordResponse(data);
    const count = data.count || 0;
    if (count > 0) {
      currentHistorySpeechText = `Historial para ${metricName}: se encontraron ${count} registro(s) en los últimos 30 días.`;
    } else {
      currentHistorySpeechText = `Historial para ${metricName}: sin registros confirmados en los últimos 30 días.`;
    }
    const hBtn = $('history-speak-btn');
    if (hBtn) hBtn.hidden = false;
    if (ttsEnabled) speak(currentHistorySpeechText);
  } catch (e) {
    show(e.message);
  } finally {
    disable(false);
  }
});

start();

let currentResearchSpeechText = '';

$('research-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy) return;
  stopSpeaking();
  disable(true);
  const box = $('research');
  box.textContent = 'Consultando OSDR (puede tardar hasta 25 segundos)…';
  try {
    const data = await api(`research/studies/${encodeURIComponent($('accession').value)}`);
    recordResponse(data);
    box.replaceChildren();
    for (const text of [
      data.title,
      `Organismo: ${data.organisms.join(', ')} · Material: ${data.materials.join(', ')}`,
      `Técnicas: ${data.technologies.join(', ')}`,
      `Recuperado: ${data.retrieved_at} · ${data.cached ? 'Copia local' : 'Consulta real a NASA'}${data.stale ? ' · DESACTUALIZADO, OSDR no disponible' : ''}`,
      `Archivos: ${data.file_count_total ?? 'no verificado'} en la fuente; ${data.files.length} listados${data.files_truncated ? ' (lista limitada)' : ''}. No se descargaron mediciones ni se entrenó un modelo.`,
      ...data.description
    ]) {
      const p = document.createElement('p');
      p.textContent = text;
      box.append(p);
    }
    for (const [label, url] of [['Fuente API', data.api_url], ['Términos y cita de datos', data.reuse.terms_url]]) {
      const p = document.createElement('p'), a = document.createElement('a');
      a.textContent = label;
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      p.append(a);
      box.append(p);
    }
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent = 'Investigación, no protocolo clínico ni conexión a signos vitales. ' + data.reuse.note;
    box.append(note);
    if (data.files_error) {
      const p = document.createElement('p');
      p.textContent = data.files_error;
      box.append(p);
    }
    currentResearchSpeechText = `Estudio NASA ${data.accession}: ${data.title}. Organismo: ${data.organisms.join(', ')}.`;
    const rBtn = $('research-speak-btn');
    if (rBtn) rBtn.hidden = false;
    if (ttsEnabled) speak(currentResearchSpeechText);
  } catch (e) {
    box.textContent = e.message;
  } finally {
    disable(false);
  }
});

let currentAnalysisSpeechText = '';

async function analyze() {
  stopSpeaking();
  try {
    const metric = $('analysis-metric').value;
    const metricName = METRIC_NAMES[metric] || metric;
    const off = -new Date().getTimezoneOffset();
    const a = await api(`analysis/${metric}?days=7&tz_offset_minutes=${off}`);
    const p = a.personal_calculation;
    recordResponse(a);
    $('analysis-out').hidden = false;

    // Verificar si existen registros para este indicador
    let hasRecords = false;
    const msg = (p.message || '').toLowerCase();
    const hasEmptyText = msg.includes('no hay registros') || msg.includes('sin registros');
    if (!hasEmptyText) {
      if (metric === 'sleep') {
        hasRecords = (p.nights_recorded || 0) > 0;
      } else if (p.series && p.series.length > 0) {
        hasRecords = p.series.some(s => s.records > 0 && s.points && s.points.length > 0);
      }
    }

    if (hasRecords) {
      $('analysis-empty-notice').hidden = true;
      $('analysis-records-block').hidden = false;
      $('analysis-ai-box').hidden = false;
      $('analysis-ai-text').textContent = a.ai_recommendation || 'Análisis de registros completado.';

      $('analysis-personal').textContent = p.message;
      const bars = $('analysis-bars');
      bars.replaceChildren();
      const groups = [];
      if (metric === 'sleep') groups.push({ title: null, points: p.nights.map(n => ({ date: n.date, values: [n.hours] })), unit: 'h', max: 12 });
      else for (const s of p.series) {
        if (!s.points.length) continue;
        const mx = Math.max(...s.points.map(pt => pt.values[0]));
        groups.push({ title: (s.context_label ? s.context_label + ' · ' : '') + s.unit, points: s.points, unit: s.unit, max: mx || 1 });
      }
      for (const g of groups) {
        const wrap = document.createElement('div');
        wrap.className = 'bar-group';
        wrap.setAttribute('role', 'img');
        if (g.title) {
          const t = document.createElement('p');
          t.className = 'bar-group-title';
          t.textContent = g.title;
          wrap.append(t);
        }
        for (const pt of g.points) {
          const row = document.createElement('div');
          row.className = 'bar-row';
          const d = document.createElement('span');
          d.textContent = pt.date.slice(5);
          const b = document.createElement('span');
          b.className = 'bar';
          b.style.width = `${Math.max(3, Math.min(100, pt.values[0] / g.max * 100))}%`;
          const v = document.createElement('span');
          v.textContent = pt.values.map(x => String(x).replace('.', ',')).join('/') + ' ' + g.unit;
          row.append(d, b, v);
          wrap.append(row);
        }
        bars.append(wrap);
      }
      const bits = [];
      if (metric === 'sleep') {
        bits.push(`Cobertura: ${p.nights_recorded} de ${p.days_in_window} días.`, 'Fechas por medición declarada, no verificada como noche.');
        if (p.naps_excluded.length) bits.push(`${p.naps_excluded.length} siesta(s) aparte.`);
      } else {
        bits.push(`${p.series.reduce((n, s) => n + s.records, 0)} registro(s) en la ventana.`, 'Fechas por medición declarada.');
        if (p.not_processed && p.not_processed.length) {
          bits.push(`${p.not_processed.length} registro(s) no procesados automáticamente (límite del prototipo o de escala, no un juicio médico), conservados para revisión:`);
          for (const r of p.not_processed) bits.push(`${r.date}: ${r.values.map(x => String(x).replace('.', ',')).join('/')} ${r.unit} — ${r.detail}.`);
        }
      }
      if (metric === 'sleep') {
        if (p.duplicates_collapsed) bits.push(`${p.duplicates_collapsed} duplicado(s) contados una vez.`);
        if (p.conflicting_dates.length) bits.push(`${p.conflicting_dates.length} fecha(s) en conflicto excluidas.`);
      }
      $('analysis-detail').textContent = bits.join(' ');

      currentAnalysisSpeechText = a.ai_recommendation || `Análisis para ${metricName}. ${p.message}`;
    } else {
      // Sin registros confirmados en esta sesión: estado claro y mensaje orientador
      $('analysis-ai-box').hidden = true;
      $('analysis-records-block').hidden = true;
      $('analysis-empty-notice').hidden = false;
      const emptyMsg = `⚠️ Todavía no se puede analizar: no tienes registros confirmados de ${metricName} en esta sesión (últimos 7 días). Registra al menos una medición arriba para que ASTRA pueda generar el análisis asistido con evidencia de la NASA.`;
      $('analysis-empty-notice').textContent = emptyMsg;

      currentAnalysisSpeechText = `Todavía no se puede analizar. No tienes registros confirmados de ${metricName} en esta sesión. Por favor, registra una medición primero.`;
    }

    $('analysis-edu').textContent = a.education.text;
    $('analysis-scope').textContent = a.education.scope;
    const src = (await api('capabilities')).sources.find(s => s.id === a.education.source_id);
    if (src) {
      $('analysis-link').href = src.url;
      $('analysis-link').textContent = src.title;
    }
    $('analysis-cannot').replaceChildren(...a.cannot_conclude.map(t => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }));

    $('analysis-voice-actions').hidden = false;
    if (ttsEnabled) {
      speak(currentAnalysisSpeechText);
    }
  } catch (e) {
    show(e.message);
  }
}

$('analyze').addEventListener('click', analyze);
$('synthetic').addEventListener('click', async () => {
  try {
    await api(`synthetic/${$('analysis-metric').value}`, 'POST');
    await refresh();
    await analyze();
  } catch (e) {
    show(e.message);
  }
});

$('analysis-speak-btn').addEventListener('click', () => {
  if (isSpeaking) {
    stopSpeaking();
  } else if (currentAnalysisSpeechText) {
    speak(currentAnalysisSpeechText);
  }
});

$('analysis-replay-btn').addEventListener('click', () => {
  stopSpeaking();
  if (currentAnalysisSpeechText) {
    speak(currentAnalysisSpeechText);
  }
});

$('analysis-stop-btn').addEventListener('click', () => {
  stopSpeaking();
});

$('candidate-speak-btn')?.addEventListener('click', () => {
  if (isSpeaking) {
    stopSpeaking();
  } else if (currentCandidateSpeechText) {
    speak(currentCandidateSpeechText);
  }
});

$('history-speak-btn')?.addEventListener('click', () => {
  if (isSpeaking) {
    stopSpeaking();
  } else if (currentHistorySpeechText) {
    speak(currentHistorySpeechText);
  }
});

$('research-speak-btn')?.addEventListener('click', () => {
  if (isSpeaking) {
    stopSpeaking();
  } else if (currentResearchSpeechText) {
    speak(currentResearchSpeechText);
  }
});

// ==========================================
// 1. Dictado en vivo (Web Speech API)
// ==========================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, dictated = false, voiceBase = '', voiceFinal = '';
const VOICE_PRIVACY = 'El dictado continuo usa el reconocimiento de voz del navegador: el audio puede ser procesado externamente por el navegador. Nada se guarda sin tu confirmación.';
const VOICE_ERRORS = {
  'not-allowed': 'Permiso de micrófono denegado. Puedes seguir escribiendo con el teclado.',
  'service-not-allowed': 'Permiso de micrófono denegado. Puedes seguir escribiendo con el teclado.',
  'audio-capture': 'No se encontró un micrófono disponible.',
  'network': 'El servicio de voz del navegador no respondió; suele requerir internet.',
  'no-speech': 'No se detectó voz. Intenta de nuevo o escribe con el teclado.',
  'language-not-supported': 'El navegador no acepta español para el dictado en vivo.',
  'aborted': ''
};

function voiceButton() {
  const b = $('voice-toggle');
  b.textContent = listening ? 'Detener dictado' : '🗣️ Dictado en vivo';
  b.classList.toggle('listening', listening);
}

function voiceSetup() {
  if (!SR) return;
  $('voice-toggle').hidden = false;
  $('voice-hint').hidden = false;
  $('voice-hint').textContent = VOICE_PRIVACY;

  $('voice-toggle').addEventListener('click', () => {
    if (listening) {
      rec.stop();
      return;
    }
    stopSpeaking();
    voiceBase = $('text').value.trim();
    voiceFinal = '';
    rec = new SR();
    rec.lang = 'es-CO';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], t = r[0].transcript;
        if (r.isFinal) {
          voiceFinal = (voiceFinal + ' ' + t).trim();
          dictated = true;
        } else interim += t;
      }
      const spoken = (voiceFinal + ' ' + interim).trim();
      $('text').value = [voiceBase, spoken].filter(Boolean).join(' ');
    };

    rec.onerror = e => {
      const m = VOICE_ERRORS[e.error] || `El dictado se detuvo (${e.error}). Puedes seguir escribiendo con el teclado.`;
      if (m) $('voice-status').textContent = m;
    };

    rec.onend = () => {
      listening = false;
      voiceButton();
      if ($('voice-status').textContent.startsWith('Escuchando')) $('voice-status').textContent = '';
    };

    listening = true;
    voiceButton();
    $('voice-status').textContent = 'Escuchando en vivo… habla con calma. Al terminar, revisa y envía.';
    try {
      rec.start();
    } catch (err) {
      listening = false;
      voiceButton();
      $('voice-status').textContent = 'No se pudo iniciar el dictado en vivo. Puedes escribir con el teclado.';
    }
  });
}
voiceSetup();

// ==========================================
// 3. Respuesta por voz (SpeechSynthesis)
// ==========================================
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
const synthSupported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';
let ttsEnabled = true, isSpeaking = false;

function updateTtsButtons() {
  if (!synthSupported) return;
  const toggle = $('tts-toggle');
  if (toggle) {
    toggle.textContent = ttsEnabled ? '🔊 Voz: Activa' : '🔇 Voz: Silenciada';
    toggle.classList.toggle('active', ttsEnabled);
  }
  const speakBtn = $('tts-speak');
  if (speakBtn) {
    speakBtn.textContent = isSpeaking ? '⏹ Detener voz' : '🔊 Escuchar respuesta';
  }
  const recSpeakBtn = $('rec-speak-btn');
  const recStopBtn = $('rec-stop-btn');
  if (recSpeakBtn) {
    recSpeakBtn.textContent = isSpeaking ? '⏹ Detener voz' : '🔊 Escuchar recomendaciones';
  }
  if (recStopBtn) {
    recStopBtn.hidden = !isSpeaking;
  }
  const analysisSpeakBtn = $('analysis-speak-btn');
  const analysisStopBtn = $('analysis-stop-btn');
  if (analysisSpeakBtn) {
    analysisSpeakBtn.textContent = isSpeaking ? '⏹ Detener voz' : '🔊 Escuchar análisis';
  }
  if (analysisStopBtn) {
    analysisStopBtn.hidden = !isSpeaking;
  }
  const candBtn = $('candidate-speak-btn');
  if (candBtn) {
    candBtn.textContent = isSpeaking ? '⏹ Detener voz' : '🔊 Escuchar propuesta';
  }
  const histBtn = $('history-speak-btn');
  if (histBtn) {
    histBtn.textContent = isSpeaking ? '⏹ Detener voz' : '🔊 Escuchar historial';
  }
  const resBtn = $('research-speak-btn');
  if (resBtn) {
    resBtn.textContent = isSpeaking ? '⏹ Detener voz' : '🔊 Escuchar estudio';
  }
}

function speak(text) {
  if (!synthSupported || !text) return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-CO';
    u.rate = 1.0;
    const voices = synth.getVoices ? synth.getVoices() : [];
    const esVoice = voices.find(v => v.lang && (v.lang.startsWith('es-CO') || v.lang.startsWith('es-') || v.lang === 'es'));
    if (esVoice) u.voice = esVoice;
    u.onstart = () => { isSpeaking = true; updateTtsButtons(); };
    u.onend = () => { isSpeaking = false; updateTtsButtons(); };
    u.onerror = () => { isSpeaking = false; updateTtsButtons(); };
    synth.speak(u);
  } catch (err) {
    isSpeaking = false;
    updateTtsButtons();
  }
}

function stopSpeaking() {
  if (synthSupported) {
    try { synth.cancel(); } catch (err) { }
    isSpeaking = false;
    updateTtsButtons();
  }
}

function ttsSetup() {
  if (!synthSupported) return;
  const stored = sessionStorage.getItem('space-health-tts-enabled');
  if (stored !== null) ttsEnabled = stored === '1';
  $('tts-toggle').hidden = false;
  updateTtsButtons();

  $('tts-toggle').addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    sessionStorage.setItem('space-health-tts-enabled', ttsEnabled ? '1' : '0');
    if (!ttsEnabled) stopSpeaking();
    updateTtsButtons();
  });

  $('tts-speak').addEventListener('click', () => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      const text = $('response').textContent;
      if (text) speak(text);
    }
  });

  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = () => { updateTtsButtons(); };
  }
}
ttsSetup();
