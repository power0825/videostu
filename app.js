// Everything the page does. No framework and no build step on purpose: the whole thing has to be
// readable and changeable by whoever teaches the class next.
//
// The page is organised as five stages, the same five the classroom studio uses, because the order
// is the lesson: a brief becomes four shots, the shots become frames, the frames become clips, and
// only then does anything get stitched together. Every stage renders from `state`, so any change
// anywhere just re-renders the current stage and nothing drifts out of sync.

const STORE = 'everknit-video-cloud';
const STAGES = ['Brief', 'Storyboard', 'Images', 'Clips', 'Edit & Export'];
const TOTAL_SHOTS = 4;

const RESOLUTIONS = ['480P', '720P', '1080P'];

const defaults = () => ({
  brief: '',
  reference: '',
  referenceSize: '',
  aspect: '16:9',
  // The size the video service renders each clip at. The final film is always 720p - the canvas is
  // fixed by the aspect ratio - so this only changes how much detail the clips carry.
  resolution: '720P',
  shots: [],
  brand: 'EVERKNIT',
  endLine: '',
  logoUrl: '',
  // The caption switch is stored as a string so the export can read it without a second convention.
  // It is converted back to a boolean at the moment the export is requested.
  subtitles: 'on',
  captionStyle: '',
  music: 'ambient',
  musicUrl: '',
  transition: 'cut',
  step: 0,
  selected: 0,
  exportUrl: '',
  code: '',
});

// Every shot carries the fields the later stages read. Landing on a save from an earlier version
// would otherwise produce a half-drawn page, so the shape is repaired on the way in.
const normaliseShot = (shot) => ({
  ...shot,
  firstFrameUrl: shot.firstFrameUrl || '',
  lastFrameUrl: shot.lastFrameUrl || '',
  clipUrl: shot.clipUrl || '',
  taskId: shot.taskId || '',
  statusText: shot.statusText || '',
  statusBad: !!shot.statusBad,
  trimStart: Number(shot.trimStart) || 0,
});

let state = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    return saved && typeof saved === 'object' ? { ...defaults(), ...saved } : defaults();
  } catch {
    return defaults();
  }
})();
// An earlier save may hold a boolean caption switch or a null reference. Fold both into the shapes
// the rest of the page assumes, so a returning student never lands on a half-broken screen.
if (typeof state.subtitles === 'boolean') state.subtitles = state.subtitles ? 'on' : 'off';
if (state.reference === null || state.reference === undefined) state.reference = '';
if (!Array.isArray(state.shots)) state.shots = [];
state.shots = state.shots.map(normaliseShot);
if (!RESOLUTIONS.includes(state.resolution)) state.resolution = '720P';
if (!['none', 'ambient', 'upload'].includes(state.music)) state.music = 'ambient';
if (state.music === 'upload' && !state.musicUrl) state.music = 'ambient';

let step = Math.max(0, Math.min(STAGES.length - 1, Number(state.step) || 0));
let selected = Math.max(0, Number(state.selected) || 0);
let busyLabel = '';

const $ = (id) => document.getElementById(id);
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...state, step, selected }));
  } catch {
    // A very large reference image can push past the storage quota. The work simply stops being
    // remembered; nothing else breaks, so this stays silent rather than interrupting the session.
  }
};
const esc = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const totalSeconds = () => state.shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0);

// ---------------------------------------------------------------- talking to the server

let gateShown = false;
function showGate(message) {
  $('gate').hidden = false;
  $('app').hidden = true;
  gateShown = true;
  if (message) $('gate-error').textContent = message;
}

function showApp() {
  $('gate').hidden = true;
  $('app').hidden = false;
  gateShown = false;
}

// The code rides in the body as well as in the header. A header can only carry ASCII bytes, so a
// code typed with a keyboard in full-width mode would be mangled on the way; a JSON body is UTF-8
// and delivers exactly what was typed. The server accepts either, and prefers the body.
async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-code': state.code || '' },
    body: JSON.stringify({ ...(body || {}), accessCode: state.code || '' }),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {}
  if (response.status === 401 && data && data.needsCode) {
    showGate('That class code was not right.');
    throw new Error('That class code was not right.');
  }
  if (!response.ok) throw new Error((data && data.error) || 'The request failed (' + response.status + ').');
  return data || {};
}

// ---------------------------------------------------------------- small helpers

// Notes live in an object rather than in the DOM, because a stage can be re-rendered at any moment
// (a clip finishing, a frame arriving) and a message that was written straight into a node would be
// thrown away by that re-render.
const notes = {};
function note(id, text, bad) {
  notes[id] = { text: text || '', bad: !!bad };
  paintNotes();
}
function paintNotes() {
  for (const [id, value] of Object.entries(notes)) {
    const el = $(id);
    if (!el) continue;
    el.textContent = value.text;
    el.classList.toggle('bad', value.bad);
  }
}

function setAlert(text, bad) {
  const el = $('alert');
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
  el.hidden = !text;
}

function setBusy(label) {
  busyLabel = label || '';
  $('busy').hidden = !busyLabel;
  $('busy-text').textContent = busyLabel;
  renderWork();
}

// Per-shot status lines are stored on the shot for the same reason as the notes: polling for a clip
// updates them long after the stage that shows them was built.
function setStatus(index, text, bad) {
  const shot = state.shots[index];
  if (!shot) return;
  shot.statusText = text || '';
  shot.statusBad = !!bad;
  save();
  const el = document.querySelector('[data-status="' + index + '"]');
  if (el) {
    el.textContent = shot.statusText;
    el.classList.toggle('bad', shot.statusBad);
  }
}

async function shrinkImage(file, max = 1600, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
}

// Chips carry their own key and value, so a stage can be rebuilt at any time without rebinding
// anything: one delegated listener handles every chip on the page.
const CHIP_SETS = {
  aspect: [
    { value: '16:9', label: 'Wide 16:9' },
    { value: '9:16', label: 'Vertical 9:16' },
    { value: '1:1', label: 'Square 1:1' },
  ],
  resolution: RESOLUTIONS.map((value) => ({ value, label: value })),
  music: [
    { value: 'ambient', label: 'Ambient bed' },
    { value: 'upload', label: 'Uploaded track' },
    { value: 'none', label: 'Silent' },
  ],
  transition: [{ value: 'cut', label: 'Clean cuts' }, { value: 'fade', label: 'Brief fade through black' }],
};

// The four caption looks, in the same order as the classroom studio, plus leaving it alone.
const CAPTION_STYLES = [
  { value: '', label: 'Studio default' },
  { value: 'fine', label: 'Clean white' },
  { value: 'box', label: 'Bar behind text' },
  { value: 'editorial', label: 'Uppercase, wide spacing' },
  { value: 'serif', label: 'Serif' },
];

const chipHtml = (key, current) => '<div class="chips">' + CHIP_SETS[key].map((option) =>
  '<button type="button" class="chip' + (option.value === current ? ' active' : '') +
  '" data-chip="' + key + '" data-value="' + esc(option.value) + '">' + esc(option.label) + '</button>').join('') + '</div>';

function pickChip(key, raw) {
  const option = (CHIP_SETS[key] || []).find((item) => String(item.value) === raw);
  if (!option) return;
  state[key] = option.value;
  save();
  render();
}

// ---------------------------------------------------------------- navigation

function goStep(next) {
  step = Math.max(0, Math.min(STAGES.length - 1, next));
  state.step = step;
  save();
  render();
}

function selectShot(index) {
  selected = Math.max(0, Math.min(Math.max(state.shots.length - 1, 0), index));
  state.selected = selected;
  save();
  // Clicking a shot in the timeline while still writing the brief should land somewhere useful
  // rather than leaving the click with no visible effect.
  if (step < 2) goStep(2);
  else render();
}

// ---------------------------------------------------------------- rendering

// Rebuilding a stage throws away focus, so whatever was being typed is noted first and put back
// afterwards. Without this, a clip finishing in the background would interrupt a sentence.
function focusedField() {
  const el = document.activeElement;
  if (!el || !el.dataset || el.dataset.field === undefined) return null;
  const info = { field: el.dataset.field, shot: el.dataset.shot === undefined ? null : el.dataset.shot };
  try {
    info.start = el.selectionStart;
    info.end = el.selectionEnd;
  } catch {}
  return info;
}

function restoreFocus(info) {
  if (!info) return;
  const selector = info.shot === null
    ? '[data-field="' + info.field + '"]:not([data-shot])'
    : '[data-shot="' + info.shot + '"][data-field="' + info.field + '"]';
  const el = $('work').querySelector(selector);
  if (!el) return;
  el.focus();
  try {
    el.setSelectionRange(info.start, info.end);
  } catch {}
}

function render() {
  const info = focusedField();
  renderSteps();
  paintHeader();
  renderWork();
  renderTimeline();
  renderPreview();
  paintNotes();
  restoreFocus(info);
}

function renderSteps() {
  $('steps').innerHTML = STAGES.map((name, index) =>
    '<button type="button" data-step="' + index + '"' + (index === step ? ' class="active" aria-current="step"' : '') + '>' +
    '<b>' + String(index + 1).padStart(2, '0') + '</b>' + esc(name) + '</button>').join('');
}

function paintHeader() {
  const ready = state.shots.filter((shot) => shot.clipUrl).length;
  $('plan-status').textContent = state.shots.length === TOTAL_SHOTS ? 'Four shots planned' : 'Not planned yet';
  $('clip-status').textContent = ready + ' of ' + TOTAL_SHOTS + ' clips ready';
}

function renderTimeline() {
  const total = totalSeconds();
  let time = 0;
  const rows = state.shots.map((shot, index) => {
    const start = time;
    time += Number(shot.duration) || 0;
    const label = shot.clipUrl ? '✓ Clip ready' : shot.taskId ? 'Rendering' : shot.firstFrameUrl ? 'Frame ready' : 'Not started';
    return '<button type="button" class="timeline-shot' + (index === selected ? ' active' : '') + '" data-shot="' + index + '">' +
      (shot.firstFrameUrl
        ? '<img src="' + esc(shot.firstFrameUrl) + '" alt="">'
        : '<span class="timeline-blank"></span>') +
      '<span><small>' + start + '–' + time + 's</small><strong>' + esc(shot.title || 'Shot ' + (index + 1)) + '</strong>' +
      '<small>' + esc(label) + '</small></span></button>';
  }).join('');
  $('timeline').innerHTML = rows || '<p class="subtle">The timeline fills up once the shots are planned.</p>';
  $('timeline-meta').textContent = total + 's · ' + state.shots.length + ' shots';
  $('timeline-audio').textContent = state.music === 'ambient' ? '♫ Ambient tones' : '♫ No soundtrack';
}

function renderPreview() {
  const shot = state.shots[selected];
  $('preview-title').textContent = step === 4 ? 'Final film' : 'Shot preview';
  $('preview-aspect').textContent = state.aspect;

  let body;
  if (step === 4 && state.exportUrl) {
    body = '<video class="clip-player" src="' + esc(state.exportUrl) + '" controls playsinline></video>';
  } else if (shot && shot.clipUrl && step >= 3) {
    body = '<video class="clip-player" src="' + esc(shot.clipUrl) + '" controls playsinline muted loop></video>';
  } else if (shot && shot.firstFrameUrl) {
    body = '<img src="' + esc(shot.firstFrameUrl) + '" alt="The first frame of the selected shot">';
  } else if (state.reference) {
    body = '<img src="' + esc(state.reference) + '" alt="The reference fabric you uploaded">' +
      '<p class="subtle">This is the reference photo, not a generated frame yet.</p>';
  } else {
    body = '<div class="frame-placeholder"><span>Add a reference photo, then make a frame, and it appears here.</span></div>';
  }
  $('preview-body').innerHTML = body;

  const link = $('preview-download');
  link.hidden = !state.exportUrl;
  if (state.exportUrl) link.href = state.exportUrl;
}

function emptyStage() {
  return '<section class="panel video-empty"><h2>Plan the shots first.</h2>' +
    '<p>Step 01 turns the brief into four shots. Everything after that is built on top of them.</p>' +
    '<button class="primary" type="button" data-act="step" data-step="0">Back to the brief</button></section>';
}

function storyRow(shot, index) {
  const start = state.shots.slice(0, index).reduce((sum, item) => sum + (Number(item.duration) || 0), 0);
  const end = start + (Number(shot.duration) || 0);
  return '<div class="story-row">' +
    '<span class="shot-number">' + String(index + 1).padStart(2, '0') + '<small>' + start + '–' + end + 's</small></span>' +
    '<div>' +
    '<label class="field"><span>Shot title</span><input data-shot="' + index + '" data-field="title" maxlength="120" value="' + esc(shot.title) + '"></label>' +
    '<label class="field"><span>Scene, subject motion &amp; camera</span><textarea rows="3" data-shot="' + index + '" data-field="script">' + esc(shot.script) + '</textarea></label>' +
    '<label class="field"><span>Caption (optional)</span><input data-shot="' + index + '" data-field="caption" maxlength="120" value="' + esc(shot.caption) + '"></label>' +
    '</div></div>';
}

function shotTabs() {
  return '<div class="shot-tabs">' + state.shots.map((shot, index) => {
    const mark = shot.clipUrl ? '✓ clip ready' : shot.firstFrameUrl ? 'frame ready' : 'not started';
    return '<button type="button" class="' + (index === selected ? 'active' : '') + '" data-act="select" data-shot="' + index + '">' +
      String(index + 1).padStart(2, '0') + ' ' + esc(shot.title || 'Shot') + '<small>' + mark + '</small></button>';
  }).join('') + '</div>';
}

// One of the two frames a shot can be driven from. The classroom studio offers both: the first
// frame is required, the second is optional and pins where the movement has to arrive.
function frameCard(index, which) {
  const shot = state.shots[index];
  const last = which === 'last';
  const url = last ? shot.lastFrameUrl : shot.firstFrameUrl;
  const prompt = (last ? shot.lastImagePrompt : shot.imagePrompt) || '';
  const frozen = !!busyLabel;
  const disabled = frozen ? ' disabled' : '';
  const media = url
    ? '<img class="frame-image" src="' + esc(url) + '" alt="The ' + which + ' frame">'
    : '<div class="frame-placeholder"><span>' +
      (last ? 'Optional. Pins the frame the movement has to arrive on.' : 'The starting composition. Nothing drawn yet.') +
      '</span></div>';
  return '<div class="frame-card">' +
    '<h3>' + (last ? 'Last frame · optional' : 'First frame · required') + '</h3>' + media +
    '<div class="frame-actions">' +
    '<button class="primary small" type="button" data-act="frame" data-frame="' + which + '" data-shot="' + index + '"' +
    (frozen || !String(prompt).trim() ? ' disabled' : '') + '>' + (url ? 'Draw it again' : 'Generate frame') + '</button>' +
    '<label class="button secondary small upload-label">Upload<input type="file" data-upload="' + which + '" data-shot="' + index +
    '" accept="image/png,image/jpeg,image/webp" hidden' + (frozen ? ' disabled' : '') + '></label>' +
    (url ? '<button class="secondary small" type="button" data-act="clear-frame" data-frame="' + which + '" data-shot="' + index + '"' + disabled + '>Clear</button>' : '') +
    '</div>' +
    '<label class="field"><span>' + (last ? 'End frame prompt' : 'Frame prompt') + '</span>' +
    '<textarea rows="5" data-shot="' + index + '" data-field="' + (last ? 'lastImagePrompt' : 'imagePrompt') + '">' + esc(prompt) + '</textarea>' +
    '<small>' + (last
      ? 'Drives the second frame. Leave it empty and the clip is generated from the first frame alone.'
      : 'Sent to the image model together with the reference photo above.') + '</small></label>' +
    '</div>';
}

function renderWork() {
  const host = $('work');
  const frozen = !!busyLabel;
  const dis = frozen ? ' disabled' : '';
  const shot = state.shots[selected];
  const planned = state.shots.length === TOTAL_SHOTS;

  if (step === 0) {
    const reference = state.reference
      ? '<div class="reference"><img src="' + esc(state.reference) + '" alt="The reference fabric you uploaded"><span>' +
        esc(state.referenceSize ? state.referenceSize + ' after shrinking' : 'Ready') + '</span></div>'
      : '<div class="reference"><span>No reference photo yet. The shots are drawn from it, so add one before planning.</span></div>';

    host.innerHTML = '<section class="panel">' +
      '<div class="panel-head"><h2>What is your film about?</h2><span class="tag">YOUR SKILL + CREATIVE BRIEF</span></div>' +
      '<label class="field"><span>Product, audience, core message &amp; visual direction</span>' +
      '<textarea rows="6" maxlength="4000" data-field="brief">' + esc(state.brief) + '</textarea>' +
      '<small>Name the fabric, the garment it becomes, the setting and anything that must stay true. The four shots are planned from this and nothing else.</small></label>' +
      '<div class="two-fields">' +
      '<div class="field"><span>Reference image</span>' +
      '<label class="button secondary small upload-label">Upload a photo<input type="file" data-upload="reference" accept="image/png,image/jpeg,image/webp" hidden' + dis + '></label>' +
      '<small>A photograph of the fabric. It is shrunk in your browser to 1600px before it is sent.</small></div>' +
      '<div class="field"><span>Aspect ratio</span>' + chipHtml('aspect', state.aspect) + '</div>' +
      '</div>' +
      '<div class="field"><span>Clip resolution</span>' + chipHtml('resolution', state.resolution) +
      '<small>How much detail the video service renders each clip at. The finished film is always 720p; a higher setting costs more per clip.</small></div>' + reference +
      '<div class="actions">' +
      '<button class="primary" type="button" data-act="plan"' + dis + '>Plan the four shots</button>' +
      '<button class="secondary" type="button" data-act="step" data-step="1"' + (planned ? '' : ' disabled') + '>Use current plan →</button>' +
      '<span class="note" id="plan-note"></span></div>' +
      '<details class="reveal"><summary>What the model is told</summary>' +
      '<p class="reveal-note">This is the whole instruction the planning model receives, agent rules and method included. Nothing is hidden, and changing it changes every film the class makes.</p>' +
      '<pre id="storyboard-prompt">Loading…</pre></details></section>';
    return;
  }

  if (step === 1) {
    if (!planned) { host.innerHTML = emptyStage(); return; }
    host.innerHTML = '<section class="panel">' +
      '<div class="panel-head"><h2>Review the story</h2><span class="tag">' + totalSeconds() + ' SECONDS · ' + state.shots.length + ' SHOTS</span></div>' +
      '<p class="helper">One main action per shot. Edit the words here; the frame prompt and the motion prompt on the next two steps are built on top of them.</p>' +
      state.shots.map(storyRow).join('') +
      '<div class="actions"><button class="primary" type="button" data-act="step" data-step="2"' + dis + '>Confirm storyboard →</button>' +
      '<span class="note">The running order and the timing come from the plan. Regenerating at step 01 replaces the shots.</span></div></section>';
    return;
  }

  if (step === 2) {
    if (!planned) { host.innerHTML = emptyStage(); return; }
    host.innerHTML = shotTabs() + '<section class="panel">' +
      '<div class="panel-head"><h2>' + esc(shot.title) + '</h2><span class="tag">' + shot.duration + 's · ' + esc(state.aspect) + '</span></div>' +
      '<p class="helper">' + esc(shot.script) + '</p>' +
      '<div class="reference-strip"><span>Shared product reference</span>' +
      (state.reference ? '<img src="' + esc(state.reference) + '" alt="">' : '<em>none yet</em>') +
      '<label class="button secondary small upload-label">Replace<input type="file" data-upload="reference" accept="image/png,image/jpeg,image/webp" hidden' + dis + '></label></div>' +
      '<div class="frame-grid">' + frameCard(selected, 'first') + frameCard(selected, 'last') + '</div>' +
      '<div class="actions"><span class="shot-status" data-status="' + selected + '">' + esc(shot.statusText) + '</span></div>' +
      '</section>';
    paintStatusClass();
    return;
  }

  if (step === 3) {
    if (!planned) { host.innerHTML = emptyStage(); return; }
    const media = shot.clipUrl
      ? '<video class="clip-player" src="' + esc(shot.clipUrl) + '" controls playsinline muted loop></video>'
      : shot.firstFrameUrl
        ? '<img class="frame-image" src="' + esc(shot.firstFrameUrl) + '" alt="The frame this clip is generated from">'
        : '<div class="frame-placeholder"><span>A clip is generated from a frame. Make the frame first.</span></div>';
    const label = shot.clipUrl ? 'Generate a new clip' : shot.taskId ? 'Check the status' : 'Generate the clip';
    // The same strip the classroom studio shows: what the model is being asked to move, and at
    // which resolution, before anything is spent.
    const strip = '<div class="clip-reference-strip">' +
      (shot.firstFrameUrl ? '<img src="' + esc(shot.firstFrameUrl) + '" alt="First frame">' : '<em>no first frame yet</em>') +
      (shot.lastFrameUrl ? '<span class="arrow">→</span><img src="' + esc(shot.lastFrameUrl) + '" alt="Last frame">' : '') +
      '<span class="strip-label">' + (shot.lastFrameUrl ? 'First + last frame' : 'First frame only') +
      '<small>Wan 3.0 · ' + esc(state.resolution) + '</small></span></div>';
    host.innerHTML = shotTabs() + '<section class="panel">' +
      '<div class="panel-head"><h2>' + esc(shot.title) + '</h2><span class="tag">' + shot.duration + 's · ' + esc(state.aspect) + '</span></div>' +
      '<p class="helper">' + esc(shot.script) + '</p>' + strip +
      '<div class="clip-grid"><div class="clip-media">' + media + '</div><div>' +
      '<label class="field"><span>Motion &amp; camera prompt</span><textarea rows="6" data-shot="' + selected + '" data-field="videoPrompt">' + esc(shot.videoPrompt) + '</textarea>' +
      '<small>Describes how the frame moves. Generated clips take one to three minutes.</small></label>' +
      '<div class="actions"><button class="primary" type="button" data-act="clip" data-shot="' + selected + '"' +
      (frozen || !shot.firstFrameUrl ? ' disabled' : '') + '>' + label + '</button>' +
      '<button class="secondary" type="button" data-act="motion" data-shot="' + selected + '"' + dis + '>Rewrite the motion prompt</button>' +
      '<span class="shot-status" data-status="' + selected + '">' + esc(shot.statusText) + '</span></div>' +
      '</div></div></section>';
    paintStatusClass();
    return;
  }

  if (!planned) { host.innerHTML = emptyStage(); return; }
  const ready = state.shots.filter((item) => item.clipUrl).length;
  const captions = state.shots.map((item, index) =>
    '<li><b>' + String(index + 1).padStart(2, '0') + '</b>' +
    (item.caption ? esc(item.caption) : '<em>no caption</em>') + '</li>').join('');
  const result = state.exportUrl
    ? '<div class="result"><video src="' + esc(state.exportUrl) + '" controls playsinline></video>' +
      '<a class="button primary" href="' + esc(state.exportUrl) + '" download>Download the film</a></div>'
    : '';

  const trimList = '<div class="trim-list">' + state.shots.map((item, index) =>
    '<div><span><strong>' + (index + 1) + '. ' + esc(item.title) + '</strong>' +
    '<small>' + item.duration + 's · ' + esc(item.clipUrl ? 'clip ready' : 'not started') + '</small></span>' +
    '<label>Trim start (seconds)<input type="number" min="0" max="120" step="0.1" data-field="trimStart" data-number="1" data-shot="' + index +
    '" value="' + Number(item.trimStart || 0) + '"' + dis + '></label>' +
    (item.clipUrl ? '<a class="icon-link" href="' + esc(item.clipUrl) + '" download>Download clip</a>' : '') +
    '</div>').join('') + '</div>';

  const musicField = chipHtml('music', state.music) +
    '<div class="actions">' +
    '<label class="button secondary small upload-label">Upload MP3 / WAV<input type="file" data-upload="music" accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a" hidden' + dis + '></label>' +
    (state.musicUrl ? '<audio controls src="' + esc(state.musicUrl) + '"></audio>' : '') +
    '<span class="note">' + (state.music === 'upload' && !state.musicUrl
      ? 'Upload a track to use this option. Keep it under 3MB — anything larger cannot pass through a serverless function.'
      : '') + '</span></div>';

  const logoField = '<div class="actions">' +
    '<label class="button secondary small upload-label">Upload logo<input type="file" data-upload="logo" accept="image/png,image/jpeg,image/webp" hidden' + dis + '></label>' +
    (state.logoUrl
      ? '<img class="logo-thumb" src="' + esc(state.logoUrl) + '" alt="The end logo"><button class="secondary small" type="button" data-act="clear-logo"' + dis + '>Remove logo</button>'
      : '<span class="note">A PNG with transparency sits best over the ending.</span>') +
    '</div>';

  host.innerHTML = '<section class="panel">' +
    '<div class="panel-head"><h2>Make the final cut.</h2><span class="tag">720P MP4 · ' + totalSeconds() + 's</span></div>' +
    '<p class="helper">Everything on this step happens on the server in FFmpeg. Stitching again never costs model credits, so try the caption styles and the trims until the cut is right.</p>' +

    '<div class="cut-step"><div class="cut-step-head"><b>1</b><div><h3>Trim each clip</h3>' +
    '<p class="cut-note">Trim start skips the opening seconds of a clip so the action begins right away. 0 keeps the clip as generated, and the slot keeps its length either way.</p></div></div>' +
    trimList + '</div>' +

    '<div class="cut-step"><div class="cut-step-head"><b>2</b><div><h3>Join them and add sound</h3>' +
    '<p class="cut-note">Clips are fitted to the canvas and joined in order. A clip shorter than its slot holds its final frame.</p></div></div>' +
    '<div class="two-fields"><div class="field"><span>Between shots</span>' + chipHtml('transition', state.transition) + '</div>' +
    '<div class="field"><span>Soundtrack</span>' + musicField + '</div></div></div>' +

    '<div class="cut-step"><div class="cut-step-head"><b>3</b><div><h3>Close with your brand</h3>' +
    '<p class="cut-note">The logo and these two lines appear over the final two seconds.</p></div></div>' +
    logoField +
    '<div class="two-fields">' +
    '<label class="field"><span>Brand at the ending</span><input data-field="brand" maxlength="60" value="' + esc(state.brand) + '"' + dis + '></label>' +
    '<label class="field"><span>Ending message</span><input data-field="endLine" maxlength="120" placeholder="Explore our pique collection." value="' + esc(state.endLine) + '"' + dis + '></label>' +
    '</div></div>' +

    '<div class="cut-step"><div class="cut-step-head"><b>4</b><div><h3>Style the captions</h3>' +
    '<p class="cut-note">Captions come from each shot&rsquo;s caption line. The style also applies to the brand ending. Edit the words themselves at step 02.</p></div></div>' +
    '<div class="two-fields">' +
    '<div class="field"><label class="checkbox-label"><input type="checkbox" data-toggle="subtitles"' +
    (state.subtitles === 'on' ? ' checked' : '') + (frozen ? ' disabled' : '') + '>Include shot captions</label></div>' +
    '<label class="field"><span>Caption style</span><select data-select="captionStyle"' + dis + '>' +
    CAPTION_STYLES.map((option) => '<option value="' + esc(option.value) + '"' +
      (option.value === state.captionStyle ? ' selected' : '') + '>' + esc(option.label) + '</option>').join('') +
    '</select></label></div>' +
    '<ul class="caption-list">' + captions + '</ul></div>' +

    '<div class="actions"><button class="primary" type="button" data-act="export"' + (frozen || ready !== TOTAL_SHOTS ? ' disabled' : '') + '>Assemble &amp; export MP4</button>' +
    '<span class="note" id="export-note"></span></div>' + result + '</section>';
}

// The status text is written by setStatus() while a stage is live, so the CSS class it carries has
// to be re-applied here after a rebuild.
function paintStatusClass() {
  const shot = state.shots[selected];
  const el = document.querySelector('[data-status="' + selected + '"]');
  if (el && shot) el.classList.toggle('bad', !!shot.statusBad);
}

// ---------------------------------------------------------------- actions

const MAX_UPLOAD_BYTES = 3_000_000;

function readAsDataUrl(file) {
  return new Promise((ok, no) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result || ''));
    reader.onerror = () => no(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

// One handler for every file the class can bring in: the reference photo, either frame, an end
// logo, and a music bed. Images are shrunk in the browser first, which is what keeps them inside
// both the 4.5MB request limit and the 3MB the upload route accepts.
async function pickUpload(input) {
  const kind = input.dataset.upload;
  const index = input.dataset.shot === undefined ? null : Number(input.dataset.shot);
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  setAlert('');

  try {
    if (kind === 'reference') {
      setAlert('Shrinking the photo…');
      const shrunk = await shrinkImage(file);
      state.reference = shrunk.dataUrl;
      state.referenceSize = shrunk.width + '×' + shrunk.height;
      save();
      render();
      setAlert('Reference is ' + state.referenceSize + '. Ready to plan.');
      return;
    }

    setBusy('Uploading…');
    let dataUrl;
    if (kind === 'music') {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error('That track is ' + (file.size / 1024 / 1024).toFixed(1) +
          'MB. Keep it under 3MB — a serverless function cannot accept more than that in one request.');
      }
      dataUrl = await readAsDataUrl(file);
    } else {
      // 0.9 rather than the default: a frame is the thing the clip is generated from, so it is
      // worth keeping more of the detail than a reference photo needs.
      const shrunk = await shrinkImage(file, 1600, 0.9);
      dataUrl = shrunk.dataUrl;
    }

    const uploadKind = kind === 'music' ? 'music' : kind === 'logo' ? 'logo' : 'frame';
    const { url } = await api('/api/asset', { kind: uploadKind, dataUrl });
    if (kind === 'logo') state.logoUrl = url;
    else if (kind === 'music') { state.musicUrl = url; state.music = 'upload'; }
    else if (index !== null) state.shots[index][kind === 'last' ? 'lastFrameUrl' : 'firstFrameUrl'] = url;
    save();
    setBusy('');
    render();
    setAlert(kind === 'music'
      ? 'Track uploaded and selected. It is looped to cover the whole film.'
      : kind === 'logo' ? 'Logo uploaded. It sits on the final two seconds.'
        : 'Frame uploaded.');
  } catch (error) {
    setBusy('');
    setAlert(error.message, true);
  }
}

function clearFrame(index, which) {
  const shot = state.shots[index];
  if (!shot) return;
  if (which === 'last') shot.lastFrameUrl = '';
  else shot.firstFrameUrl = '';
  save();
  render();
}

async function plan() {
  if (!state.reference) return note('plan-note', 'Add a reference photo of the fabric first.', true);
  if (state.brief.trim().length < 20) return note('plan-note', 'Write a little more about the film first.', true);
  setAlert('');
  setBusy('Planning the shots…');
  note('plan-note', 'Planning the shots…');
  try {
    const { shots } = await api('/api/storyboard', { brief: state.brief.trim() });
    state.shots = shots.map((shot) => normaliseShot(shot));
    state.exportUrl = '';
    selected = 0;
    save();
    setBusy('');
    goStep(1);
    note('plan-note', 'Planned. Read the four shots, edit anything you disagree with, then make the frames.');
  } catch (error) {
    note('plan-note', error.message, true);
    setBusy('');
  }
}

async function makeFrame(index, which = 'first') {
  const shot = state.shots[index];
  if (!shot) return;
  const last = which === 'last';
  const prompt = String((last ? shot.lastImagePrompt : shot.imagePrompt) || '').trim();
  if (!prompt) return setStatus(index, 'Write a ' + (last ? 'end frame' : 'frame') + ' prompt first.', true);
  setAlert('');
  setBusy(last ? 'Drawing the end frame…' : 'Drawing the frame…');
  setStatus(index, last ? 'Drawing the end frame…' : 'Drawing the frame…');
  try {
    const { url } = await api('/api/keyframe', {
      prompt,
      referenceDataUrl: state.reference,
      aspect: state.aspect,
    });
    if (last) shot.lastFrameUrl = url;
    else shot.firstFrameUrl = url;
    save();
    setBusy('');
    setStatus(index, last ? 'End frame ready.' : 'Frame ready. Move to step 04 to set it in motion.', false);
    render();
  } catch (error) {
    setBusy('');
    setStatus(index, error.message, true);
  }
}

// Rewrites this shot's motion prompt from its script and frame prompts. Text in, text out: the
// frames are already described, and keeping the model away from the image is what keeps the
// fabric, light and colour consistent across the four clips.
async function rewriteMotion(index) {
  const shot = state.shots[index];
  if (!shot) return;
  setAlert('');
  setBusy('Rewriting the motion prompt…');
  setStatus(index, 'Rewriting the motion prompt…');
  try {
    const { prompt } = await api('/api/motion', {
      script: shot.script,
      imagePrompt: shot.imagePrompt,
      current: shot.videoPrompt,
    });
    shot.videoPrompt = prompt;
    save();
    setBusy('');
    setStatus(index, 'Motion prompt rewritten. Read it before generating — it is a draft, not an order.', false);
    render();
  } catch (error) {
    setBusy('');
    setStatus(index, error.message, true);
  }
}

async function makeClip(index) {
  const shot = state.shots[index];
  if (!shot) return;
  if (!shot.firstFrameUrl) return setStatus(index, 'Make the frame first.', true);
  // Pressing the button again while a job is already out there should check on it, not queue a
  // second render and spend credits twice.
  if (shot.taskId && !shot.clipUrl) return pollClip(index);
  setAlert('');
  setStatus(index, 'Sending to the video service…');
  try {
    const { taskId } = await api('/api/clip', {
      prompt: String(shot.videoPrompt || '').trim(),
      firstFrameUrl: shot.firstFrameUrl,
      lastFrameUrl: shot.lastFrameUrl || '',
      duration: shot.duration,
      aspect: state.aspect,
      resolution: state.resolution,
    });
    shot.taskId = taskId;
    shot.clipUrl = '';
    save();
    setStatus(index, 'Queued…');
    pollClip(index);
  } catch (error) {
    setStatus(index, error.message, true);
  }
}

async function pollClip(index) {
  const shot = state.shots[index];
  if (!shot || !shot.taskId || shot.clipUrl) return;
  try {
    const result = await api('/api/clip-status', { taskId: shot.taskId });
    if (result.status === 'succeeded') {
      shot.clipUrl = result.url;
      shot.taskId = '';
      save();
      setStatus(index, 'Clip ready.', false);
      render();
      return;
    }
    if (result.status === 'failed') {
      shot.taskId = '';
      save();
      setStatus(index, result.message || 'That clip failed.', true);
      render();
      return;
    }
    setStatus(index, result.status === 'running' ? 'Rendering the clip…' : 'Waiting in the queue…');
    renderTimeline();
    setTimeout(() => pollClip(index), 8000);
  } catch (error) {
    setStatus(index, error.message, true);
  }
}

async function exportFilm() {
  const shots = state.shots.map((shot) => ({
    clipUrl: shot.clipUrl,
    duration: shot.duration,
    trimStart: Number(shot.trimStart) || 0,
    caption: shot.caption,
  }));
  if (shots.some((shot) => !shot.clipUrl)) return note('export-note', 'All four clips have to be ready first.', true);
  if (state.music === 'upload' && !state.musicUrl) {
    return note('export-note', 'Upload a track first, or switch the soundtrack off.', true);
  }

  const started = Date.now();
  setBusy('Stitching the film…');
  const ticker = setInterval(() => {
    note('export-note', 'Stitching… ' + Math.round((Date.now() - started) / 1000) + 's. Keep this tab open, it can take a minute or two.', false);
  }, 1000);
  note('export-note', 'Stitching… Keep this tab open, it can take a minute or two.');

  try {
    const result = await api('/api/export', {
      shots,
      aspect: state.aspect,
      subtitles: state.subtitles === 'on',
      captionStyle: state.captionStyle,
      music: state.music,
      musicUrl: state.musicUrl,
      transition: state.transition,
      brand: state.brand,
      endLine: state.endLine,
      logoUrl: state.logoUrl,
    });
    clearInterval(ticker);
    state.exportUrl = result.url;
    save();
    setBusy('');
    render();
    note('export-note', 'Done in ' + Math.round((Date.now() - started) / 1000) + 's · ' +
      Math.round(result.bytes / 1024 / 1024 * 10) / 10 + ' MB · ' + result.seconds + ' seconds of film.');
  } catch (error) {
    clearInterval(ticker);
    setBusy('');
    note('export-note', error.message, true);
  }
}

function reset() {
  if (!confirm('Clear this film and start over? The clips stay in storage but this page forgets them.')) return;
  const code = state.code;
  state = { ...defaults(), code };
  step = 0;
  selected = 0;
  for (const key of Object.keys(notes)) delete notes[key];
  save();
  setAlert('');
  render();
}

// ---------------------------------------------------------------- wiring
//
// Everything inside the work area is handled by delegation, because the area is rebuilt on almost
// every change. A listener attached to a button would be thrown away with the button.

$('work').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-chip]');
  if (chip) return pickChip(chip.dataset.chip, chip.dataset.value);
  const button = event.target.closest('[data-act]');
  if (!button || button.disabled) return;
  const index = button.dataset.shot === undefined ? null : Number(button.dataset.shot);
  switch (button.dataset.act) {
    case 'step': goStep(Number(button.dataset.step)); break;
    case 'select': selectShot(index); break;
    case 'plan': plan(); break;
    case 'frame': makeFrame(index, button.dataset.frame || 'first'); break;
    case 'clear-frame': clearFrame(index, button.dataset.frame || 'first'); break;
    case 'motion': rewriteMotion(index); break;
    case 'clip': makeClip(index); break;
    case 'clear-logo': state.logoUrl = ''; save(); render(); break;
    case 'export': exportFilm(); break;
  }
});

// A number field keeps a numeric twin in state while the box itself is left holding exactly what
// was typed, so "1." or a temporarily empty box never snaps back to 0 under the cursor.
$('work').addEventListener('input', (event) => {
  const el = event.target.closest('[data-field]');
  if (!el) return;
  const field = el.dataset.field;
  const value = el.dataset.number === undefined ? el.value : Number(el.value) || 0;
  if (el.dataset.shot === undefined) state[field] = value;
  else {
    const shot = state.shots[Number(el.dataset.shot)];
    if (shot) shot[field] = value;
  }
  save();
});

$('work').addEventListener('change', (event) => {
  const file = event.target.closest('[data-upload]');
  if (file) return pickUpload(file);

  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    state[toggle.dataset.toggle] = toggle.checked ? 'on' : 'off';
    save();
    render();
    return;
  }

  const select = event.target.closest('[data-select]');
  if (select) {
    state[select.dataset.select] = select.value;
    save();
    render();
    return;
  }

  // A number box that just lost focus: put the clamped value back so the text matches the state.
  const number = event.target.closest('[data-number]');
  if (number) {
    const shot = state.shots[Number(number.dataset.shot)];
    if (shot) number.value = String(Number(shot[number.dataset.field]) || 0);
  }
});

$('steps').addEventListener('click', (event) => {
  const button = event.target.closest('[data-step]');
  if (button) goStep(Number(button.dataset.step));
});

$('timeline').addEventListener('click', (event) => {
  const button = event.target.closest('[data-shot]');
  if (button) selectShot(Number(button.dataset.shot));
});

$('reset').addEventListener('click', reset);

// Asks the server whether a class code is expected at all, and picks up the prompt text in the
// same round trip. If ACCESS_CODE has not been configured there is no lock on the door, so the
// studio opens straight away rather than asking for a code that would accept anything.
async function boot() {
  let response;
  try {
    response = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-code': state.code || '' },
      body: JSON.stringify({ accessCode: state.code || '' }),
    });
  } catch {
    showGate('The studio could not be reached. Check the connection and try again.');
    return;
  }
  if (response.status === 401) {
    let data = null;
    try {
      data = await response.json();
    } catch {}
    // Only call it a wrong code when a code was actually offered. On a first visit the field is
    // simply empty, and telling someone their code is wrong before they have typed one is a lie
    // that sends them looking for a problem that is not there.
    const attempted = String(state.code || '').length > 0;
    showGate(attempted && data && data.needsCode ? 'That class code was not right.' : '');
    return;
  }
  if (!response.ok) {
    showGate('The studio is not ready yet. Try again in a moment.');
    return;
  }
  try {
    const data = await response.json();
    const prompt = $('storyboard-prompt');
    if (prompt && data.system) prompt.textContent = data.system;
  } catch {}
  showApp();
}

// Asks the server why a code was turned away. The reply describes the lengths of the two values
// and a few things that go wrong when a value is pasted into a hosting dashboard - never the
// values themselves, so this stays safe to run in front of the class.
//
// The length is the useful part. When the door refuses a code that looks right, the usual cause is
// that the browser sent something other than what the person typed: a saved password filled in by
// the browser's password manager, or a stray character picked up along the way. Comparing the two
// counts says which of those it is, without either value ever being printed.
async function explainRejection(code) {
  try {
    const response = await fetch('/api/access-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-code': code || '' },
      body: JSON.stringify({ accessCode: code || '' }),
    });
    if (!response.ok) return '';
    const data = await response.json();
    const seen = 'the page sent ' + data.received.characters + ' characters, the saved code has '
      + data.stored.characters + (data.receivedLooksFullWidth ? ', and the text that arrived was not plain ASCII' : '')
      + ' — serving from ' + data.deployment.environment;
    return (data.hint ? data.hint + '  ' : '') + '(' + seen + ')';
  } catch {
    return '';
  }
}

$('gate-check').addEventListener('click', async () => {
  const detail = $('gate-detail');
  detail.textContent = 'Checking…';
  detail.textContent = (await explainRejection($('gate-code').value.trim()))
    || 'The studio could not be reached to check. Reload the page and try again.';
});

$('gate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = $('gate-code').value.trim();
  if (!code) return;
  state.code = code;
  save();
  await boot();
  if (!gateShown) return;
  // Refused. Explain it straight away rather than waiting to be asked. The field is left as it is
  // and selected, so the text that was actually sent stays visible - seeing it is how a full-width
  // character or a stray space gets noticed, and hiding it is what made those invisible.
  const explanation = await explainRejection(code);
  if (explanation) $('gate-detail').textContent = explanation;
  $('gate-code').focus();
  $('gate-code').select();
});

// A render that throws leaves the previous stage on screen, which looks exactly like the page
// ignoring a click. Surfacing it turns a silent freeze into something a person can act on.
window.addEventListener('error', (event) => {
  setAlert('The page hit an unexpected error: ' + (event.message || 'unknown') + '. Reload to recover.', true);
});

render();
boot();
