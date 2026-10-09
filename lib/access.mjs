import {timingSafeEqual} from 'node:crypto';

// One shared code for the whole class. This is not a login and it does not identify anyone -
// its only job is to stop strangers from spending the model credits. Set ACCESS_CODE before
// the link goes public: with it unset the studio stays open to anyone who finds the URL.
export const accessConfigured = () => String(process.env.ACCESS_CODE || '').trim().length > 0;

export function codeAccepted(provided) {
  const expected = String(process.env.ACCESS_CODE || '').trim();
  if (!expected) return true;
  const given = String(provided || '').trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// Returns true when the caller may continue; otherwise answers the request itself.
export function guard(req, res) {
  if (codeAccepted(req.headers['x-access-code'])) return true;
  res.status(401).json({ error: 'That access code is not right.', needsCode: true });
  return false;
}
