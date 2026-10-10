import {spawn} from 'node:child_process';
import {mkdirSync,rmSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Ported from the classroom studio. The argument building is kept as pure functions so it can be
// tested without running ffmpeg; only renderFilm actually spawns anything.

export const DIMENSIONS = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] };

// The four caption looks from the classroom studio. Size and bottom margin are kept as proportions
// of the frame height so one preset reads the same way on a 720p and a 1080p canvas.
//
// The studio's own fonts - Segoe UI Semibold, Georgia - do not exist on a Linux runtime, and libass
// draws empty boxes for a family it cannot resolve. The bundled DejaVu faces stand in: the weight,
// letter spacing, outline, shadow, box and margins are what each preset is actually made of, and
// those are ported exactly.
export const CAPTION_PRESETS = {
  fine: { size: 4.7, spacing: 0.6, outline: 2.2, shadow: 1.2, margin: 7.5, bold: true, box: false, uppercase: false, serif: false },
  box: { size: 4.2, spacing: 0.4, outline: 13, shadow: 0, margin: 6.4, bold: true, box: true, uppercase: false, serif: false },
  editorial: { size: 3.8, spacing: 4.5, outline: 2.4, shadow: 0.8, margin: 8.6, bold: true, box: false, uppercase: true, serif: false },
  serif: { size: 4.6, spacing: 0.8, outline: 1.8, shadow: 1.4, margin: 7.8, bold: false, box: false, uppercase: false, serif: true },
};
// An empty key means "studio default", which is what ran before presets existed.
export const CAPTION_STYLE_KEYS = ['', ...Object.keys(CAPTION_PRESETS)];
const BOX_COLOUR = '&H88000000';

export const SERIF_FONT = process.env.CAPTION_SERIF_FONT || 'DejaVu Serif';

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

// Turns one preset into the numbers libass wants, given the canvas height. An unknown or empty key
// falls back to the studio default, so a bad request can never render unreadable captions.
export function resolveCaptionStyle(key, height, style = {}) {
  const base = {
    font: style.font || process.env.CAPTION_FONT || 'DejaVu Sans',
    colour: '&H00FFFFFF',
    boxColour: '&H90000000',
  };
  const preset = CAPTION_PRESETS[key];
  if (!preset) {
    return {
      ...base,
      size: Number(style.size || process.env.CAPTION_SIZE || 44),
      outline: 2,
      shadow: 0,
      marginBottom: 70,
      uppercase: true,
      spacing: 0,
      bold: true,
      box: false,
    };
  }
  return {
    ...base,
    font: preset.serif ? SERIF_FONT : base.font,
    boxColour: preset.box ? BOX_COLOUR : base.boxColour,
    size: Math.round((height * preset.size) / 100),
    outline: preset.outline,
    shadow: preset.shadow,
    marginBottom: Math.round((height * preset.margin) / 100),
    uppercase: preset.uppercase,
    spacing: preset.spacing,
    bold: preset.bold,
    box: preset.box,
  };
}

export function assScript(width, height, cues, style) {
  const { font, size, colour, boxColour, outline, shadow, marginBottom, uppercase, spacing = 0, bold = true, box = false } = style;
  const lines = cues
    .map((cue) => {
      const text = uppercase ? cue.text.toUpperCase() : cue.text;
      return `Dialogue: 0,${stamp(cue.start)},${stamp(cue.end)},Cap,,0,0,0,,${text.replace(/\r?\n/g, '\\N')}`;
    })
    .join('\n');
  // BorderStyle 3 draws an opaque box behind the text using the outline colour; 1 draws an outline
  // around the glyphs. That single field is the difference between "bar behind text" and the rest.
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
    `Style: Cap,${font},${size},${colour},${colour},${boxColour},${boxColour},${bold ? -1 : 0},0,0,0,100,100,${spacing},0,${box ? 3 : 1},${outline},${shadow},2,60,60,${marginBottom},1`,
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

// A quiet three-note bed, generated by ffmpeg itself so the default soundtrack costs nothing and
// needs no asset. An uploaded track replaces it entirely.
const AMBIENT_TONE = 'aevalsrc=0.035*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t))*(0.65+0.35*sin(2*PI*0.5*t)):s=44100';

export function concatArgs({ cueCount, music = 'none', musicPath = '', logoPath = '', elapsed }) {
  const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', 'list.txt'];
  let next = 1;
  let musicIndex = -1;
  if (music === 'ambient') {
    musicIndex = next++;
    args.push('-f', 'lavfi', '-i', AMBIENT_TONE);
  } else if (music === 'upload' && musicPath) {
    // A track the class brought in. Looped, because a fifteen-second film outlasts most stingers.
    musicIndex = next++;
    args.push('-stream_loop', '-1', '-i', musicPath);
  }
  let logoIndex = -1;
  if (logoPath) {
    logoIndex = next++;
    args.push('-loop', '1', '-i', logoPath);
  }

  // The video chain is built label by label, in the order the inputs were declared.
  let label = 0;
  let v = 'v' + label;
  let chain = '[0:v]null[' + v + ']';
  if (cueCount) {
    label++;
    chain += `;[${v}]subtitles=filename=titles.ass:fontsdir=fonts[v${label}]`;
    v = 'v' + label;
  }
  if (logoIndex >= 0) {
    // Same placement as the classroom studio: 140px tall, 28px in from the top right, and only on
    // screen while the brand ending is up.
    label++;
    chain += `;[${logoIndex}:v]scale=140:-1[logo];[${v}][logo]overlay=W-w-28:28:enable='gte(t,${Math.max(0, elapsed - 2)})'[v${label}]`;
    v = 'v' + label;
  }
  if (musicIndex >= 0) {
    chain += `;[${musicIndex}:a]volume=0.6,afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, elapsed - 0.8)}:d=0.8[a]`;
  }

  args.push('-filter_complex', chain, '-map', `[${v}]`);
  // Both music sources are endless by construction; -t above is what ends the film.
  if (musicIndex >= 0) args.push('-map', '[a]', '-c:a', 'aac');
  else args.push('-an');
  args.push('-t', String(elapsed), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'final.mp4');
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
export async function renderFilm({
  shots,
  aspect = '16:9',
  transition = 'cut',
  subtitles = true,
  brand = '',
  endLine = '',
  music = 'none',
  musicUrl = '',
  logoUrl = '',
  captionStyle = '',
  fonts = null,
  style = {},
}) {
  const [width, height] = DIMENSIONS[aspect] || DIMENSIONS['16:9'];
  const work = join(tmpdir(), 'film-' + Math.random().toString(36).slice(2));
  mkdirSync(work, { recursive: true });
  const started = Date.now();
  const remaining = () => TOTAL_BUDGET - (Date.now() - started);
  const faces = fonts || fontFiles();
  const resolvedStyle = resolveCaptionStyle(captionStyle, height, style);

  try {
    for (let i = 0; i < shots.length; i++) {
      if (remaining() < 60_000) throw new Error('Ran out of time before the film was finished. Try again, or export fewer shots.');
      const file = join(work, `source${i}.mp4`);
      await fetchToFile(shots[i].clipUrl, file);
      // Trim start skips the opening seconds of a clip so the action begins right away. The slot
      // still lasts the full duration, so the film's length never moves.
      const trimStart = Math.max(0, Number(shots[i].trimStart) || 0);
      await runProcess(FFMPEG, clipArgs(file, join(work, `shot${i}.mp4`), { width, height, duration: shots[i].duration, transition, trimStart }));
    }

    const { cues, elapsed } = buildCues(shots, { subtitles, brand, endLine });
    writeFileSync(join(work, 'list.txt'), shots.map((_, i) => `file 'shot${i}.mp4'`).join('\n'));
    if (cues.length) {
      writeFileSync(join(work, 'titles.ass'), assScript(width, height, cues, resolvedStyle));
      const fontDir = join(work, 'fonts');
      mkdirSync(fontDir, { recursive: true });
      // libass resolves a family name from the files in fontsdir, so the file name here is
      // irrelevant - what matters is that both faces the presets can ask for are present.
      if (faces.sans) copyFileSync(faces.sans, join(fontDir, 'caption-sans.ttf'));
      if (faces.serif) copyFileSync(faces.serif, join(fontDir, 'caption-serif.ttf'));
    }

    // The logo and an uploaded track are fetched to disk first: ffmpeg growing a filter graph on a
    // remote URL is far more fragile than letting it read a local file.
    let logoPath = '';
    if (logoUrl) {
      logoPath = join(work, 'logo.png');
      await fetchToFile(logoUrl, logoPath);
    }
    let musicPath = '';
    if (music === 'upload' && musicUrl) {
      musicPath = join(work, 'music.mp3');
      await fetchToFile(musicUrl, musicPath);
    }

    await runProcess(FFMPEG, concatArgs({ cueCount: cues.length, music, musicPath, logoPath, elapsed }), { cwd: work });

    const finalPath = join(work, 'final.mp4');
    if (!existsSync(finalPath)) throw new Error('FFmpeg finished without producing a file.');
    const bytes = await readFileBuffer(finalPath);
    return { bytes, elapsed, width, height, captions: cues.length, style: captionStyle || 'default' };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function readFileBuffer(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

const fontCandidate = (name) => [
  resolve('node_modules', 'dejavu-fonts-ttf', 'ttf', name),
  resolve('..', 'node_modules', 'dejavu-fonts-ttf', 'ttf', name),
].find((path) => existsSync(path)) || null;

// libass needs an actual font file, not just a name: a bare Linux runtime has almost none, and an
// unknown name draws empty boxes. Your own file wins, then the one bundled next to the project,
// then the DejaVu package. The serif face is only used by one caption preset.
export function fontFiles() {
  const own = (name) => (process.env[name] && existsSync(process.env[name]) ? process.env[name] : null);
  return {
    sans: own('CAPTION_FONT_FILE')
      || (existsSync(resolve('fonts', 'caption.ttf')) ? resolve('fonts', 'caption.ttf') : null)
      || fontCandidate('DejaVuSans.ttf'),
    serif: own('CAPTION_SERIF_FONT_FILE') || fontCandidate('DejaVuSerif.ttf'),
  };
}

export function fontPath() {
  return fontFiles().sans;
}
