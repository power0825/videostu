import {spawn} from 'node:child_process';
import {mkdirSync,rmSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Ported from the classroom studio. The argument building is kept as pure functions so it can be
// tested without running ffmpeg; only renderFilm actually spawns anything.

export const DIMENSIONS = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] };

// Resolved lazily and defensively: the packages ship the actual binaries, and a missing one must
// turn into a clear message rather than a crash while the module is loading.
async function bundled(name, pick) {
  try {
    const loaded = await import(name);
    return pick(loaded) || null;
  } catch {
    return null;
  }
}
const ffmpegStatic = await bundled('ffmpeg-static', (m) => m.default);
const ffprobeStatic = await bundled('ffprobe-static', (m) => (m.default && m.default.path) || m.default);

export const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic || 'ffprobe';

// A single encode must not eat the whole function budget.
const STEP_TIMEOUT = 90_000;
// Fluid compute gives this function 300s on the Hobby plan. Leave room to upload the result.
const TOTAL_BUDGET = 240_000;

export function runProcess(bin, args, opts = {}) {
  return new Promise((ok, no) => {
    const child = spawn(bin, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', () => no(new Error('FFmpeg is unavailable in this runtime. Check the ffmpeg-static install.')));
    const timer = setTimeout(() => {
      child.kill();
      no(new Error('A single media step took longer than 90 seconds.'));
    }, opts.timeout || STEP_TIMEOUT);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) ok(out);
      else no(new Error('FFmpeg could not process these clips. ' + err.slice(-300)));
    });
  });
}

export const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  return [
    String(Math.floor(ms / 3600000)).padStart(2, '0'),
    String(Math.floor(ms / 60000) % 60).padStart(2, '0'),
    String(Math.floor(ms / 1000) % 60).padStart(2, '0'),
  ].join(':') + ',' + String(ms % 1000).padStart(3, '0');
};

// Captions sit on the timeline the same way the classroom studio lays them out: one per shot,
// then the brand ending covering the last two seconds.
export function buildCues(shots, { subtitles = true, brand = '', endLine = '' } = {}) {
  const cues = [];
  let elapsed = 0;
  for (const shot of shots) {
    if (subtitles && shot.caption) {
      cues.push({ start: elapsed, end: elapsed + shot.duration, text: String(shot.caption).replace(/\r?\n+/g, ' ') });
    }
    elapsed += shot.duration;
  }
  if (brand || endLine) {
    const text = [brand, endLine].filter(Boolean).join('\n');
    const cut = Math.max(0, elapsed - 2);
    const last = cues[cues.length - 1];
    if (last && last.end > cut) last.end = Math.max(last.start + 0.5, cut);
    cues.push({ start: cut, end: elapsed, text });
  }
  return { cues, elapsed };
}

// Style is deliberately plain compared with the classroom studio: one caption look, no presets.
// The font name only matters when libass cannot find the file, which is why renderFilm also passes
// fontsdir - on a bare Linux image an unknown name draws empty boxes.
export function assScript(width, height, cues, style) {
  const { font, size, colour, boxColour, outline, shadow, marginBottom, uppercase } = style;
  const lines = cues
    .map((cue) => {
      const text = uppercase ? cue.text.toUpperCase() : cue.text;
      return `Dialogue: 0,${stamp(cue.start)},${stamp(cue.end)},Cap,,0,0,0,,${text.replace(/\r?\n/g, '\\N')}`;
    })
    .join('\n');
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${font},${size},${colour},${colour},${boxColour},${boxColour},-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,60,60,${marginBottom},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    lines,
    '',
  ].join('\n');
}

// Every clip is forced to the same size, frame rate and pixel format before concatenation,
// otherwise concat demuxer either refuses the join or produces a broken stream.
export function clipFilters(width, height, duration, transition) {
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    'fps=30',
    'format=yuv420p',
    `tpad=stop_mode=clone:stop_duration=${duration}`,
  ];
  if (transition === 'fade') filters.push('fade=t=in:st=0:d=0.15', `fade=t=out:st=${duration - 0.15}:d=0.15`);
  return filters.join(',');
}

export function clipArgs(input, output, { width, height, duration, transition, trimStart }) {
  return ['-y', '-v', 'error', '-ss', String(trimStart || 0), '-i', input, '-vf', clipFilters(width, height, duration, transition), '-t', String(duration), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', output];
}

export function concatArgs({ cueCount, music, elapsed, deadline }) {
  const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', 'list.txt'];
  let musicIndex = -1;
  let next = 1;
  if (music === 'ambient') {
    musicIndex = next++;
    args.push('-f', 'lavfi', '-i', 'aevalsrc=0.035*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.65+0.35*sin(2*PI*0.5*t)):s=44100');
  }
  let chain = '[0:v]null[v0]';
  let v = 'v0';
  if (cueCount) {
    chain += `;[${v}]subtitles=filename=titles.ass:fontsdir=fonts[v1]`;
    v = 'v1';
  }
  if (musicIndex >= 0) {
    chain += `;[${musicIndex}:a]volume=0.6,afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, elapsed - 0.8)}:d=0.8[a]`;
  }
  args.push('-filter_complex', chain, '-map', `[${v}]`);
  if (musicIndex >= 0) args.push('-map', '[a]', '-c:a', 'aac');
  else args.push('-an');
  args.push('-t', String(elapsed), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'final.mp4');
  void deadline;
  return args;
}

async function fetchToFile(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download a clip (${response.status}). The provider link may have expired — generate that shot again.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('A clip came back empty. Generate that shot again.');
  writeFileSync(path, bytes);
  return bytes.length;
}

// Runs the whole film. Everything happens inside /tmp because that is the only writable place in
// a Vercel function, and it is wiped when the invocation ends.
export async function renderFilm({ shots, aspect = '16:9', transition = 'cut', subtitles = true, brand = '', endLine = '', music = 'none', fontFile = null, style = {} }) {
  const [width, height] = DIMENSIONS[aspect] || DIMENSIONS['16:9'];
  const work = join(tmpdir(), 'film-' + Math.random().toString(36).slice(2));
  mkdirSync(work, { recursive: true });
  const started = Date.now();
  const remaining = () => TOTAL_BUDGET - (Date.now() - started);

  const captionStyle = {
    font: style.font || process.env.CAPTION_FONT || 'DejaVu Sans',
    size: Number(style.size || process.env.CAPTION_SIZE || 44),
    colour: '&H00FFFFFF',
    boxColour: '&H90000000',
    outline: 2,
    shadow: 0,
    marginBottom: 70,
    uppercase: true,
  };

  try {
    for (let i = 0; i < shots.length; i++) {
      if (remaining() < 60_000) throw new Error('Ran out of time before the film was finished. Try again, or export fewer shots.');
      const file = join(work, `source${i}.mp4`);
      await fetchToFile(shots[i].clipUrl, file);
      let actual = null;
      try {
        const meta = JSON.parse(await runProcess(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
        actual = Number(meta.format && meta.format.duration);
      } catch {}
      if (actual !== null && !Number.isFinite(actual)) actual = null;
      await runProcess(FFMPEG, clipArgs(file, join(work, `shot${i}.mp4`), { width, height, duration: shots[i].duration, transition, trimStart: 0 }));
      void actual;
    }

    const { cues, elapsed } = buildCues(shots, { subtitles, brand, endLine });
    writeFileSync(join(work, 'list.txt'), shots.map((_, i) => `file 'shot${i}.mp4'`).join('\n'));
    if (cues.length) {
      writeFileSync(join(work, 'titles.ass'), assScript(width, height, cues, captionStyle));
      const fonts = join(work, 'fonts');
      mkdirSync(fonts, { recursive: true });
      if (fontFile && existsSync(fontFile)) copyFileSync(fontFile, join(fonts, 'caption.ttf'));
    }

    await runProcess(FFMPEG, concatArgs({ cueCount: cues.length, music, elapsed, deadline: remaining() }), { cwd: work });

    const finalPath = join(work, 'final.mp4');
    if (!existsSync(finalPath)) throw new Error('FFmpeg finished without producing a file.');
    const bytes = await readFileBuffer(finalPath);
    return { bytes, elapsed, width, height, captions: cues.length };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function readFileBuffer(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

// libass needs an actual font file, not just a name: a bare Linux runtime has almost none, and an
// unknown name draws empty boxes. Order of preference is your own file, then the bundled DejaVu.
export function fontPath() {
  const candidates = [
    process.env.CAPTION_FONT_FILE,
    resolve('fonts', 'caption.ttf'),
    resolve('node_modules', 'dejavu-fonts-ttf', 'ttf', 'DejaVuSans.ttf'),
    resolve('..', 'node_modules', 'dejavu-fonts-ttf', 'ttf', 'DejaVuSans.ttf'),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) || null;
}
