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
2. **Settings → Environments** — add the rest from `.env.example`. The Vercel dashboard renamed
   "Environment Variables" to **Environments**; the docs still say the old name, so look for
   **Environments** in the project settings sidebar and use **Add New** there.
3. **Settings → Functions** — leave the default max duration. `vercel.json` already asks for 300s on
   `/api/export`, which is the Hobby ceiling.

**Adding a variable does not affect the running deployment.** Vercel configuration is fixed when a
deployment is built, so you have to redeploy after changing anything here. This catches everyone
once.

### What to add

**Only four are needed.** Everything else has a working default in the code, so you can skip it
unless you are overriding something.

| Name | Value | Type | Needed? |
|---|---|---|---|
| `VOLCENGINE_API_KEY` | your Ark key | **Secret** | **yes** |
| `VOLCENGINE_TEXT_MODEL` | `doubao-seed-2-1-turbo-260628` | Config | **yes** — the only model with no default |
| `BAILIAN_API_KEY` | your Bailian key | **Secret** | **yes** |
| `ACCESS_CODE` | a code you invent — see below | **Secret** | **yes, before the link is public** |
| `VOLCENGINE_IMAGE_MODEL` | defaults to `doubao-seedream-4-5-251128` | Config | optional |
| `BAILIAN_BASE_URL` | defaults to the classroom endpoint | Config | optional |
| `BAILIAN_VIDEO_MODEL` | defaults to `wan3.0-video` | Config | optional |
| `CAPTION_FONT` | defaults to `DejaVu Sans`, which matches the bundled font | Config | optional |

`BLOB_READ_WRITE_TOKEN` is **not** on the list on purpose: creating a Blob store injects it for you.

The dialog accepts a pasted `.env` block (there is an **Import .env** button and a "paste .env
contents in Key input" hint), so the quickest version is one paste:

```
ACCESS_CODE=everknit-pique-2026
VOLCENGINE_API_KEY=<your Ark key>
VOLCENGINE_TEXT_MODEL=doubao-seed-2-1-turbo-260628
BAILIAN_API_KEY=<your Bailian key>
```

Set **Environments** to Production. If you would rather the three secrets stay unreadable in the
dashboard afterwards, add those separately with **Type = Secret** instead of bulk-pasting them.

Scope to **Preview** as well if you want preview URLs to work — a variable scoped only to Production
is invisible to `vercel dev`, which reads Development.

Same thing from the CLI:

```bash
npx vercel env add ACCESS_CODE production
npx vercel env add VOLCENGINE_API_KEY production
npx vercel env add VOLCENGINE_TEXT_MODEL production
npx vercel env add BAILIAN_API_KEY production
npx vercel env pull          # bring them into .env.local for local development
npx vercel --prod            # variables only take effect on a new deployment
```

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

## The class code

Nothing generates this. **You invent it.** It is a single shared password for the whole class, and
it is the only thing standing between a public URL and your model credits.

1. Pick something not worth guessing but easy to read out loud — `everknit2026`, not `1234`.
   **Letters and digits only.** Punctuation is where this goes wrong: `*` is Shift+8, and a keyboard
   in full-width mode produces `＊` (U+FF0A) instead — visually identical, a different character. The
   server folds full-width forms onto their ASCII originals, so both now work, but a code nobody can
   mistype is a code nobody has to be rescued from.
2. Put it in `ACCESS_CODE`. **The CLI is the reliable way** — the dashboard keeps renaming and
   regrouping these screens (as of late 2026 the sidebar has "Environments", which manages
   production/preview/custom *deployment environments*, not variables):

   ```bash
   cd Video_Studio_Cloud
   npx vercel env add ACCESS_CODE production --visibility config
   npx vercel env pull          # brings it into .env.local for local development
   ```

   **`--visibility config` is not optional in spirit.** `vercel env add` defaults to **Secret** for
   Production, and a Secret is write-only: after saving, no member can read it back — not in the
   dashboard, not through the CLI. `vercel env pull` writes the placeholder `[SENSITIVE]` in place of
   the value. This code is a classroom door, not a credential, so store it as Config and keep the
   ability to look it up when someone forgets it. The two API keys next to it should stay Secrets.

   In the dashboard, press <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> and type
   "environment variables" — the command palette jumps straight to the right screen without you
   having to find it in the sidebar.

3. **Redeploy.** A variable change never reaches an already-running deployment: Vercel fixes the
   configuration when it builds. `npx vercel --prod` or Redeploy from the Deployments tab.

4. Give it to the class once. Each student types it on their first visit; the browser remembers it.

### Reading the value back

```bash
npx vercel env pull .env.local --environment=production
node -e "const t=require('fs').readFileSync('.env.local','utf8');const m=/^ACCESS_CODE=(.*)$/m.exec(t);console.log(m?JSON.stringify(m[1])+'  (length '+m[1].length+')':'ACCESS_CODE is not set in production')"
```

`JSON.stringify` is the point: it turns a trailing space, a stray quote or a pasted line break into
something visible. If the output is `"[SENSITIVE]"`, the variable is a Secret and the real value
cannot be recovered — delete it and add it again as Config.

**The values in `.env.example` and in this file are examples, not defaults.** `ACCESS_CODE` has no
built-in fallback: whatever you set is the only code that works.

How it behaves:

| `ACCESS_CODE` | What happens |
|---|---|
| **unset** | The page opens straight away and asks for nothing. Fine for `vercel dev`, dangerous in public: every request from anyone is accepted. |
| **set** | The page asks for the code and rejects every other value (compared with a constant-time check). |

Change it later and everyone who already entered the old code is asked again — nothing else is lost,
because no accounts exist to break.

The page decides whether to show the door by calling `POST /api/prompt` on load: a `401` means a code
is expected, a `200` means there is none. So the two can never drift out of sync.

**The code travels in the request body, not only in the header.** A header can carry ASCII bytes and
nothing else, so anything else is mangled before the server can see it — which turns a correct
full-width keystroke into a rejection with no visible cause. Every route accepts the code in the JSON
body (`accessCode`), which is UTF-8, and falls back to the `x-access-code` header when the body does
not carry one. Before comparing, both sides are normalised: NFKC folds full-width forms onto ASCII,
and zero-width characters are dropped.

### If the code is rejected

Under the field there is a **"Not working? Check the code"** link. It asks the server what the two
values look like and explains the difference in plain words. It reports their lengths and a few
common paste artefacts — never the values themselves — so it is safe to press during a session.

From a terminal, the same answer without a browser:

```bash
curl -s https://your-app.vercel.app/api/access-check
curl -s -H "x-access-code: the-code-you-typed" https://your-app.vercel.app/api/access-check
```

The `deployment.environment` field in the reply is worth reading first: a variable added only to
**Production** is invisible to a **preview** URL, which produces exactly this symptom.

The four causes, in the order they actually happen:

| Cause | What the check says | Fix |
|---|---|---|
| A full-width keyboard (`＊` for `*`, `２０２６` for `2026`) | "What arrived contains non-ASCII or full-width characters" | Switch the input method to half-width. The server already folds full-width onto ASCII, so a redeploy may be all this needs |
| The variable was saved **after** the last build | `configured: false`, or lengths that match neither value | Redeploy — saving a variable never reaches a deployment that already exists |
| A pasted value swallowed the following line | "has a line break or tab inside it" | Delete the variable, add it again, **type** the code |
| Added to Production, browsing a preview URL | `deployment.environment: "preview"` | Add it to Preview too, or use the production URL |
| A typo or a case difference | "Same length, different characters" | Compare the two lengths in the reply |

Surrounding whitespace and the quote marks from a `.env` file are stripped before comparing, so those
two never cause a rejection.

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
lib/access.mjs      the shared class code, and the "why was it rejected" report
scripts/smoke.mjs   the local end-to-end run
```
