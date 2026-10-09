import {route, str} from '../lib/handler.mjs';
import {arkImage, storeBytes, requireKeys, httpError} from '../lib/providers.mjs';

// One keyframe. The reference arrives as a data URL: the page shrinks the photo before sending it,
// so it stays well under the 4.5MB request limit and this route never has to touch the disk.
// The result goes out as a public URL, because the video service has to fetch it itself.
const SIZES = { '16:9': '2560x1440', '9:16': '1440x2560', '1:1': '2048x2048' };
const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/;

export default route(async (body) => {
  const prompt = str(body.prompt, 4000, 'The frame prompt', true);
  const reference = str(body.referenceDataUrl, 6_000_000, 'The reference image', true);
  if (!DATA_URL.test(reference)) throw httpError('The reference has to be a PNG or JPEG image.');
  const aspect = SIZES[String(body.aspect || '')] ? String(body.aspect) : '16:9';
  requireKeys(['VOLCENGINE_API_KEY']);

  const out = await arkImage({ prompt, image: reference, size: SIZES[aspect] });
  const encoded = out?.data?.[0]?.b64_json;
  if (!encoded || encoded.length > 40_000_000) throw httpError('The image model did not return a usable frame.', 502);

  const bytes = Buffer.from(encoded, 'base64');
  const url = await storeBytes(bytes, 'keyframes/shot.png', bytes[0] === 137 ? 'image/png' : 'image/jpeg');
  return { url, bytes: bytes.length };
});
