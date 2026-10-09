// Runs the whole export pipeline on this machine, without touching any model API.
//
//   npm install
//   npm run smoke
//
// It makes four synthetic clips with the same ffmpeg binary the deployment uses, feeds them through
// renderFilm exactly as /api/export does, and leaves smoke-out/final.mp4 behind so you can watch it.
//
// Run this before the first deploy. It is the one step that cannot be checked without executing
// ffmpeg, so it catches a broken binary, a missing font and a bad filter chain in about a minute.

import {createServer} from 'node:http';
import {readFileSync, writeFileSync, mkdirSync, existsSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {renderFilm, fontPath, FFMPEG, FFPROBE, buildCues} from '../lib/render.mjs';

const OUT = resolve('smoke-out');
rmSync(OUT, {recursive: true, force: true});
mkdirSync(OUT, {recursive: true});

const say = (text) => console.log(text);
const step = (n, text) => say('\n[' + n + '] ' + text);

say('ffmpeg  : ' + FFMPEG);
say('ffprobe : ' + FFPROBE);
const font = fontPath();
say('font    : ' + (font || 'NONE FOUND — captions will be skipped or drawn as boxes'));

step(1, 'Making four synthetic clips');
const durations = [3, 4, 3, 5];
durations.forEach((seconds, index) => {
  const target = join(OUT, 'clip' + index + '.mp4');
  // Deliberately plain: no drawtext, because that would drag fontconfig into the test and this
  // step is about the concat and caption chain, not about rendering text into the source clips.
  execFileSync(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=854x480:rate=24:duration=' + seconds,
    '-f', 'lavfi', '-i', 'color=c=0x0f3d3e:size=854x480:rate=24:duration=' + seconds,
    '-filter_complex', '[1:v][0:v]overlay=0:0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', target,
  ]);
  say('  clip' + index + '.mp4  ' + seconds + 's');
});

step(2, 'Serving them over localhost so renderFilm fetches them like real provider links');
const server = createServer((req, res) => {
  const file = join(OUT, req.url.replace(/[^a-z0-9.]/gi, ''));
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

step(3, 'Running the export pipeline');
const shots = durations.map((seconds, index) => ({
  duration: seconds,
  caption: ['Material in motion', 'Fabric becomes a polo', 'Crafted detail', 'Everyday style'][index],
  clipUrl: 'http://127.0.0.1:' + port + '/clip' + index + '.mp4',
}));

const started = Date.now();
const result = await renderFilm({
  shots,
  aspect: '16:9',
  transition: 'cut',
  subtitles: true,
  brand: 'EVERKNIT',
  endLine: 'Explore our pique collection.',
  music: 'ambient',
  fontFile: font,
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const finalPath = join(OUT, 'final.mp4');
writeFileSync(finalPath, result.bytes);

step(4, 'Checking the result');
const meta = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', finalPath], { encoding: 'utf8' }));
const video = meta.streams.find((s) => s.codec_type === 'video');
const audio = meta.streams.find((s) => s.codec_type === 'audio');
say('  took          ' + seconds + 's');
say('  duration      ' + Number(meta.format.duration).toFixed(2) + 's   (expected 15.00)');
say('  video         ' + video.codec_name + '  ' + video.width + 'x' + video.height + '  ' + video.r_frame_rate);
say('  audio         ' + (audio ? audio.codec_name : 'none'));
say('  size          ' + (result.bytes.length / 1024 / 1024).toFixed(2) + ' MB');
say('  captions      ' + result.captions + ' cue(s) written into titles.ass');
say('  expected cues ' + buildCues(shots, { subtitles: true, brand: 'EVERKNIT', endLine: 'Explore our pique collection.' }).cues.length);

step(5, 'Pulling one frame so you can look at the caption');
const framePath = join(OUT, 'frame-at-1s.png');
execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', '1', '-i', finalPath, '-frames:v', '1', framePath]);
say('  ' + framePath);

server.close();
say('\nResult: ' + finalPath);
say('Open that file. If the four clips are joined, the caption is readable and the ending card appears,');
say('the export path is fine and the same code will work on Vercel.');
