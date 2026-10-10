import {route, str, num} from '../lib/handler.mjs';
import {storeBytes, httpError} from '../lib/providers.mjs';
import {renderFilm, fontFiles, DIMENSIONS, CAPTION_STYLE_KEYS} from '../lib/render.mjs';
import {SHOT_COUNT} from '../lib/shots.mjs';

// Stitches the four clips into one film and returns a link. This is the only route that does real
// work rather than waiting on someone else, so it is also the only one with a long maxDuration.
export default route(async (body) => {
  const incoming = Array.isArray(body.shots) ? body.shots : [];
  if (incoming.length !== SHOT_COUNT) throw httpError(`Sending a film needs exactly ${SHOT_COUNT} clips.`);

  const shots = incoming.map((shot, index) => {
    const clipUrl = str(shot && shot.clipUrl, 2000, `Clip ${index + 1}`);
    if (!clipUrl) throw httpError(`Clip ${index + 1} is missing. Generate all four before exporting.`);
    return {
      clipUrl,
      duration: num(shot && shot.duration, 3, 2, 8),
      // Skips the head of a clip so the action starts right away. The slot keeps its length, so the
      // film stays the same number of seconds however this is set.
      trimStart: num(shot && shot.trimStart, 0, 0, 120),
      caption: str(shot && shot.caption, 120),
    };
  });

  const aspect = DIMENSIONS[String(body.aspect || '')] ? String(body.aspect) : '16:9';
  const music = ['ambient', 'upload'].includes(String(body.music)) ? String(body.music) : 'none';
  const musicUrl = music === 'upload' ? str(body.musicUrl, 2000, 'The uploaded track') : '';
  if (music === 'upload' && !musicUrl) throw httpError('Upload a music file first, or switch the soundtrack off.');
  const wanted = String(body.captionStyle || '');
  const captionStyle = CAPTION_STYLE_KEYS.includes(wanted) ? wanted : '';

  const result = await renderFilm({
    shots,
    aspect,
    transition: body.transition === 'fade' ? 'fade' : 'cut',
    subtitles: body.subtitles !== false,
    brand: str(body.brand, 100),
    endLine: str(body.endLine, 180),
    music,
    musicUrl,
    logoUrl: str(body.logoUrl, 2000),
    captionStyle,
    fonts: fontFiles(),
  });

  const url = await storeBytes(result.bytes, 'films/final.mp4', 'video/mp4');
  return {
    url,
    seconds: result.elapsed,
    bytes: result.bytes.length,
    captions: result.captions,
    captionStyle: result.style,
  };
});
