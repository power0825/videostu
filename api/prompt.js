import {guard} from '../lib/access.mjs';
import {bodyOf} from '../lib/handler.mjs';
import {STORYBOARD, withAgent, AGENT_RULES, AGENT_SKILL} from '../lib/prompts.mjs';

// Read-only: hands the page the exact instruction text the planning model receives, so the class
// can read it before anything is generated. The gate calls this on load to find out whether a code
// is expected at all, which is why it takes the code in the body of a POST as well as in the
// header - the body is the only carrier that survives a full-width keyboard.
export default function handler(req, res) {
  if (!guard(req, res, bodyOf(req).accessCode)) return;
  res.status(200).json({ system: withAgent(STORYBOARD), rules: AGENT_RULES, skill: AGENT_SKILL });
}
