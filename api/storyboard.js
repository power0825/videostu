import {route, str} from '../lib/handler.mjs';
import {arkChat, requireKeys} from '../lib/providers.mjs';
import {STORYBOARD, withAgent} from '../lib/prompts.mjs';
import {normaliseShots} from '../lib/shots.mjs';

// Turns a written brief into four shots. The model is asked for JSON, and asking is not enough:
// it sometimes wraps the reply in a fence or adds a sentence, so this retries twice under a
// stricter instruction before giving up. Same shape as the classroom studio.
export default route(async (body) => {
  const brief = str(body.brief, 4000, 'The film brief', true);
  requireKeys(['VOLCENGINE_API_KEY', 'VOLCENGINE_TEXT_MODEL']);

  const system = withAgent(STORYBOARD);
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const extra = attempt === 0
      ? ''
      : '\n\nReply with raw JSON only. No prose, no markdown fences, no bullet lists. Use exactly the keys in the shape above and finish every string.';
    const reply = await arkChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: brief + extra },
      ],
      { maxTokens: 3000 }
    );
    const text = reply?.choices?.[0]?.message?.content || '';
    try {
      return { shots: normaliseShots(text), attempts: attempt + 1, usage: reply?.usage || null };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('The model did not return four readable shots.');
});
