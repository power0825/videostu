import {put} from '@vercel/blob';

// Every outside service this app talks to. Nothing here knows about films or shots - it only
// knows how to ask Ark for text and images, Bailian for a video task, and Blob for storage.

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3/';
const DEFAULT_BAILIAN = 'https://llm-zox3pv2a4xrvokvg.cn-beijing.maas.aliyuncs.com/api/v1';

export function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function config() {
  return {
    arkKey: String(process.env.VOLCENGINE_API_KEY || '').trim(),
    textModel: String(process.env.VOLCENGINE_TEXT_MODEL || '').trim(),
    imageModel: String(process.env.VOLCENGINE_IMAGE_MODEL || 'doubao-seedream-4-5-251128').trim(),
    bailianKey: String(process.env.BAILIAN_API_KEY || '').trim(),
    bailianBase: String(process.env.BAILIAN_BASE_URL || DEFAULT_BAILIAN).replace(/\/$/, ''),
    videoModel: String(process.env.BAILIAN_VIDEO_MODEL || 'wan3.0-video').trim(),
  };
}

export function requireKeys(names) {
  const missing = names.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length) {
    throw httpError(`This deployment is missing ${missing.join(', ')}. Set them in the Vercel project settings.`, 503);
  }
}

async function jsonOrThrow(response, label) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw httpError(`${label} returned a response that could not be read.`, 502);
  }
  if (!response.ok || (body && body.code && body.code !== 200)) {
    const detail = (body && (body.message || body.error?.message || body.code)) || `HTTP ${response.status}`;
    throw httpError(`${label}: ${String(detail).slice(0, 300)}`, 502);
  }
  return body;
}

async function request(url, options, timeoutMs, label) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error && error.name === 'TimeoutError') throw httpError(`${label} did not answer in time. Try again.`, 504);
    throw httpError(`${label} could not be reached.`, 504);
  }
  return jsonOrThrow(response, label);
}

// ---- Volcengine Ark: the text model writes the shots, the image model draws the keyframes ----

export async function arkChat(messages, { maxTokens = 3000, timeoutMs = 120000 } = {}) {
  const { arkKey, textModel } = config();
  requireKeys(['VOLCENGINE_API_KEY', 'VOLCENGINE_TEXT_MODEL']);
  return request(
    ARK_BASE + 'chat/completions',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + arkKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: textModel, messages, max_tokens: maxTokens, thinking: { type: 'disabled' } }),
    },
    timeoutMs,
    'The text model'
  );
}

export async function arkImage({ prompt, image, size, timeoutMs = 180000 }) {
  const { arkKey, imageModel } = config();
  requireKeys(['VOLCENGINE_API_KEY']);
  return request(
    ARK_BASE + 'images/generations',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + arkKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: imageModel,
        prompt,
        image,
        size,
        response_format: 'b64_json',
        stream: false,
        watermark: true,
        sequential_image_generation: 'disabled',
      }),
    },
    timeoutMs,
    'The image model'
  );
}

// ---- Bailian: one keyframe becomes one moving clip, asynchronously ----

export async function bailian(path, body, timeoutMs = 60000) {
  const { bailianKey, bailianBase } = config();
  requireKeys(['BAILIAN_API_KEY']);
  return request(
    bailianBase + path,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + bailianKey,
        ...(body ? { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    timeoutMs,
    'The video service'
  );
}

export async function submitClip({ prompt, firstFrameUrl, duration, aspect }) {
  const { videoModel } = config();
  const result = await bailian('/services/aigc/video-generation/video-synthesis', {
    model: videoModel,
    input: { prompt, media: [{ type: 'first_frame', url: firstFrameUrl }] },
    parameters: { resolution: '720P', ratio: aspect, duration, prompt_extend: false, audio: false },
  });
  const taskId = result?.output?.task_id;
  if (!taskId) throw httpError('The video service accepted the request but returned no task id. Check the provider console.', 502);
  return taskId;
}

export async function clipStatus(taskId) {
  const result = await bailian('/tasks/' + encodeURIComponent(taskId));
  const output = result?.output || {};
  const status = output.task_status;
  if (!status) throw httpError('The video service returned an unreadable task status.', 502);
  if (status === 'SUCCEEDED') return { status: 'succeeded', url: output.video_url || '' };
  if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) {
    return { status: 'failed', message: String(output.message || 'The clip failed to generate.').slice(0, 300) };
  }
  return { status: status === 'RUNNING' ? 'running' : 'pending' };
}

// ---- Blob: the only place files survive, because a function's disk is wiped when it returns ----

export async function storeBytes(bytes, pathname, contentType) {
  requireKeys(['BLOB_READ_WRITE_TOKEN']);
  try {
    const result = await put(pathname, bytes, { access: 'public', contentType, addRandomSuffix: true });
    return result.url;
  } catch (error) {
    throw httpError('Storage rejected the file. Check that the Vercel Blob store is connected to this project. ' + String(error?.message || '').slice(0, 160), 502);
  }
}

export async function downloadToBuffer(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  } catch {
    throw httpError('A generated file could not be downloaded. It may have expired.', 504);
  }
  if (!response.ok) throw httpError(`A generated file could not be downloaded (${response.status}).`, 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw httpError('A generated file came back empty.', 502);
  return bytes;
}

export function dataUrl(bytes, mime) {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
