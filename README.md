# PeptiKing HyperFrames + Codex

Run HyperFrames edits on your laptop using **GPT-6 Astra / Low reasoning through your existing ChatGPT login in Codex**. No OpenAI API key is required or used. Codex usage counts against the signed-in account's limits. Speech transcription runs locally with faster-whisper. Transcript text and video thumbnails go to Codex for planning; HyperFrames renders the validated plan and uploads the MP4 to PeptiKing.

Repository: https://github.com/mihai-ciorobitca/peptiking-hyperframe

## Install on the other Windows laptop

Install Git, Node.js 22+, Python 3.10+ and Chrome. Python 3.10 was verified in development. Your existing HyperFrames installation can stay; this package bundles pinned HyperFrames and Codex CLIs.

```powershell
git clone https://github.com/mihai-ciorobitca/peptiking-hyperframe.git
cd peptiking-hyperframe
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
notepad .env
```

Setup installs dependencies and downloads the multilingual `base` speech model for local CPU transcription. This is a one-time model download, not an API call. Setup does not start the worker or claim jobs. Retrying preserves `.env`.

Fill the **same Supabase values already used by your Borumi worker**:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_existing_supabase_service_role_key
```

The default export bucket is `shotstack`; use the website's `BORUMI_EXPORT_BUCKET` if different. Leave `HYPERFRAMES_MODEL=gpt-6-astra` and `HYPERFRAMES_REASONING_EFFORT=low` as supplied.

## Connect the existing ChatGPT account

The bundled Codex CLI checks the laptop's saved login. It does not copy credentials or control an already-open chat. If the CLI needs a login:

```powershell
npm run login
```

Sign in with the **same ChatGPT account you use on that laptop**. A ChatGPT web session alone is not a CLI login; this sign-in may still be needed. For a custom existing Codex home, set `HYPERFRAMES_CODEX_HOME` in `.env`. Never put `auth.json` in the repository. API-key authentication is rejected; there is no API fallback or model substitution.

After the website/database preparation below:

```powershell
npm run doctor
npm run smoke
npm run smoke:codex
npm start
```

- `doctor` checks saved ChatGPT login, runtime tools, local transcription dependencies, queue function and export bucket. It sends no prompt and claims no jobs. Login alone does not prove model access.
- `smoke` renders a local two-second 1080x1920 video with cuts, B-roll, captions and sound. No Codex call or upload.
- `smoke:codex` requests a tiny Astra/Low edit plan through your ChatGPT login. It uses Codex limits, without production data, queue jobs or uploads, and verifies account/model access.
- `npm start` processes only HyperFrames jobs. Keep the terminal open and laptop awake/online. Ctrl+C stops it. Run `npm start` again after rebooting; automatic startup is not installed.

## Website/database preparation (once)

Deploy the accompanying PeptiKing integration. The standalone repository includes `integration/peptiking.patch`, based on `integration/BASE_REVISION.txt`. It adds the selector, provider-aware job routing and migration. Borumi retains its existing workflow. The package contains no whole-site copy, media or credentials.

In the **PeptiKing website checkout**, apply only if these changes are not already installed:

```powershell
git apply --check C:\path\to\peptiking-hyperframe\integration\peptiking.patch
git apply C:\path\to\peptiking-hyperframe\integration\peptiking.patch
npm run typecheck
```

Deploy the website through its normal process. Apply `prisma/migrations/20260912150000_add_hyperframes_worker/migration.sql` through normal migration deployment **before submitting HyperFrames jobs**. Alternatively, for an existing Borumi installation, run the identical `queue.sql` once in Supabase SQL Editor. Do not apply both independently without reconciling Prisma migration history.

The existing `AiVideoEditJob` table, Borumi queue and progress/finish functions must already exist. This migration prevents Borumi from claiming HyperFrames jobs and grants the new queue function only to service-role callers. No OpenAI credential is needed on the website.

Then open **AI Studio → AI Editor → HyperFrames → Check editor connection**. Add a short video, request an edit and verify playback, sound and download. Connection checks verify laptop login and CLI; `smoke:codex` or a real edit verifies Astra access.

## Pull future updates

Stop the worker with Ctrl+C. Inside this checkout:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
npm run doctor
npm start
```

`.env`, the Python environment, rendered projects and login credentials are not tracked. Pulling preserves them. Resolve any tracked-file conflicts before retrying; do not force reset your work.

## Supported edits and operation

Main-video cuts; zoom/crop; full-frame silent B-roll with short fades; timed/translated captions; titles; speech/music levels; looped music; muted exports. Output is vertical 1080x1920, 30 fps, H.264 MP4. Source/output length and processing are limited to ten minutes. Start with short clips on slower laptops.

Word-by-word animation, dubbing, generated footage, retouching, exact font reproduction and main-scene crossfades are not implemented. Unsupported material requests produce errors. Revisions use the saved plan against original footage.

Editable projects/media remain in `projects/<job>-<attempt>/` and are not automatically deleted. The worker polls outbound: no incoming port, Borumi bridge or open HyperFrames UI is needed. Media hosts must be explicitly allowed in `HYPERFRAMES_MEDIA_HOSTS`. Set `CHROME_PATH` if browser discovery fails.

Codex receives context and thumbnails with a read-only sandbox, shell/apps/plugins/hooks disabled and user configuration ignored for planning. It returns validated timeline data; the worker generates HTML. The CLI retains its own authentication. Renderer/transcription processes do not inherit Supabase or OpenAI credentials.

## Verification

Development checks cover ChatGPT-authenticated Astra/Low planning, local transcription, real rendering, PostgreSQL queue isolation/permissions and plan validation. Website editor/dialog were checked at 1440, 834, 390 and 320 px with mocked queue responses. The other laptop and production connection still need the steps above.

Development tests: `npm ci`, then `npm test`. Tests use in-memory PostgreSQL-compatible PGlite, not production.

Official references:
- [Codex scripts and saved login](https://learn.chatgpt.com/docs/non-interactive-mode)
- [ChatGPT sign-in](https://learn.chatgpt.com/docs/auth)
- [HyperFrames CLI](https://hyperframes.app/docs/5-packages/cli)
- [Local transcription](https://github.com/SYSTRAN/faster-whisper)
