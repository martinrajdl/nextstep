# Working in Nextstep

Nextstep is a local job-search CRM. Read `README.md` before changing or running it. For job collection or imports, follow `JOB-FINDER.md` and the relevant file in `prompts/`.

## Protect the user's workspace

- Personal jobs, profile, résumé, and research belong under ignored `data/`. Runtime logs live in `.runtime/`. Never commit these or use them as public fixtures/screenshots.
- Preserve the existing database and user decisions. Do not run demo seeds or destructive migrations against it. If an established database is missing, investigate the configured path instead of creating a replacement.
- Use the provided importer for additive collection. Read current context before each run, deduplicate all stages and removed records, and prepend only new Prospects. Existing stages, notes, priorities, and order belong to the user.
- Do not infer permission to apply or contact employers from a request to research or import jobs.

## Architecture and commands

- `app/` and `components/`: React interface; `lib/model.ts`: shared UI types and stage labels.
- `server/store.mjs`: SQLite schema, validation, migrations, transactional writes, optimistic versions, activity and imports.
- `server/job-identity.mjs`: import identity normalization; `server/config.mjs`: shared database path resolution.
- `server/index.mjs`: loopback HTTP API and production assets. Preserve Host/Origin checks and loopback binding.
- `scripts/setup.mjs`: non-destructive initialization; `scripts/job-finder.mjs`: context/import CLI.
- `pnpm dev`: UI 4317 and API 4318. `pnpm build` then `pnpm start`: production 4317. Avoid launching a second server on the user's occupied port.

Use pinned dependencies and keep `pnpm-lock.yaml` in sync. Tests use temporary databases. Run `pnpm test`, `pnpm build`, and `pnpm lint` for relevant changes; UI changes also require `pnpm test:e2e` and a visual check. Install Playwright Chromium first, or set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. Browser tests always use their own database on port 4321.

Schema changes need migration coverage that proves existing records and activity survive. Import changes need coverage for duplicate identities, Uninterested/Interested/Applied decisions, removed records, ordering, and repeat imports. Use fictional company names and example.com URLs in fixtures.

Before publishing a contribution, inspect the exact staged file list and diff for personal data, credentials, database files, screenshots, logs, or absolute home-directory paths. Keep generic templates public and completed profiles private.
