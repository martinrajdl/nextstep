# Working in Nextstep

Nextstep is a local composable CRM operated by agents and reviewed by people. Read `README.md` before changing or running it. For the data model and agent contract, read `docs/composable-crm.md`.

## Protect the user's workspace

- Personal records, profiles, files, and research belong under ignored `data/`. Runtime logs live in `.runtime/`. Never commit these or use them as public fixtures/screenshots.
- Preserve the existing database and user decisions. Do not run demo seeds or destructive migrations against it. If an established database is missing, investigate the configured path instead of creating a replacement.
- Agents must read current context, verify sources, deduplicate records including archived identities, and preview changes before proposing them for review. Existing values and user decisions must be preserved.
- Explicit preferences take precedence over inferred interests. Do not infer permission to send messages, submit forms or create schedules from a request to research or organize information.
- Compatibility workflows and their data must keep working. Their local instructions are preserved under ignored `data/private-workflow/`; they are not public product examples. Keep existing bounded connectors and write permissions intact.
- Public copy, onboarding, documentation, release notes and screenshots describe only the general CRM. Never promote a maintainer's personal workflows or origin story. New installations start empty, without built-in personal workspaces.

## Composable workspace

- Generic collections, records, views, proposals and history live in additive `crm_*` tables in the same SQLite file. `server/crm-store.mjs` owns validation and atomic change sets.
- `app/workspace.tsx`, `app/workspace.css`, `components/crm/` and `lib/crm.ts` implement the generic workspace. Navigation lists only workspaces present in the selected database.
- `mcp/crm-stdio.mjs` is the general CRM connector. It proposes by default; direct writes require explicit `--allow-writes`. Keep compatibility connectors bounded.
- `server/crm-flows.mjs` records agent-reported progress and derives applied counts from real change sets. Progress reporting must never approve proposals or mutate records.
- Electron remains the primary app. `desktop/preferences.mjs` preserves appearance and backend selection; self-hosted mode serves the bundled renderer and proxies JSON API requests through a loopback SSH tunnel without opening a local shadow database.
- Read `docs/composable-crm.md` before changing the generic model, and `docs/self-hosting.md` for private server deployment. Do not weaken loopback or Host/Origin restrictions.
- The public website has its own Git repository. Do not add marketing build tooling or public deployment configuration here.

## Architecture and commands

- `app/` and `components/`: React interface; `lib/model.ts`: shared UI types and stage labels.
- `server/store.mjs`: SQLite schema, validation, migrations, transactional writes, optimistic versions, activity and imports.
- `server/config.mjs`: shared database path resolution.
- `server/http.mjs`: reusable loopback HTTP API and production assets; `server/index.mjs`: standalone entrypoint. Preserve Host/Origin checks and loopback binding.
- `desktop/main.mjs`: sandboxed Electron window and local service. `mcp/stdio.mjs` and `mcp/server.mjs`: separate local helper with bounded research tools and an explicit database path.
- `server/context.mjs` and `server/agent-instructions.mjs`: current board context and provider-native scheduling handoff. Saving setup choices or recording a task ID does not create or verify a schedule.
- `scripts/setup.mjs`: non-destructive initialization; `scripts/crm.mjs`: context, query and proposal CLI.
- `pnpm dev`: UI 4317 and API 4318. `pnpm build` then `pnpm start`: production 4317. Avoid launching a second server on the user's occupied port.

Use pinned dependencies and keep `pnpm-lock.yaml` in sync. Tests use temporary databases. Run `pnpm test`, `pnpm build`, and `pnpm lint` for relevant changes; UI changes also require `pnpm test:e2e` and a visual check. Install Playwright Chromium first, or set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. Browser tests always use their own database on port 4321.

Schema changes need migration coverage that proves existing records and activity survive. Import changes need coverage for duplicate identities, existing decisions, removed records, ordering, and repeat imports. Use fictional names and example.com URLs in fixtures.

For desktop changes, install the runtime with `pnpm exec install-electron`, build the interface, and run `pnpm test:desktop`. After packaging, repeat the desktop check with the packaged executable as its argument. Never include `data/`, `.runtime/`, personal settings, or research in a bundle; `scripts/package-desktop.mjs` stages an explicit set of application files. See `docs/desktop.md` for the connection and packaging contract.

For signed macOS distribution, follow `docs/macos-signing.md`. Use an explicitly selected Developer ID Application identity and a local notarytool Keychain profile. Never substitute an Apple Development or ad-hoc signature, disable verification, or claim notarization from a successful local launch alone. Keep credentials and private keys out of Git and app bundles.

Before publishing a contribution, inspect the exact staged file list and diff for personal data, credentials, database files, screenshots, logs, or absolute home-directory paths. Keep generic templates public and completed profiles private.
