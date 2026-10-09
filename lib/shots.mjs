// The model is asked for four shots, but it sometimes wraps the JSON in a markdown fence, adds a
// sentence in front of it, or leaves a trailing comma. Everything about reading that reply lives
// here so the API route stays thin and the parsing stays testable on its own.

export const DURATIONS = [3, 4, 3, 5];
export const SHOT_COUNT = DURATIONS.length;

const strip = (value) => (typeof value === 'string' ? value.trim() : '');

const capped = (value, max) => {
  const text = strip(value);
  return text ? text.slice(0, max) : '';
};

// Pulls the first balanced {...} out of a reply that has prose around it.
function firstObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '';
}

export function extractShots(reply) {
  const text = strip(reply);
  if (!text) return null;
  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    firstObject(text),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const parsed = JSON.parse(attempt);
        if (parsed && Array.isArray(parsed.shots)) return parsed.shots;
      } catch {}
    }
  }
  return null;
}

// Returns four shots with fixed durations. The film is always 15 seconds: the export step
// concatenates exactly these four clips, so the count and the lengths are not negotiable.
export function normaliseShots(reply) {
  const raw = extractShots(reply);
  if (!raw) throw Object.assign(new Error('The model did not return four readable shots. Try again.'), { status: 502 });
  if (raw.length !== SHOT_COUNT) {
    throw Object.assign(new Error(`The model returned ${raw.length} shots instead of ${SHOT_COUNT}. Try again.`), { status: 502 });
  }
  const shots = raw.map((shot, index) => {
    const source = shot && typeof shot === 'object' ? shot : {};
    const script = capped(source.script, 2000);
    const imagePrompt = capped(source.imagePrompt, 4000);
    const videoPrompt = capped(source.videoPrompt, 4000);
    if (!imagePrompt || !videoPrompt) {
      throw Object.assign(new Error(`Shot ${index + 1} came back without an image or motion prompt. Try again.`), { status: 502 });
    }
    return {
      index,
      title: capped(source.title, 120) || `Shot ${index + 1}`,
      duration: DURATIONS[index],
      script,
      imagePrompt,
      lastImagePrompt: capped(source.lastImagePrompt, 4000),
      videoPrompt,
      caption: capped(source.caption, 120),
    };
  });
  return shots;
}
