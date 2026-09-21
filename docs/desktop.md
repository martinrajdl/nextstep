# Desktop app and local agent connection

Nextstep bundles its interface, HTTP server, SQLite runtime, and a local MCP server in an Electron app. Your agent connects to Nextstep, researches jobs with its own browsing tools, and adds verified prospects. There is no model API key or external database service to configure in Nextstep.

## Build and run

From a checkout, with Node 24 and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm build
pnpm desktop
```

Package for your current operating system and architecture:

```sh
pnpm desktop:package
```

The runnable app is in ignored `desktop-releases/`. It includes its own runtime, so the person running the packaged app does not need Node or pnpm. Packaging stages only the compiled interface, bundled app code, and licenses. Personal databases, research, settings, and logs are excluded.

To choose another target after building the interface, run `node scripts/package-desktop.mjs <platform> <arch>`. Supported values are `darwin`, `win32`, or `linux`, and `arm64` or `x64`. The manual **Desktop builds** GitHub workflow builds on each operating system. Only macOS Apple silicon has been exercised with the full desktop smoke test so far.

These are unsigned builds. Distribution signing, macOS notarization, installers, and automatic updates are not configured. Move the app to its permanent location before copying its MCP connection settings: those settings contain the executable's absolute path.

## Your database

The first desktop launch creates an empty database in Electron's per-user application-data directory, normally `~/Library/Application Support/Nextstep/nextstep.sqlite` on macOS. Choose **File → Open database…** to use an existing Nextstep SQLite file. It is opened in place, not copied, and the app remembers the selection. A missing previously selected file is an error rather than a reason to create an empty replacement.

You can also launch the app with `--database /absolute/path/to/nextstep.sqlite`. The selected file must already exist. `NEXTSTEP_DB_PATH` and its legacy alias `DB_PATH` work too. `NEXTSTEP_USER_DATA` selects a separate desktop settings directory for development or tests.

The MCP connection always includes the selected database's absolute path. Your agent can run from another folder or a worktree without creating a second pipeline. When switching databases, update the agent connection and check its scheduled task as well.

For a full backup, stop the app and any connected MCP helpers, then copy the database and any SQLite `-wal`/`-shm` companion files together. A SQLite backup operation is also safe while the database is open. JSON export includes preferences, current opportunities, schedule registration, and recent search reports; it is not a full database backup.

## Connect and schedule

1. Fill in **Search preferences**, or let the setup agent ask what jobs you want. No role, region, company type, or work arrangement is assumed.
2. Open **Search agent**, choose **Codex / ChatGPT desktop** or **Claude Code Desktop**, and save a cadence and timezone. Saving choices does not activate a schedule.
3. Copy the connection settings into your agent's local MCP configuration. Preserve its other servers and restart or reconnect as that agent requires. Check that `nextstep_get_context` returns the intended database.
4. Copy the setup request into the selected agent. It asks for missing preferences, finds an existing task for this database or creates one using its native scheduler, and records the returned task ID in Nextstep.
5. Run the task once in the agent, review any tool permissions, and check that new cards and a search report appear. The open board refreshes automatically while you are not editing.

For CLI configuration, the equivalent commands are:

```sh
codex mcp add nextstep -- /absolute/path/to/Nextstep --mcp --database /absolute/path/to/nextstep.sqlite
claude mcp add --transport stdio --scope user nextstep -- /absolute/path/to/Nextstep --mcp --database /absolute/path/to/nextstep.sqlite
```

On macOS the executable is inside `Nextstep.app/Contents/MacOS/Nextstep`; on Windows it is `Nextstep.exe`. Quote paths containing spaces. The app generates the correct command and arguments for its current installation. A source checkout can instead run `node /absolute/path/to/checkout/mcp/stdio.mjs --database /absolute/path/to/nextstep.sqlite`.

The helper is a separate stdio process launched by the agent. It can read and populate the database while the Nextstep window is closed. No public MCP endpoint or relay is started. The HTTP interface binds only to loopback and the renderer has no Node access.

### What scheduling does and does not mean

MCP provides tools and context; it is not a universal API for controlling another app's scheduler. The setup request asks your connected agent to use its native local scheduling tools. Nextstep records the task ID the agent reports, but cannot independently verify whether that task is active, paused, or deleted.

Manage actual task status in the agent app. After changing the cadence in Nextstep, give the agent the updated setup request so it updates the existing task. Before switching providers or unlinking a registration, pause or delete the old task in its agent app. Unlinking in Nextstep does not stop it.

Local scheduled work requires an awake computer, a running agent app, and permission to use its browsing and MCP tools. A cloud-only scheduled chat cannot directly reach a local SQLite file. This setup targets local Codex tasks and Claude Code Desktop scheduled tasks; a generic ChatGPT web task or a remote Claude connector is not equivalent.

Official references checked September 21, 2026:

- [Codex MCP connections](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [OpenAI desktop automations](https://learn.chatgpt.com/docs/automations)
- [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp)
- [Claude Code Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)
- [Claude desktop and web connector differences](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors)

## How the search improves

Every run reads the current preferences, all stages, removed records, recent decisions, and past reports. **Interested** is positive feedback and **Uninterested** is negative feedback. The agent uses explicit reasons in notes where available and adjusts search terms and ranking. A declined role does not automatically exclude its whole company; a company-only Uninterested card does.

Explicit preferences always take precedence. Inferred adjustments stay tentative, with supporting opportunity IDs in a search report. Newer decisions can overturn an earlier inference. This is context-based refinement, not model training or an automatic rewrite of your saved preferences.

The research agent must never edit app code, the interface, existing notes, stages, priorities, or card order. It only imports verified new jobs at the top of Prospects and records search reports. Applied, Interested, Uninterested, other stages, and removed records all participate in duplicate checks. It does not submit applications or contact employers.

Your chosen agent provider processes the context it reads. Nextstep itself does not add a model or telemetry service.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `nextstep_get_context` | Read current preferences, pipeline, decisions, and recent search reports. Page activity with `afterActivityId`, `nextActivityCursor`, and `hasMoreChanges`. |
| `nextstep_save_preferences` | Save user-confirmed answers using the current profile version. |
| `nextstep_import_prospects` | Preview or import verified new jobs, with duplicate checks and preserved user decisions. Defaults to a dry run. |
| `nextstep_record_search` | Save an idempotent report and tentative adjustments with real evidence/imported IDs. |
| `nextstep_get_setup` | Read the setup request for the chosen provider and schedule. |
| `nextstep_register_schedule` | Record the actual task ID returned by the native agent scheduler. |

There are no arbitrary SQL, shell, code-editing, deletion, or stage-moving MCP tools. A job type must be saved before MCP imports are allowed. See [JOB-FINDER.md](../JOB-FINDER.md) for the import contract and [server/agent-instructions.mjs](../server/agent-instructions.mjs) for the exact agent instructions.

## Verify a build

```sh
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
pnpm test:desktop
node scripts/test-desktop.mjs "/absolute/path/to/Nextstep.app/Contents/MacOS/Nextstep"
```

Tests use temporary databases. The desktop check opens a window, saves setup choices, imports through a real MCP client, verifies that the board refreshes, and reads the same database after closing the window. It does not create a real task in Codex or Claude; provider-native scheduling must be checked during connection setup.
