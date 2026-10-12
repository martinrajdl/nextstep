# Nextstep

A local-first Electron CRM operated by agents and reviewed by people. Give your agent a direction: it sources contacts and information, shapes collections and relationships, and keeps records moving. Follow its progress in **Agent flows**, review proposed changes, and keep your information in SQLite on your computer or your own backend.

Nextstep 0.4 brings composable collections and agent flows to the workspace at `/`. The existing job tracker remains at `/jobs`, preserving its pipeline, preferences, history and bounded job-research connector.

## A workspace for any structured information

- **Compose:** start with an empty template or define your own collection and typed fields. Link records across collections.
- **Review:** agents prepare and preview atomic change sets, then submit them for approval. Stale proposals cannot overwrite newer decisions.
- **Work:** table and board views, search, filters, sorting, saved views, archive/restore, and record history.
- **Connect:** a separate general-purpose MCP interface and JSON workbench. Trusted connections can explicitly opt into direct writes. No built-in model or hosted account.
- **Follow:** agent-reported sourcing, shaping and progress alongside verified proposal outcomes and applied changes.
- **Personalize:** white with light gray accents by default, with green, blue, violet, rose, slate or a custom accent in Settings and the native View → Appearance menu. The generated app icon keeps its neutral colors.
- **Own:** MIT source, complete generic workspace JSON export, local SQLite persistence, and [private self-hosting through SSH](docs/self-hosting.md).

Read [the composable CRM guide](docs/composable-crm.md) for the model, operations, MCP tools and migration contract. The public marketing website is maintained in a separate Git repository; this checkout only contains the CRM.

React + TypeScript, a small Node HTTP server, and SQLite, with an optional Electron desktop app and local MCP connection. No database account, cloud service, API key, or separate database daemon is needed to use the app. Agent-assisted research uses your own agent and its browsing access.

![Nextstep Kanban board with fictional test records](docs/images/board.png)

*Example board using fictional records. New installations start empty.*

## Desktop app

**[Download Nextstep for macOS (Apple silicon, ZIP)](https://github.com/martinrajdl/nextstep/releases/download/v0.4.0/Nextstep-0.4.0-macOS-arm64.zip)** · [All releases](https://github.com/martinrajdl/nextstep/releases)

For Macs with an M1 chip or later. Unzip the download and drag **Nextstep.app** into **Applications**. The app is signed with Developer ID and notarized by Apple. Open Nextstep to follow the setup wizard; no developer tools are needed.

To build from source, clone the repository, install dependencies, then run:

```sh
pnpm exec install-electron
pnpm build
pnpm desktop
# Build a self-contained app for this computer:
pnpm desktop:package
```

The packaged app includes SQLite and its runtime. New desktop installations start empty; **File → Open database…** connects an existing Nextstep database without copying it. `desktop:package` produces an unsigned development build. For a signed and notarized macOS release, configure your [Apple signing identity and Keychain profile](docs/macos-signing.md), then run `pnpm desktop:release`.

In **Job search**, a three-step **onboarding wizard** helps you describe the work you want, choose Codex or Claude Code, and connect your agent. On macOS, **Open setup in Claude Code / Codex** adds the connection and opens a new local conversation with the request already filled in. Claude opens its **Code** tab; Codex opens a local task in ChatGPT desktop or the Codex app. Confirm the Research folder if asked, review the request, and send it. Search on demand, or let the agent set up a recurring search with its native scheduler. You can skip setup and use the board manually, then resume from **Search agent**. Every run reads current preferences and uses **Interested / Uninterested** feedback to refine search and ranking. It preserves existing cards and never edits the app's code or interface.

Saving setup choices does not activate a task. The computer must be awake and the local agent app running for scheduled work; the Nextstep window can be closed. See **[desktop setup and limitations](docs/desktop.md)** for connection steps, packaging, and checks.

## Start in five minutes

Install **Node.js 24** and **pnpm 11.19.0**, then:

```sh
git clone https://github.com/martinrajdl/nextstep.git
cd nextstep
pnpm install --frozen-lockfile
pnpm run setup
pnpm build
pnpm background:start
```

Open **[localhost:4317](http://127.0.0.1:4317)** for the composable workspace. Choose **Job search** to open the preserved pipeline at `/jobs`. Both start empty on a new installation; the job board has no job type or search criteria selected. Setup creates `data/nextstep.sqlite`; running it again preserves your jobs and saved preferences. Follow the onboarding wizard, open **Search preferences**, or use the setup-agent prompt below to define what you want.

```sh
pnpm background:status
pnpm background:stop
pnpm background:restart
```

The background process survives closing the terminal. It does not install a login service; start it again after logging out or restarting your computer. `pnpm start` runs in the foreground. macOS also has **Open Nextstep.command** and **Stop Nextstep.command** launchers after installation and building. The Node commands are portable; the shell and `.command` launchers are for macOS/Linux.

## Your pipeline

- **Board and list:** drag between stages, reorder cards, search, filter follow-ups, or change stages from the list/editor. Keyboard dragging uses Space, arrows, and Space to drop.
- **Stages:** Uninterested → Prospects → Interested → Applied → Screening → Interview → Final round → Offer. Hide Uninterested when you want more room; its records remain in the list.
- **Closed:** Accepted, Rejected, and Withdrawn. When an employer rejects you, drag the card onto **Rejected**, which appears at the bottom of the active board during a drag. The card is saved under **Closed → Rejected**. For keyboard dragging, Arrow Down after the last card reaches this target; Arrow Up returns to your card and Escape cancels. Change the stage in the list/editor to reopen a closed record.
- **Company-first prospecting:** only a company name is required when adding manually. Fill in the role, job URL, salary, contact, notes, priority, and follow-up later.
- **Local history:** activity tracking, soft deletion with Undo, JSON export, and conflict protection when two windows edit the same job.
- **Shortcuts:** `N` creates an opportunity and `/` focuses search outside editable fields.

Follow-up dates use your local calendar. The app itself does not send reminders, contact employers, or submit applications.

## Let an agent populate it

Use an agent that can read local files, run commands, and browse employer career pages, such as Codex or Claude Code. Open this repository as its working directory, then paste one of these requests:

| Task | Request to give your agent |
| --- | --- |
| Install and configure | `Follow prompts/setup.md. Ask me what jobs I want and save my answers in the app's Search preferences.` |
| Find and save jobs | `Follow prompts/collect-jobs.md using my saved Search preferences. Save verified new matches to this CRM.` |
| Import an old shortlist | `Follow prompts/import-shortlist.md to import the shortlist I provide into this CRM.` |
| Search on a schedule | Use [prompts/recurring-search.md](prompts/recurring-search.md) as the task prompt in your local agent scheduler. Choose the schedule and timezone there. |

During setup, the agent asks **what kind of job you want**, along with location/eligibility, work arrangement, employment type, compensation, experience, company preferences, and exclusions. There are no built-in roles, industries, regions, or company types. You can leave optional criteria undecided.

Your answers are saved in **Search preferences inside the app**, backed by the same private SQLite database as your board. Edit them there at any time. Agents read the current preferences through the context command before searching. If the job type is undefined, they ask you to complete setup instead of choosing one for you.

For command-line setup, use `node scripts/job-finder.mjs profile get`, then `profile set data/search-answers.json` with the current version and your answers. [The blank JSON schema](templates/profile.example.json) documents the fields. See [JOB-FINDER.md](JOB-FINDER.md#save-the-users-setup-answers) for details. Existing private Markdown profiles are preserved but should be reviewed and transferred into app preferences once.

The agent reads existing **Uninterested**, **Interested**, and **Applied** records before researching. Interested and Uninterested choices refine search terms and ranking, with explicit preferences taking precedence over inferred patterns. All stages and removed records participate in duplicate checks. New matches go at the **top of Prospects**, with the best new match first. Existing stages, notes, priorities, and ordering are preserved. A company-only Uninterested card excludes the company; an uninterested specific role excludes that role.

Prompts are instructions for your agent, not a built-in crawler or autonomous AI service. Scheduled runs need a local agent with the MCP connection or this checkout and database available; a cloud-only scheduled chat cannot write to your local SQLite file. No schedule is enabled just by cloning this repo.

See **[JOB-FINDER.md](JOB-FINDER.md)** for the full collection and import contract.

## Import from the command line

```sh
node scripts/job-finder.mjs context
node scripts/job-finder.mjs import data/research/verified-jobs.json --dry-run
node scripts/job-finder.mjs import data/research/verified-jobs.json
```

Imports accept a JSON array or `{ "opportunities": [...] }`. Each job requires `company`, `role`, and `url`. [examples/opportunities.example.json](examples/opportunities.example.json) shows the format with clearly fictional data. It is never imported automatically.

The importer checks again inside a SQLite transaction, skips duplicates and previously removed jobs, and prepends only new Prospects. Re-running the same batch is safe. Its duplicate checks cover known requisition IDs, normalized company/title pairs, and URLs without tracking parameters. The agent should additionally catch reworded titles and duplicate regional listings. This is an additive prospect importer, not a full backup restore tool.

## Data, privacy, and backups

`data/` contains your SQLite database (including Search preferences), research, and any local résumé you choose to add. It is ignored by Git, along with logs, browser test artifacts, local environment files, and database files. Keep personal additions under `data/`; check staged files before publishing your own fork.

The app serves only on `127.0.0.1`, with Host/Origin checks. It has no shared accounts and is intended for one owner. Run it locally, or on your own server with a [private SSH tunnel](docs/self-hosting.md). Public source code does not make your running app or database public. Do not expose its unauthenticated HTTP port to the internet.

Agent prompts ask for public employer information and keep research local. Your chosen agent provider may still process the profile and board context it reads; Nextstep does not add a model or telemetry service of its own.

The download button exports Search preferences, active/closed opportunities, schedule registration, and recent search reports as JSON. For a complete source-checkout backup including removed records and activity, **stop the app and connected MCP helpers, then copy the `data` folder**. SQLite can have `-wal` and `-shm` companion files while running. Restore by stopping the app/helpers and replacing `data` with the complete backup. Desktop databases live in your application-data directory or the location you selected; see [desktop backups](docs/desktop.md#your-database). There is no full-backup import UI.

| Setting | Default | Notes |
| --- | --- | --- |
| `NEXTSTEP_DB_PATH` | `data/nextstep.sqlite` in this checkout | Shared by setup, server, and importer. Prefer an absolute path and set it consistently for every command. |
| `DB_PATH` | Unset | Legacy alias, used only when `NEXTSTEP_DB_PATH` is unset. |
| `PORT` | `4317` | Production server port. Development uses fixed UI/API ports. |
| `PLAYWRIGHT_CHANNEL` | Bundled Chromium | Set to `chrome` to test with installed Google Chrome. |

The scripts read the process environment; `.env` files are not loaded automatically. Search preferences live in the selected database, so the app and agent always share them when using the same path. Logs and background process details live in `.runtime/`.

## Development and checks

Node.js **22.13+** is required for built-in SQLite; Node 24 is recommended and used in CI.

```sh
pnpm background:stop        # if the production app is running
pnpm dev                   # Vite on 4317, API on 4318
pnpm build                 # Type-check and build
pnpm test                  # Store, import, migration, HTTP, setup, and MCP tests
pnpm lint
pnpm exec playwright install chromium
pnpm test:e2e              # Isolated temporary database on port 4321
```

Development and production use the same local database unless you configure a different one. Tests create their own temporary databases and never populate your personal pipeline. CI runs the same checks on Linux. For contributors, see [CONTRIBUTING.md](CONTRIBUTING.md); coding agents should read [AGENTS.md](AGENTS.md).

The UI optionally exposes `list_opportunities`, `create_opportunity`, and `move_opportunity` through WebMCP in supporting browsers. This is separate from the bounded local research MCP server, which cannot edit existing stages or run arbitrary commands. The app and file-based importer work without either connection.

## License

[MIT](LICENSE). Built with React, Vite, SQLite, dnd-kit, and shadcn/ui components. See [third-party notices](THIRD_PARTY_NOTICES.md).
