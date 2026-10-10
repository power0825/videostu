import {route, str} from '../lib/handler.mjs';
import {arkChat, requireKeys, httpError} from '../lib/providers.mjs';
import {MOTION, withAgent} from '../lib/prompts.mjs';

// Rewrites the motion prompt for one shot, from that shot's script and frame prompts. It is the
// same button the classroom studio offers, and it exists because the storyboard's first draft of a
// camera move is rarely the one you end up wanting after you have seen the frame.
//
// It is text in, text out on purpose: the frames are already described by the prompts, and keeping
// the model away from the image is what keeps the film's fabric, light and colour consistent.
export default route(async (body) => {
  const script = str(body.script, 2000, 'The shot script');
  const imagePrompt = str(body.imagePrompt, 4000, 'The frame prompt');
  const current = str(body.current, 4000);
  if (!script && !imagePrompt && !current) throw httpError('Give the model something to work from first.');
  requireKeys(['VOLCENGINE_API_KEY', 'VOLCENGINE_TEXT_MODEL']);

  const brief = [
    script ? 'What happens in the shot:\n' + script : '',
    imagePrompt ? 'The frame that is already drawn:\n' + imagePrompt : '',
    current ? 'The current motion prompt, for reference:\n' + current : '',
  ].filter(Boolean).join('\n\n');

  const reply = await arkChat(
    [
      { role: 'system', content: withAgent(MOTION) },
      { role: 'user', content: brief },
    ],
    { maxTokens: 700, timeoutMs: 90000 }
  );

  const text = String(reply?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw httpError('The model did not return a motion prompt. Try again.', 502);
  return { prompt: text.replace(/```[a-z]*\n?/gi, '').replace(/`/g, '').trim().slice(0, 4000) };
});
