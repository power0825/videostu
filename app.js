// Everything the page does. No framework and no build step on purpose: the whole thing has to be
// readable and changeable by whoever teaches the class next.

const STORE = 'everknit-video-cloud';

const defaults = () => ({
  brief: '',
  reference: null,
  aspect: '16:9',
  shots: [],
  brand: 'EVERKNIT',
  endLine: '',
  subtitles: true,
  music: 'ambient',
  transition: 'cut',
  code: '',
});

let state = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    return saved && typeof saved === 'object' ? { ...defaults(), ...saved } : defaults();
  } catch {
    return defaults();
  }
})();

const $ = (id) => document.getElementById(id);
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // A very large reference image can push past the storage quota. The work simply stops being
    // remembered; nothing else breaks, so this stays silent rather than interrupting the session.
  }
};

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

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-code': state.code || '' },
    body: JSON.stringify(body || {}),
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

const note = (id, text, bad) => {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
};

function busy(buttonId, working, noteId, message) {
  const button = $(buttonId);
  button.disabled = working;
  button.classList.toggle('working', working);
  if (noteId) note(noteId, working ? message : '', false);
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

function chips(containerId, options, current, onPick) {
  const host = $(containerId);
  host.innerHTML = '';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.label;
    button.className = option.value === current ? 'chip active' : 'chip';
    button.addEventListener('click', () => {
      onPick(option.value);
      save();
      chips(containerId, options, option.value, onPick);
    });
    host.appendChild(button);
  }
}

// ---------------------------------------------------------------- step 1: the brief

function renderBrief() {
  $('brief').value = state.brief;
  $('brand').value = state.brand;
  $('endline').value = state.endLine;
  if (state.reference) {
    $('reference-preview').hidden = false;
    $('reference-img').src = state.reference;
    $('reference-size').textContent = Math.round(state.reference.length / 1400) + ' KB after shrinking';
  } else {
    $('reference-preview').hidden = true;
  }
  const ready = state.shots.length === 4;
  $('brief-status').textContent = ready ? 'Four shots planned' : 'Not planned yet';
  $('shots-panel').hidden = !ready;
  $('film-panel').hidden = !ready;
}

async function plan() {
  if (!state.reference) return note('plan-note', 'Add a reference photo of the fabric first.', true);
  if (state.brief.trim().length < 20) return note('plan-note', 'Write a little more about the film first.', true);
  busy('plan', true, 'plan-note', 'Planning the shots…');
  try {
    const { shots } = await api('/api/storyboard', { brief: state.brief.trim() });
    state.shots = shots.map((shot) => ({ ...shot, firstFrameUrl: '', clipUrl: '', taskId: '', status: '' }));
    save();
    renderBrief();
    renderShots();
    note('plan-note', 'Planned. Read the four shots, edit anything you disagree with, then make the frames.');
  } catch (error) {
    note('plan-note', error.message, true);
  } finally {
    busy('plan', false);
  }
}

// ---------------------------------------------------------------- step 2: the shots

function shotStatus(index, text, bad) {
  const el = document.querySelector('[data-status="' + index + '"]');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad);
}

function refreshShotCount() {
  const ready = state.shots.filter((shot) => shot.clipUrl).length;
  $('shots-status').textContent = ready + ' of 4 clips ready';
}

function renderShots() {
  const host = $('shots');
  host.innerHTML = '';
  state.shots.forEach((shot, index) => {
    const card = document.createElement('article');
    card.className = 'shot';
    card.innerHTML =
      '<div class="shot-head"><span class="shot-number">' + (index + 1) + '</span>' +
      '<span class="shot-title"></span><span class="shot-seconds">' + shot.duration + 's</span></div>' +
      '<label class="field"><span>What happens</span><textarea rows="2" data-field="script"></textarea></label>' +
      '<label class="field"><span>Frame prompt</span><textarea rows="4" data-field="imagePrompt"></textarea></label>' +
      '<label class="field"><span>Motion prompt</span><textarea rows="3" data-field="videoPrompt"></textarea></label>' +
      '<label class="field"><span>Caption</span><input data-field="caption" maxlength="120"></label>' +
      '<div class="shot-actions">' +
      '<button class="ghost" type="button" data-act="frame">Make the frame</button>' +
      '<button class="primary" type="button" data-act="clip">Generate the clip</button>' +
      '<span class="shot-status" data-status="' + index + '"></span></div>' +
      '<div class="shot-media" hidden><figure data-kind="frame"><img alt="The generated first frame"><figcaption>First frame</figcaption></figure>' +
      '<figure data-kind="clip"><video controls playsinline muted loop></video><figcaption>Clip</figcaption></figure></div>';

    card.querySelector('.shot-title').textContent = shot.title;
    for (const field of ['script', 'imagePrompt', 'videoPrompt', 'caption']) {
      const input = card.querySelector('[data-field="' + field + '"]');
      input.value = shot[field] || '';
      input.addEventListener('input', () => {
        shot[field] = input.value;
        save();
      });
    }

    const media = card.querySelector('.shot-media');
    const frameFig = card.querySelector('[data-kind="frame"]');
    const clipFig = card.querySelector('[data-kind="clip"]');
    if (shot.firstFrameUrl) {
      media.hidden = false;
      frameFig.hidden = false;
      frameFig.querySelector('img').src = shot.firstFrameUrl;
    } else frameFig.hidden = true;
    if (shot.clipUrl) {
      media.hidden = false;
      clipFig.hidden = false;
      clipFig.querySelector('video').src = shot.clipUrl;
    } else clipFig.hidden = true;

    card.querySelector('[data-act="frame"]').addEventListener('click', () => makeFrame(index));
    card.querySelector('[data-act="clip"]').addEventListener('click', () => makeClip(index));
    if (shot.status) shotStatus(index, shot.status);
    host.appendChild(card);
  });
  refreshShotCount();
  refreshFilmState();
}

async function makeFrame(index) {
  const shot = state.shots[index];
  if (!shot.imagePrompt.trim()) return shotStatus(index, 'Write a frame prompt first.', true);
  shotStatus(index, 'Drawing the frame…');
  try {
    const { url } = await api('/api/keyframe', {
      prompt: shot.imagePrompt.trim(),
      referenceDataUrl: state.reference,
      aspect: state.aspect,
    });
    shot.firstFrameUrl = url;
    shot.status = '';
    save();
    renderShots();
  } catch (error) {
    shotStatus(index, error.message, true);
  }
}

async function makeClip(index) {
  const shot = state.shots[index];
  if (!shot.firstFrameUrl) return shotStatus(index, 'Make the frame first.', true);
  if (shot.taskId) return pollClip(index);
  shotStatus(index, 'Sending to the video service…');
  try {
    const { taskId } = await api('/api/clip', {
      prompt: shot.videoPrompt.trim(),
      firstFrameUrl: shot.firstFrameUrl,
      duration: shot.duration,
      aspect: state.aspect,
    });
    shot.taskId = taskId;
    shot.status = 'Queued…';
    save();
    shotStatus(index, 'Queued…');
    pollClip(index);
  } catch (error) {
    shotStatus(index, error.message, true);
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
      shot.status = '';
      save();
      renderShots();
      return;
    }
    if (result.status === 'failed') {
      shot.taskId = '';
      shot.status = '';
      save();
      shotStatus(index, result.message || 'That clip failed.', true);
      return;
    }
    const label = result.status === 'running' ? 'Rendering the clip…' : 'Waiting in the queue…';
    shot.status = label;
    save();
    shotStatus(index, label);
    setTimeout(() => pollClip(index), 8000);
  } catch (error) {
    shotStatus(index, error.message, true);
  }
}

// ---------------------------------------------------------------- step 3: the film

function refreshFilmState() {
  const ready = state.shots.filter((shot) => shot.clipUrl).length;
  $('film-status').textContent = ready === 4 ? 'All four clips are ready' : ready + ' of 4 clips ready';
  $('export').disabled = ready !== 4;
}

async function exportFilm() {
  const shots = state.shots.map((shot) => ({ clipUrl: shot.clipUrl, duration: shot.duration, caption: shot.caption }));
  if (shots.some((shot) => !shot.clipUrl)) return note('export-note', 'All four clips have to be ready first.', true);

  const started = Date.now();
  busy('export', true);
  const ticker = setInterval(() => {
    note('export-note', 'Stitching… ' + Math.round((Date.now() - started) / 1000) + 's. Keep this tab open, it can take a minute or two.', false);
  }, 1000);
  note('export-note', 'Stitching… Keep this tab open, it can take a minute or two.');

  try {
    const result = await api('/api/export', {
      shots,
      aspect: state.aspect,
      subtitles: state.subtitles,
      music: state.music,
      transition: state.transition,
      brand: state.brand,
      endLine: state.endLine,
    });
    clearInterval(ticker);
    $('export-result').hidden = false;
    $('result-video').src = result.url;
    $('result-link').href = result.url;
    note('export-note', 'Done in ' + Math.round((Date.now() - started) / 1000) + 's · ' + Math.round(result.bytes / 1024 / 1024 * 10) / 10 + ' MB · ' + result.seconds + ' seconds of film.');
  } catch (error) {
    clearInterval(ticker);
    note('export-note', error.message, true);
  } finally {
    clearInterval(ticker);
    busy('export', false);
    refreshFilmState();
  }
}

// ---------------------------------------------------------------- wiring

function renderControls() {
  chips('aspects', [
    { value: '16:9', label: 'Wide 16:9' },
    { value: '9:16', label: 'Vertical 9:16' },
    { value: '1:1', label: 'Square 1:1' },
  ], state.aspect, (value) => { state.aspect = value; });

  chips('captions', [
    { value: true, label: 'Captions on' },
    { value: false, label: 'Off' },
  ], state.subtitles, (value) => { state.subtitles = value; refreshFilmState(); });

  chips('music', [
    { value: 'ambient', label: 'Ambient bed' },
    { value: 'none', label: 'Silent' },
  ], state.music, (value) => { state.music = value; });

  chips('transition', [
    { value: 'cut', label: 'Hard cut' },
    { value: 'fade', label: 'Quick fade' },
  ], state.transition, (value) => { state.transition = value; });
}

$('brief').addEventListener('input', (event) => {
  state.brief = event.target.value;
  save();
});
$('brand').addEventListener('input', (event) => {
  state.brand = event.target.value;
  save();
});
$('endline').addEventListener('input', (event) => {
  state.endLine = event.target.value;
  save();
});
$('reference').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  note('plan-note', 'Shrinking the photo…', false);
  try {
    const shrunk = await shrinkImage(file);
    state.reference = shrunk.dataUrl;
    save();
    renderBrief();
    note('plan-note', 'Reference is ' + shrunk.width + '×' + shrunk.height + '. Ready to plan.');
  } catch {
    note('plan-note', 'That file could not be read as an image.', true);
  }
});

$('plan').addEventListener('click', plan);
$('export').addEventListener('click', exportFilm);
$('reset').addEventListener('click', () => {
  if (!confirm('Clear this film and start over? The four clips stay in storage but this page forgets them.')) return;
  const code = state.code;
  state = { ...defaults(), code };
  save();
  $('export-result').hidden = true;
  note('export-note', '');
  renderBrief();
  renderShots();
  renderControls();
  refreshFilmState();
});

// Asks the server whether a class code is expected at all, and picks up the prompt text in the
// same round trip. If ACCESS_CODE has not been configured there is no lock on the door, so the
// studio opens straight away rather than asking for a code that would accept anything.
async function boot() {
  let response;
  try {
    response = await fetch('/api/prompt', { headers: { 'x-access-code': state.code || '' } });
  } catch {
    showGate('The studio could not be reached. Check the connection and try again.');
    return;
  }
  if (response.status === 401) {
    let data = null;
    try {
      data = await response.json();
    } catch {}
    showGate(data && data.needsCode ? 'That class code was not right.' : '');
    return;
  }
  if (!response.ok) {
    showGate('The studio is not ready yet. Try again in a moment.');
    return;
  }
  try {
    const data = await response.json();
    if (data.system) $('storyboard-prompt').textContent = data.system;
  } catch {}
  showApp();
}

$('gate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = $('gate-code').value.trim();
  if (!code) return;
  state.code = code;
  save();
  await boot();
});

renderBrief();
renderShots();
renderControls();
refreshFilmState();
boot();
