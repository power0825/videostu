import {guard} from './access.mjs';
import {httpError} from './providers.mjs';

// Every route does the same four things: check the access code, insist on POST, hand the parsed
// body to the real work, and turn any thrown error into a readable message. This is that shape.

export function bodyOf(req) {
  const raw = req.body;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export function route(fn) {
  return async (req, res) => {
    // The body is read before the check because the code can ride in it as well as in the header:
    // a header only carries ASCII, so a code typed in full-width mode would be mangled in transit.
    const body = bodyOf(req);
    if (!guard(req, res, body.accessCode)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    try {
      res.status(200).json(await fn(body, req));
    } catch (error) {
      const status = Number(error && error.status) || 500;
      if (status >= 500) console.error('route failed:', error && error.message);
      res.status(status).json({ error: error && error.message ? error.message : 'Something went wrong.' });
    }
  };
}

export const str = (value, max, label, required = false) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw httpError(`${label} is required.`);
  return text.slice(0, max);
};

export const num = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
