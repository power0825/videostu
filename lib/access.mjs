import {timingSafeEqual} from 'node:crypto';

// One shared code for the whole class. This is not a login and it does not identify anyone -
// its only job is to stop strangers from spending the model credits. Set ACCESS_CODE before
// the link goes public: with it unset the studio stays open to anyone who finds the URL.

// A value typed into a hosting dashboard tends to arrive with invisible company: a trailing
// newline, a stray tab, or the quote marks that were around it in a .env file. Those are
// configuration accidents rather than secrets, so they are removed before anything is compared.
//
// NFKC folds full-width forms back onto their ASCII originals. That matters because a code typed
// with a Chinese IME in full-width mode produces ＊ instead of * and ２０２６ instead of 2026 -
// visually identical, entirely different characters. Zero-width characters go the same way: they
// are invisible, so they can only ever be an accident.
export const clean = value => String(value == null ? '' : value)
  .normalize('NFKC')
  .replace(/[\u200b-\u200d\ufeff]/g, '')
  .trim()
  .replace(/^(['"])([\s\S]*)\1$/, '$2')
  .trim();

export const accessConfigured = () => clean(process.env.ACCESS_CODE).length > 0;

export function codeAccepted(provided) {
  const expected = clean(process.env.ACCESS_CODE);
  if (!expected) return true;
  const given = clean(provided);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// Returns true when the caller may continue; otherwise answers the request itself.
//
// The code normally rides in the x-access-code header, and a header can only carry ASCII bytes -
// anything else is mangled before it ever reaches here. POST routes therefore also accept the code
// in the JSON body, which is UTF-8 and survives whatever the keyboard produced. An empty string
// falls back to the header so a body built without the field cannot lock anyone out.
export function guard(req, res, code) {
  const fromBody = code == null ? '' : String(code);
  const provided = fromBody.length ? fromBody : req.headers['x-access-code'];
  if (codeAccepted(provided)) return true;
  res.status(401).json({ error: 'That access code is not right.', needsCode: true });
  return false;
}

// Reporting the *shape* of a value rather than the value itself. This is what makes a rejected
// code diagnosable without printing the secret onto a screen or into a log.
function shape(value) {
  const raw = String(value == null ? '' : value);
  const trimmed = raw.trim();
  return {
    characters: raw.length,
    afterTrimming: trimmed.length,
    hasLineBreakOrTabInside: /[\r\n\t]/.test(trimmed),
    wrappedInQuotes: trimmed.length > 1 && /^(['"])[\s\S]*\1$/.test(trimmed),
    hasNonAsciiCharacters: /[^\x20-\x7e]/.test(raw),
  };
}

// Explains, in plain words, why a code was turned away. The comparison itself stays in
// codeAccepted() so this can never become a second, weaker door.
export function accessReport(provided) {
  const stored = shape(process.env.ACCESS_CODE);
  const expected = clean(process.env.ACCESS_CODE);
  const given = clean(provided);
  const received = shape(provided);
  const configured = expected.length > 0;
  const match = codeAccepted(provided);
  // True when the arriving text was not plain ASCII, or was full-width: the classic signature of a
  // keyboard sitting in full-width mode. Reported before the comparison, because it describes what
  // travelled rather than whether it happened to be right.
  const receivedLooksFullWidth = received.hasNonAsciiCharacters
    || given !== String(provided == null ? '' : provided).trim();

  let hint;
  if (!configured) {
    hint = 'No code is configured for this deployment, so nothing is being checked.';
  } else if (match) {
    hint = 'This code works.';
  } else if (received.afterTrimming === 0) {
    hint = 'The page sent nothing. Clear the box, type the code, and open the studio.';
  } else if (receivedLooksFullWidth) {
    hint = 'What arrived contains non-ASCII or full-width characters — a ＊ instead of *, or ２０２６ instead of 2026. A keyboard in full-width mode produces exactly this. Switch the input method to half-width, or use a code made only of letters and digits.';
  } else if (stored.hasLineBreakOrTabInside) {
    hint = 'The saved code has a line break or tab inside it, which usually means a pasted value swallowed the line after it. Delete the variable in Vercel, add it again, and type the code by hand.';
  } else if (stored.wrappedInQuotes) {
    hint = 'The saved code is wrapped in quote marks. Remove them in the Vercel variable.';
  } else if (stored.hasNonAsciiCharacters) {
    hint = 'The saved code contains non-ASCII characters, which cannot survive a request header. Save it as letters, digits and dashes only, then redeploy.';
  } else if (expected.length !== given.length) {
    hint = 'Different lengths: the page sent ' + given.length + ' characters and the saved code has ' + expected.length + '. Look for a missing or extra character.';
  } else {
    hint = 'Same length, different characters. The code is compared exactly, so case matters — and a saved password filled in by the browser looks identical to a typed one. Clear the box and type it yourself.';
  }

  return {
    configured,
    match,
    hint,
    receivedLooksFullWidth,
    received,
    stored,
    // Which deployment answered. A variable added only to Production is invisible to a preview
    // URL, so this is the quickest way to catch a code that is set in the wrong environment.
    deployment: {
      environment: process.env.VERCEL_ENV || 'local',
      url: process.env.VERCEL_URL || null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    },
  };
}
