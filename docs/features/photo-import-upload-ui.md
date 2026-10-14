---
type: Feature
title: Photo Import Upload UI
description: The authenticated /import screen — a drag-and-drop, browse, or paste multi-photo picker with thumbnails, optional per-photo game counts, client-side validation, in-browser HEIC→JPEG conversion, an LLM-readiness gate, and an upload that navigates to the batch progress view.
tags: [web, import, ui, heic]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-14T18:22:41Z }
---

# Overview

`/import` is the entry point for turning photos of a physical shelf into catalog
rows. One screen collects many photos (drag & drop, browse, or paste), previews each one
locally before anything leaves the browser, lets the user optionally declare how
many games a photo contains, converts iPhone HEIC files to JPEG in the browser,
enforces the same limits the API enforces, and submits the batch to
[`POST /import/upload`](import-upload-api.md) with live upload progress. A
successful submit navigates to the batch progress view.

The screen is gated on LLM readiness: photo recognition needs a model, so when
no API key is configured the whole flow is visible but disabled with an
explanation, and manual entry stays reachable.

# Routes

| Route                        | Renders                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/import`                    | `(app)/import/page.tsx` (server) → `PhotoImportForm` (client). `force-dynamic`, `requireUser`, reads `GET /settings/llm` for the gate.                                                                                                                 |
| `/import/progress/[batchId]` | `(app)/import/progress/[batchId]/page.tsx` (server) → `ImportProgressView` (client). `requireUser`, `GET /import-jobs/batches/:batchId` + `GET /import-jobs?batchId=…`, then live per-photo progress. See [Import Progress UI](import-progress-ui.md). |

Manual entry (`/games/new`) is always reachable from the disabled state, so a
missing LLM key never blocks adding games by hand.

# Picker and validation rules

Pure helpers live in `apps/web/src/lib/import/selection.ts` (no side effects, so
a future test runner can cover them).

- **Types.** JPEG, PNG, WebP, HEIC/HEIF. A file is classified by extension
  **or** MIME, never MIME alone — an iPhone photo can arrive with an empty
  `File.type`, so `.heic`/`.heif` decides. `ACCEPT_ATTR` lists both MIME types
  and extensions.
- **Paste.** A `document`-level `paste` listener (registered once in
  `PhotoImportForm`) extracts image files from the event's `clipboardData`
  via `extractImageFiles` (pure helper in `selection.ts`) and feeds them to
  the same `addFiles` intake as drop and browse, so validation, HEIC
  conversion, previews and limits all apply. A clipboard without image files
  is ignored, so pasting text into the count fields is unaffected.
- **Count.** At most **50** photos per batch (`MAX_PHOTOS`).
- **Size.** At most **20 MB** per photo (`MAX_PHOTO_BYTES`).
- **No silent drops.** Over-limit or unsupported files are removed from the
  selection and listed in a `role="alert"` block with a per-file reason; the
  rest of the batch stays selected.
- **Optional declared count.** A per-photo numeric field; blank is valid. A
  value must be an integer `1`–`1000` or the field shows an inline error and the
  submit button is disabled. On submit, exactly one `declaredCounts` part is
  sent per uploaded photo (`buildDeclaredCounts`); blank becomes `''`, which the
  API parses as undeclared (`null`).
- **Thumbnails.** Raster photos preview immediately from
  `URL.createObjectURL` (`blob:`). Object URLs are revoked on remove and on
  unmount.
- **Removal.** Each row has a remove button; removing revokes its object URL.

# HEIC conversion in the browser

`apps/web/src/lib/import/heic.ts` wraps a dynamically imported `heic-to`
(`heic-to/csp` build only when a HEIC file is present, so it never weighs on the
initial bundle).

- `libheif` applies the container `irot`/`imir` transforms during decode, so the
  JPEG is upright without reading EXIF.
- The output is renamed `<base>.jpg` with MIME `image/jpeg`; this is mandatory
  because the API's `imageFileFilter` checks extension **and** MIME.
- Conversion runs at most 3 files at a time (`HEIC_CONCURRENCY`); each row shows
  a `converting` state, then a thumbnail, or an inline error.
- The `/csp` build avoids `unsafe-eval`/WASM. It still spawns a worker from a
  `blob:` URL, so the strict CSP (`apps/web/src/middleware.ts`) adds
  `img-src 'self' blob:` (thumbnails) and `worker-src 'self' blob:` (converter).
  No `'wasm-unsafe-eval'` is required with the `/csp` build.

# Readiness gate

The page reads `GET /settings/llm` (server-side) and passes a tri-state
`LlmReadiness` to the form:

- `enabled` — the picker is active; a quiet line notes that photos are sent
  to the configured LLM.
- `disabled` — `importEnabled` is false (no key). The dropzone is visible but
  `aria-disabled`, the file input is disabled, and a `role="status"` explanation
  links to `/settings` and `/games/new`.
- `unknown` — the settings read threw. Same disabled UI with a "try again"
  explanation; manual entry stays reachable.

The gate mirrors the API: `POST /import/upload` returns `503` before storing
anything when no LLM key is set. A key removed between page load and submit is
handled client-side with a clear `503` message.

# Upload and progress

`apps/web/src/lib/api/upload.ts` posts via `XMLHttpRequest` (not `fetch`) so the
browser reports `upload.onprogress`. The multipart shape mirrors the API client:
repeated `files` parts, then one `declaredCounts` part per photo. No
`content-type` header is set — the browser supplies the multipart boundary. The
same-origin `/api` rewrite carries the session cookie.

While `submitting`, the shared `ProgressBar`
(`apps/web/src/components/progress-bar.tsx`) and a `role="status"` line render
through three phases, derived by `lib/import/upload-status.ts`:

1. **Before the first progress event** — and whenever the browser reports a
   non-computable size: indeterminate. A `w-1/3` accent segment bounces between
   the `bg-edge` track's edges and the bar carries no `aria-valuenow`. It shows
   from the click itself, so the form never looks frozen while the request
   starts.
2. **Bytes in flight:** a determinate fill at `floor(loaded / total × 100)`% and
   the line "Uploading… N%". The percentage is floored, so 100% never shows
   while a byte is still in flight.
3. **Every byte sent, waiting for the `202`:** indeterminate again, with the
   status line and the button reading "Starting the import…". The API writes
   each photo and creates its job row before responding, so this wait is real.

The submit button stays disabled for the whole of it. On success the form
**stays busy**: `router.push` returns immediately, so the button, the paste
guard and the drop guard remain blocked until the progress page replaces the
form — a duplicate batch cannot be started mid-navigation. If that client
navigation never lands, a 15-second fallback timer (and the in-flight ref
the submit checks) re-enables the form so it cannot stay blocked for good.
The form navigates to `/import/progress/<batchId>` and records the batch id
under `localStorage` key `gameshelf.lastImportBatchId`, so a return visit to
`/import` shows a **Check your most recent import** link. A `401` redirects
to `/login` without re-enabling the form; other errors clear the bar, show a
`role="alert"` message and re-enable the button.

# Accessibility

Real labels, `aria-invalid`/`aria-describedby` on count fields, `role="alert"`
for rejections and errors, `role="status"`/`aria-live` for upload progress, a
focus-visible ring on the dropzone (`focus-within`), and `motion-reduce:` on all
transitions. The dropzone is a `<label>` wrapping a visually hidden
`<input type="file" multiple>`.

- The upload progressbar carries `aria-valuemin`/`aria-valuemax` always and
  `aria-valuenow` only while the value is known — the indeterminate phases omit
  it. Its moving segment is decorative (the bar's children are presentational,
  so they need no ARIA).
- The live `role="status"` line announces **phase changes** ("Uploading…" →
  "Starting the import…") only; the percent is `aria-hidden`, because screen
  readers get the number from the progressbar's `aria-valuenow`.
- Under `prefers-reduced-motion` nothing animates: the indeterminate segment
  renders as a static full-width full-strength `bg-accent` track
  (`motion-reduce:animate-none`), a `busy` determinate fill keeps full
  strength instead of muting (`motion-reduce:bg-accent`), and the width
  transition is off (`motion-reduce:transition-none`).

# Backend contract

This screen enforces **20 MB / 50 photos**, matching the API after the ticket
6.1 limit bump: `MAX_UPLOAD_FILES = 50`, `MAX_UPLOAD_FILE_SIZE_BYTES = 20 MB`
(`apps/api/src/import-jobs/upload.options.ts`). The API still accepts only
JPEG/PNG/WebP; HEIC is converted client-side first.

# Manual acceptance script

Setup:

```bash
cp .env.example .env      # fill SESSION_SECRET (>=32 chars), DB; leave CUSTOM_API_KEY commented for step 3
docker compose up -d mysql
npm run db:deploy
npm run dev               # API :3001, web :3000
```

1. **Gate off (no key).** With no LLM key configured, open
   `http://localhost:3000/import`. Expect the dropzone **visible but disabled**,
   an explanation that no LLM key is set, and a working "Add a game by hand"
   link to `/games/new`. Expect no upload button enabled.
2. **Manual entry still works.** From `/import`, follow "Add a game by hand",
   save a game, confirm it lands in the catalog.
3. **Gate on.** In `/settings` save a base URL, model and API key for your
   OpenAI-compatible endpoint (or `PUT /api/settings/llm`). Reload `/import`;
   expect the picker enabled.
4. **Multi-select + thumbnails.** Browse and select several JPEG/PNG/WebP files
   at once. Expect one thumbnail per photo, each with a filename, size and
   optional count field.
5. **Drag & drop.** Drop the same set onto the dropzone. Expect the same
   thumbnails; the highlight appears on `dragover`.
   5b. **Paste.** Copy a screenshot (or an image file in Finder/Explorer) and
   press ⌘V / Ctrl+V anywhere on the page — including with a count field
   focused. Expect the photo to appear with a thumbnail, exactly like a
   drop. Paste plain text into a count field — expect normal text pasting
   and no photo added. With the gate disabled, pasting an image adds
   nothing.
6. **Remove.** Remove one photo. Expect it to disappear and the ready count to
   drop; its object URL is revoked.
7. **Optional count.** Leave all counts blank and upload — expect `202` and
   navigation (step 9). Then do a second upload with a count on one photo and
   blanks elsewhere; expect `202` and that photo's row carrying the number in
   the progress API.
8. **Submit + progress.** Throttle the network (DevTools → Network → Slow 3G)
   and upload several photos. Expect the bar to appear immediately with a
   bouncing segment and "Uploading…", then an increasing percentage, then
   "Starting the import…" once the bytes are sent, with the button disabled the
   whole time — the screen must not look frozen. Expect the request body field
   name `files` and one `declaredCounts` per photo.
9. **Navigation.** On success, land on `/import/progress/<batchId>` with an
   "X of Y photos processed" line. Reload the URL; expect it still resolves
   (reload-safe).
10. **HEIC conversion.** Select an iPhone `.HEIC` file (portrait). Expect: a
    thumbnail renders (converted JPEG), the Network request payload part is
    `image/jpeg` with a `.jpg` filename (never `.heic`), and the orientation is
    upright.
11. **Orientation.** A portrait iPhone HEIC must render and upload upright
    (compare against the Photos app).
12. **Limits with messages.** Select a file > 20 MB → per-file message, the rest
    of the batch stays. Select > 50 files → a message "Only 50 photos can be
    imported at once"; the first 50 stay selected and nothing is silently
    dropped.
13. **HEIC with empty MIME.** Verify a `.heic` file whose `File.type` is `''` is
    still accepted (extension decides).
14. **CSP.** With the picker and a HEIC conversion, the console must show **no**
    CSP violations for `worker-src`, `img-src` or WebAssembly.

# Out of scope

- The LLM settings screen itself — see [LLM Settings UI](llm-settings-ui.md);
  the disabled gate links to the real `/settings` screen.
- A game-database (IGDB) readiness gate — the gate is LLM-only, mirroring the
  upload endpoint.
- A privacy statement distinguishing a local vs remote LLM endpoint.
- Server-side HEIC decoding, image downscaling, and raster EXIF-orientation
  normalization.
- A browser-level (Playwright/Cypress) test runner — pure helpers are covered by `node --test` (`apps/web/test/`).
