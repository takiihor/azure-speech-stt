import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
sdk.Recognizer.enableTelemetry(false);
const $ = id => document.getElementById(id);
const storageKey = 'speech-notes:v1';
let sessions = [], currentId, recognizer, audioConfig, refreshTimer, clockTimer, recordingStart, busy = false, stopping = false;
const current = () => sessions.find(s => s.id === currentId);
const error = message => { $('error').textContent = message; $('error').hidden = !message; };
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (!Array.isArray(saved) || saved.some(s => !s || typeof s.id !== 'string' || typeof s.title !== 'string' || typeof s.language !== 'string' || !Array.isArray(s.segments) || !Number.isFinite(s.duration) || s.segments.some(p => !p || typeof p.text !== 'string' || !Number.isFinite(p.at)))) throw new Error();
  sessions = saved;
} catch { error('Saved sessions could not be loaded. Export any new transcript before closing this tab.'); }
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(sessions)); $('save-status').textContent = 'Auto-saved locally'; }
  catch { $('save-status').textContent = 'Storage unavailable — export to save'; error('Browser storage is unavailable or full. Download your transcript to keep a copy.'); }
}
function makeSession() {
  const session = {id: crypto.randomUUID(), title: 'Untitled session', created: new Date().toISOString(), language: $('language').value, duration: 0, segments: []};
  sessions.unshift(session); currentId = session.id; persist(); render();
}
function duration() {return (current()?.duration || 0) + (recordingStart ? (Date.now() - recordingStart) / 1000 : 0);}
function time(seconds) {const s = Math.floor(seconds); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;}
function text() { return current().segments.map(p => p.text).join('\n\n'); }
function wordCount(value) {return [...new Intl.Segmenter(undefined, {granularity:'word'}).segment(value)].filter(s => s.isWordLike).length;}
function renderHistory() {
  $('session-count').textContent = sessions.length;
  $('history').replaceChildren();
  if (!sessions.length) { const p = document.createElement('p'); p.className = 'no-sessions'; p.textContent = 'Your saved sessions will appear here.'; $('history').append(p); }
  for (const session of sessions) {
    const row = document.createElement('div'); row.className = `session-row ${session.id === currentId ? 'active' : ''}`;
    const open = document.createElement('button'); open.className = 'session-open'; open.disabled = busy;
    const title = document.createElement('strong'); title.textContent = session.title || 'Untitled session';
    const meta = document.createElement('small'); meta.textContent = `${new Date(session.created).toLocaleString()} · ${session.language} · ${session.segments.length} segments`;
    open.append(title, meta); open.onclick = () => { if (!busy) {currentId = session.id; render();} };
    const del = document.createElement('button'); del.className = 'delete'; del.textContent = 'Delete'; del.disabled = busy; del.setAttribute('aria-label', `Delete ${session.title}`);
    del.onclick = () => { if (busy || !confirm(`Delete “${session.title}”? This cannot be undone.`)) return; sessions = sessions.filter(s => s.id !== session.id); if (session.id === currentId) currentId = sessions[0]?.id; if (!currentId) makeSession(); else {persist(); render();} };
    row.append(open, del); $('history').append(row);
  }
}
function render() {
  const session = current(); if (!session) return;
  $('title').value = session.title; $('language').value = session.language;
  $('segments').replaceChildren();
  for (const segment of session.segments) {
    const row = document.createElement('div'); row.className = 'segment';
    const stamp = document.createElement('time'); stamp.textContent = time(segment.at);
    const content = document.createElement('p'); content.textContent = segment.text;
    row.append(stamp, content); $('segments').append(row);
  }
  $('empty').hidden = !!session.segments.length || !!$('interim').textContent;
  $('word-count').textContent = `${wordCount(text())} words · ${session.segments.length} segments`;
  for (const id of ['copy','download','json']) $(id).disabled = !session.segments.length;
  $('timer').textContent = time(duration()); renderHistory();
}
function setBusy(value) {
  busy = value; $('language').disabled = value; $('new').disabled = value;
  document.body.classList.toggle('recording', !!recordingStart);
  renderHistory();
}
async function token() {
  const response = await fetch('/api/token', {method:'POST'});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Azure authorization failed.');
  return data;
}
function cleanup(target) {
  if (target !== recognizer) return;
  clearTimeout(refreshTimer); clearInterval(clockTimer);
  if (recordingStart) current().duration += (Date.now() - recordingStart) / 1000;
  recordingStart = undefined;
  recognizer = undefined;
  try {target?.close();} catch {}
  try {audioConfig?.close();} catch {}
  audioConfig = undefined;
  $('interim').textContent = ''; $('status').textContent = 'Ready when you are';
  $('live-badge').textContent = 'DRAFT'; $('record').innerHTML = '<span>●</span> Start recording';
  $('record').disabled = false; stopping = false; setBusy(false); persist(); render();
}
function scheduleRefresh(target) {
  refreshTimer = setTimeout(async () => {
    try {const credentials = await token(); if (recognizer === target && !stopping) {target.authorizationToken = credentials.token; scheduleRefresh(target);} }
    catch (e) { if (recognizer === target && !stopping) {error(`${e.message} Recording has stopped; your transcript is saved.`); stop();} }
  }, 7 * 60 * 1000);
}
async function start() {
  if (busy) return;
  error('');
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return error('Microphone access requires localhost or HTTPS and a supported browser.');
  setBusy(true); $('record').disabled = true; $('status').textContent = 'Connecting to Azure…';
  let target;
  try {
    const credentials = await token();
    const config = sdk.SpeechConfig.fromAuthorizationToken(credentials.token, credentials.region);
    config.speechRecognitionLanguage = $('language').value;
    config.enableDictation();
    audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    target = new sdk.SpeechRecognizer(config, audioConfig); recognizer = target;
    const session = current(); session.language = $('language').value;
    target.recognizing = (_, event) => {
      if (recognizer !== target) return;
      $('interim').textContent = event.result.text; $('empty').hidden = !!event.result.text || !!session.segments.length;
    };
    target.recognized = (_, event) => {
      if (recognizer !== target || event.result.reason !== sdk.ResultReason.RecognizedSpeech || !event.result.text.trim()) return;
      session.segments.push({text:event.result.text, at:Math.max(0, duration() - event.result.duration / 10000000), capturedAt:new Date().toISOString()});
      $('interim').textContent = ''; persist(); render();
      const area = document.querySelector('.transcript-body'); area.scrollTop = area.scrollHeight;
    };
    target.canceled = (_, event) => {
      if (recognizer !== target) return;
      if (!stopping) error(event.reason === sdk.CancellationReason.Error ? 'Transcription was interrupted. Check microphone permission, network access, and Azure Speech credentials, then start again. Your completed text is saved.' : 'Azure ended this recording. Your completed text is saved; start again to continue.');
      cleanup(target);
    };
    target.sessionStopped = () => {
      if (recognizer !== target) return;
      if (!stopping) error('The speech session ended. Start again to continue in this transcript.');
      cleanup(target);
    };
    await new Promise((resolve,reject) => target.startContinuousRecognitionAsync(resolve,reject));
    if (recognizer !== target) return;
    recordingStart = Date.now(); $('status').textContent = 'Listening to your microphone';
    $('live-badge').textContent = '● LIVE'; $('record').textContent = '■ Stop recording'; $('record').disabled = false;
    document.body.classList.add('recording'); clockTimer = setInterval(() => { $('timer').textContent = time(duration()); }, 500);
    scheduleRefresh(target);
  } catch (e) {
    if (target && target !== recognizer) return;
    error(e instanceof Error ? e.message : 'Could not start recording. Check microphone permission and Azure configuration.');
    cleanup(target);
  }
}
function stop() {
  if (!recognizer || stopping) return;
  stopping = true; const target = recognizer;
  $('record').disabled = true; $('status').textContent = 'Finishing transcript…';
  target.stopContinuousRecognitionAsync(() => cleanup(target), () => {error('Recording stopped unexpectedly. Completed text has been saved.'); cleanup(target);});
}
$('record').onclick = () => recognizer ? stop() : start();
$('title').oninput = () => {current().title = $('title').value; persist(); renderHistory();};
$('language').onchange = () => {current().language = $('language').value; persist(); renderHistory();};
$('new').onclick = () => {if (!busy) makeSession();};
$('copy').onclick = async () => {try {await navigator.clipboard.writeText(text()); $('copy').textContent = 'Copied!'; setTimeout(() => $('copy').textContent = 'Copy text',1500);} catch {error('Clipboard access was denied. Download the transcript instead.');}};
function download(json = false) {
  const session = current(); const title = session.title || 'Untitled session';
  const body = json ? JSON.stringify({...session, duration:duration()},null,2) : `${title}\n${new Date(session.created).toLocaleString()} · ${session.language}\n\n${session.segments.map(p => `[${time(p.at)}] ${p.text}`).join('\n\n')}\n`;
  const url = URL.createObjectURL(new Blob([body], {type:json?'application/json;charset=utf-8':'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `${title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,80) || 'transcript'}.${json?'json':'txt'}`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
$('download').onclick = () => download(); $('json').onclick = () => download(true);
window.addEventListener('beforeunload', event => {if (busy) {event.preventDefault(); event.returnValue = '';}});
if (sessions.length) {currentId = sessions[0].id; render();} else makeSession();
