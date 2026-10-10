import {route, str, num} from '../lib/handler.mjs';
import {submitClip, requireKeys, RESOLUTIONS} from '../lib/providers.mjs';

// Submits one clip. Generation is asynchronous on the provider side: this returns a task id and
// the page polls /api/clip-status until the clip is ready.
export default route(async (body) => {
  const prompt = str(body.prompt, 4000, 'The motion prompt', true);
  const firstFrameUrl = str(body.firstFrameUrl, 2000, 'The first frame', true);
  // Optional. An empty string is normal - most shots are driven from one frame.
  const lastFrameUrl = str(body.lastFrameUrl, 2000);
  const aspect = ['16:9', '9:16', '1:1'].includes(String(body.aspect)) ? String(body.aspect) : '16:9';
  const duration = num(body.duration, 3, 2, 8);
  const resolution = RESOLUTIONS.includes(String(body.resolution)) ? String(body.resolution) : '720P';
  requireKeys(['BAILIAN_API_KEY']);

  const taskId = await submitClip({ prompt, firstFrameUrl, lastFrameUrl, duration, aspect, resolution });
  return { taskId };
});
