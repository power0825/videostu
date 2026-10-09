import {route, str, num} from '../lib/handler.mjs';
import {storeBytes, httpError} from '../lib/providers.mjs';
import {renderFilm, fontPath, DIMENSIONS} from '../lib/render.mjs';
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
      caption: str(shot && shot.caption, 120),
    };
  });

  const aspect = DIMENSIONS[String(body.aspect || '')] ? String(body.aspect) : '16:9';
  const result = await renderFilm({
    shots,
    aspect,
    transition: body.transition === 'fade' ? 'fade' : 'cut',
    subtitles: body.subtitles !== false,
    brand: str(body.brand, 100),
    endLine: str(body.endLine, 180),
    music: body.music === 'ambient' ? 'ambient' : 'none',
    fontFile: fontPath(),
  });

  const url = await storeBytes(result.bytes, 'films/final.mp4', 'video/mp4');
  return { url, seconds: result.elapsed, bytes: result.bytes.length, captions: result.captions };
});
