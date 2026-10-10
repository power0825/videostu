import {route, str} from '../lib/handler.mjs';
import {storeBytes, httpError} from '../lib/providers.mjs';

// Uploads for the three files a student can bring in: a frame, an end logo, and a music bed.
// Everything arrives as a base64 data URL inside the JSON body, which is what keeps this app free
// of a bundler - there is no client-side SDK to import, and the browser shrinks images to 1600px
// before sending them, so they land far below the 4.5MB request limit.
//
// Video is deliberately absent. An MP4 cannot fit through a function body, and direct-to-Blob
// uploads would mean adding a build step to what is otherwise a folder of plain files. Clips come
// from the video service instead, which is the workflow the class is here to learn anyway.
const KINDS = {
  frame: { prefix: 'image/', label: 'a PNG, JPEG or WebP image', folder: 'frames', max: 3_000_000 },
  logo: { prefix: 'image/', label: 'a PNG, JPEG or WebP image', folder: 'logos', max: 1_500_000 },
  music: { prefix: 'audio/', label: 'an MP3, WAV or M4A track', folder: 'music', max: 3_000_000 },
};

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

export default route(async (body) => {
  const kind = String(body.kind || '');
  const spec = KINDS[kind];
  if (!spec) throw httpError('That upload kind is not one this studio accepts.');

  const dataUrl = str(body.dataUrl, 4_600_000, 'The file', true);
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw httpError('That file did not arrive as readable base64 data.');
  const mime = match[1].toLowerCase();
  if (!mime.startsWith(spec.prefix)) throw httpError('A ' + kind + ' has to be ' + spec.label + '.');

  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw httpError('That file came through empty.');
  if (bytes.length > spec.max) {
    const mb = (bytes.length / 1024 / 1024).toFixed(1);
    throw httpError('That file is ' + mb + 'MB. Keep it under ' + Math.round(spec.max / 1024 / 1024) +
      'MB — anything larger cannot pass through a serverless function.');
  }

  const url = await storeBytes(bytes, spec.folder + '/' + kind, mime);
  return { url, bytes: bytes.length, kind };
});
