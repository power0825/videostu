import {guard} from '../lib/access.mjs';
import {STORYBOARD, withAgent, AGENT_RULES, AGENT_SKILL} from '../lib/prompts.mjs';

// Read-only: hands the page the exact instruction text the planning model receives, so the class
// can read it before anything is generated. This route takes GET, unlike the others.
export default function handler(req, res) {
  if (!guard(req, res)) return;
  res.status(200).json({ system: withAgent(STORYBOARD), rules: AGENT_RULES, skill: AGENT_SKILL });
}
