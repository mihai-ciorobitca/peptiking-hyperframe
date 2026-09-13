# PeptiKing HyperFrames + Codex

Run HyperFrames edits on your laptop using **GPT-6 Astra / Low reasoning through your existing ChatGPT login in Codex**. No OpenAI API key is required or used. Codex usage counts against the signed-in account's limits. Speech transcription runs locally with faster-whisper. Transcript text and video thumbnails go to Codex for planning; HyperFrames renders the validated plan and uploads the MP4 to PeptiKing.

Repository: https://github.com/mihai-ciorobitca/peptiking-hyperframe

## All-in-one B-roll and background music

In the normal AI Edit prompt, ask for the whole job, for example:

> Create two relevant cinematic B-roll clips, choose fashion background music from Pixabay, add English captions, keep my voice clear, and assemble the finished vertical video.

Astra plans the missing assets, the existing Google Flow service generates up to six clips, Astra selects a track from Pixabay's fashion search using track metadata, and HyperFrames assembles the result. Uploaded assets are preserved. Explicit requests for no music/no new footage are passed to the planner; muted output never triggers a music download. Simple trim/caption fixes and revisions should not acquire unrequested assets.

**For this PeptiKing installation, the existing Flow connection has been provisioned in encrypted Supabase Vault.** The worker retrieves it using its existing Supabase login; no additional keys are needed on the laptop. Other installations must apply `asset-connection.sql` and provision a Vault secret named `peptiking_hyperframes_flow`, containing a JSON object with `url` and `key` for their existing Flow service. Only `service_role` can call the connection function. Optional `FLOW_API_URL`/`FLOW_API_KEY` worker environment overrides are supported.

Google Flow generation uses the existing service's generation allowance. Astra asset planning, music selection, edit planning and any timing repair use the signed-in Codex account's allowance. Pixabay music is downloaded through its normal Free download control. Source title, creator, URL, license link and download date are saved in `music-source.json`; the unmodified track stays local, not published as a standalone music file. New B-roll and music provenance are retained with the project for revisions. Keep the original project folders on this laptop if you want to reuse their soundtracks.

If Pixabay asks for login or verification, stop the worker and run `npm run music:open`, complete the prompt yourself, close that browser, and restart. No verification is bypassed. `HYPERFRAMES_AUTO_ASSETS=false` disables asset acquisition. `npm run smoke:assets` tests Astra's asset planning without generating footage or downloading music.

The overall edit still has a ten-minute processing limit, including generation and rendering; begin with short videos and one or two generated clips. A failed generation cancels known pending Flow jobs; completed generated clips remain in B-Roll Creator. If a submission times out before returning an id, check B-Roll Creator before retrying to avoid duplicate generations.

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

Word-by-word animation, dubbing, retouching, exact font reproduction and main-scene crossfades are not implemented. New footage is generated through the separate Flow asset stage. Unsupported material requests produce errors. Revisions use the saved plan against original footage.

Editable projects/media remain in `projects/<job>-<attempt>/` and are not automatically deleted. The worker polls outbound: no incoming port, Borumi bridge or open HyperFrames UI is needed. Media hosts must be explicitly allowed in `HYPERFRAMES_MEDIA_HOSTS`. Set `CHROME_PATH` if browser discovery fails.

Codex receives context and thumbnails with a read-only sandbox, shell/apps/plugins/hooks disabled and user configuration ignored for planning. It returns validated timeline data; the worker generates HTML. The CLI retains its own authentication. Renderer/transcription processes do not inherit Supabase or OpenAI credentials.

## Verification

Development checks cover ChatGPT-authenticated Astra/Low edit and asset planning, local transcription, real rendering, PostgreSQL queue/connection permissions and plan validation. Flow submission/result/cancellation are tested with fixtures; the live Flow connection and owner project were verified read-only. The official Pixabay download flow was verified in a browser. Website editor/dialog were checked at 1440, 834, 390 and 320 px with mocked queue responses. A complete generated-footage-plus-music edit on the other laptop still needs a live run.

Development tests: `npm ci`, then `npm test`. Tests use in-memory PostgreSQL-compatible PGlite, not production.

Official references:
- [Codex scripts and saved login](https://learn.chatgpt.com/docs/non-interactive-mode)
- [ChatGPT sign-in](https://learn.chatgpt.com/docs/auth)
- [HyperFrames CLI](https://hyperframes.app/docs/5-packages/cli)
- [Local transcription](https://github.com/SYSTRAN/faster-whisper)
# Worker logs

The terminal shows UTC timestamps, worker ID, user email and ID, job ID, operation, attempt and elapsed seconds on each job log. Stage changes appear immediately; long-running stages repeat every 30 seconds. B-roll logs include the scene number, Flow job ID and provider status. Completion is logged only after the database accepts the result. Failures and any failure to update the database are logged separately.

Credentials and URLs are redacted from logs. Logs contain customer email addresses, so remove those before sharing publicly. Restart the worker after pulling updates to load the new logging code.
# Source video size

Source downloads default to 2048 MiB (2 GiB) per file, matching the website's default upload limit. Existing `.env` files inherit this default automatically. To override it, set `HYPERFRAMES_MAX_SOURCE_MB` to a whole number from 1 to 20480 and restart the worker. Downloads stream to disk; failed partial downloads are removed. Larger files still need enough local disk space and must finish within the job processing deadline. Caption-reference and other explicit asset limits remain separate.
# Live music verification

For a Google Flow service reporting `Flow did not select x1`, apply `integration/flow-radio-selection.patch` in the **Google Flow API repository on the Contabo machine**, then restart that API using its normal process manager. This patch waits for the selected radio state instead of immediately reading a potentially stale ARIA attribute. Updating the laptop worker alone does not update Contabo's browser automation.

`npm run smoke:music:live` tests the real Pixabay search, Astra track selection, native browser download and audio validation. It uses Codex limits and saves one track locally, but does not claim queue jobs, upload files or generate B-roll. Chrome opens visibly by default for this test; set `HYPERFRAMES_MUSIC_HEADLESS=true` to test headless mode.

Opening the search page alone does not verify downloads. If the live test reports a verification or DNS error, run `npm run music:open`, open a track and click **Free download** yourself. Complete any verification or login required by Pixabay. The worker cannot bypass verification or fix the laptop's network. You can also attach an MP3 you are licensed to use in AI Editor; supplied music skips Pixabay acquisition.

Generated footage requires the editing account's B-Roll Creator workspace to be unlocked. This is checked before music acquisition, so a missing workspace does not waste a music download attempt.


## Recovering a failed edit

Update and restart the worker before using AI Studio's recovery buttons.
Resume is available after asset preparation (planning, rendering or upload failures).
It uses the same job ID and the original attempt's local projects folder to restore
footage, generated B-roll, the transcript and soundtrack, then retries planning and
rendering. It does not regenerate assets. Keep the original projects folder on the
worker laptop. Missing or incomplete files cause an explicit failure; they never
trigger paid replacement generation. Earlier asset-stage failures require Restart.
Restart reruns the original payload from the beginning and can spend generation
allowance again. Neither action adds support for unsupported editing effects.
Run `npm run smoke` then `npm run smoke:recovery` to verify local restoration/rendering.
