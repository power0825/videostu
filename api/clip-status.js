import {route, str} from '../lib/handler.mjs';
import {clipStatus, downloadToBuffer, storeBytes} from '../lib/providers.mjs';

// Polls one clip. When the provider says it is done, the file is downloaded and re-hosted: the
// provider's own link expires after a while, and the finished clip has to survive long enough to
// be exported.
export default route(async (body) => {
  const taskId = str(body.taskId, 200, 'The task id', true);
  const result = await clipStatus(taskId);

  if (result.status !== 'succeeded') return result;
  if (!result.url) return { status: 'failed', message: 'The clip finished without a file.' };

  const bytes = await downloadToBuffer(result.url);
  const url = await storeBytes(bytes, 'clips/clip.mp4', 'video/mp4');
  return { status: 'succeeded', url, bytes: bytes.length };
});
