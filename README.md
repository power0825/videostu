# EVERKNIT Video Studio — online

The video workflow from the classroom studio, rebuilt so it can run on Vercel.

**Brief in, four-shot film out.** The page plans four shots with a text model, draws one keyframe
per shot with an image model, turns each keyframe into a clip, then stitches the four clips into a
single 15-second film with ffmpeg — all in the cloud, with no database.

| | |
|---|---|
| **What it is** | A teaching tool. The point is that a student can watch a commercial film get built one decision at a time, and edit every prompt along the way. |
| **What it is not** | Not a production system. There are no accounts, no history, no quotas and no cost ledger. Project state lives in the browser. |
| **Companion** | The full classroom studio stays where it is and is untouched by this app. |

---

## How the flow works

```
  brief + reference photo
        │
        ├─ POST /api/storyboard   →  four shots: script, frame prompt, motion prompt, caption
        │
        ├─ POST /api/keyframe     →  one still per shot  (stored in Blob, returns a URL)
        │
        ├─ POST /api/clip         →  submits a video task, returns a task id
        ├─ POST /api/clip-status  →  polled every 8s; on success the clip is re-hosted to Blob
        │
        └─ POST /api/export       →  ffmpeg trims, normalises and concatenates the four clips,
                                     burns in the captions and the ending card, returns a link
```

`GET /api/prompt` returns the exact system prompt the planning model receives, so the class can read
it before generating anything.

Every route except `/api/prompt` is POST and every route checks the shared class code first.

---

## Deploy

```bash
cd Video_Studio_Cloud
npm install
npm run smoke          # see below — do not skip this
npx vercel             # first deploy, link the project
npx vercel --prod
```

Then, in the Vercel project:

1. **Storage → Blob → Create.** Vercel injects `BLOB_READ_WRITE_TOKEN` automatically; you never
   paste it by hand.
2. **Settings → Environment Variables** — add the rest from `.env.example`.
3. **Settings → Functions** — leave the default max duration. `vercel.json` already asks for 300s on
   `/api/export`, which is the Hobby ceiling.

If you deploy this as a subdirectory of an existing repository, set **Root Directory** to
`Video_Studio_Cloud`.

### Environment variables

| Name | What it is |
|---|---|
| `ACCESS_CODE` | One code the whole class shares. Not a login — it exists so a leaked link cannot spend your credits. |
| `VOLCENGINE_API_KEY` | Ark key. Plans the shots and draws the keyframes. |
| `VOLCENGINE_TEXT_MODEL` | The planning model, e.g. `doubao-seed-2-1-turbo-260628`. |
| `VOLCENGINE_IMAGE_MODEL` | The keyframe model, e.g. `doubao-seedream-4-5-251128`. |
| `BAILIAN_API_KEY` | Turns a keyframe into a moving clip. |
| `BAILIAN_BASE_URL` | Defaults to the endpoint the classroom studio uses. |
| `BAILIAN_VIDEO_MODEL` | e.g. `wan3.0-video`. |
| `CAPTION_FONT` | Font *name* for the burned-in captions. See the note below. |

**Set `ACCESS_CODE` before the link goes public.** With it unset the studio is open to anyone who
finds the URL, and every request spends real credits.

---

## Run the smoke test before you deploy

```bash
npm run smoke
```

This is the only step that cannot be checked by reading code. It builds four synthetic clips with
the *same ffmpeg binary the deployment uses*, feeds them through the export pipeline, and writes
`smoke-out/final.mp4` plus a still frame so you can look at it.

You want to see: 15.00s duration, `h264 1280x720 30/1`, `aac` audio, and a readable caption.
If the clips join and the caption is legible, the same code will work on Vercel.

---

## Things that will bite you

**Captions need a real font file.** The Linux runtime has almost none installed, and libass draws
empty boxes for a font name it cannot resolve. This app therefore ships `dejavu-fonts-ttf` and
points ffmpeg's `fontsdir` at a copy inside the working directory. To use your own font, drop a
`.ttf` at `fonts/caption.ttf` or set `CAPTION_FONT_FILE`.

**A function's disk is wiped when it returns.** Everything the export writes goes to `/tmp` and the
finished file is uploaded to Blob before the function ends. Nothing is written inside the project.

**The export is one long request, not a background job.** The page waits for it — up to five
minutes. Background work registered with `waitUntil` would be faster to return but is best-effort
only: under Fluid compute it completes when another request happens to keep the instance warm and
vanishes otherwise, which is far harder to diagnose than a slow request. If the export ever needs to
outlive a single invocation, move it to Vercel Queues or a Workflow.

**The request body limit is 4.5MB.** That is why the browser shrinks the reference photo to 1600px
before sending it, and why generated clips are passed around as URLs rather than as bytes.

**Clips are re-hosted after generation.** Provider links expire; the copy in Blob does not.

---

## Limits, on purpose

- No accounts, no history, no quotas, no cost ledger.
- The film is always four shots of 3/4/3/5 seconds — the export concatenates exactly those.
- One reference image per film; no music upload, no logo overlay.
- Project state is in `localStorage`. Clearing the browser forgets the film.

---

## Files

```
index.html          the page
app.js              everything the page does — no framework, no build step
styles.css
api/                one file per route
lib/prompts.mjs     the three prompts, including the six-step method
lib/shots.mjs       reads the model's reply into four shots
lib/render.mjs      the ffmpeg pipeline; argument building is pure and testable
lib/providers.mjs   Ark, Bailian and Blob
lib/handler.mjs     access check, body parsing, error shape
lib/access.mjs      the shared class code
scripts/smoke.mjs   the local end-to-end run
```
