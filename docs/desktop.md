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

macOS packages use the custom Nextstep icon in `desktop/icons/nextstep.icns`. Its transparent 1024 px PNG master and generation prompt are kept beside it. After changing the master, run `pnpm desktop:icon` on macOS to rebuild the standard and Retina icon sizes before packaging. The generated `.icns` is committed, so ordinary builds do not need image-generation tools. An icon change requires a newly signed and notarized build; do not replace files inside an already signed app.

To choose another target after building the interface, run `node scripts/package-desktop.mjs <platform> <arch>`. Supported values are `darwin`, `win32`, or `linux`, and `arm64` or `x64`. The manual **Desktop builds** GitHub workflow builds on each operating system. Only macOS Apple silicon has been exercised with the full desktop smoke test so far.

`desktop:package` and the manual Desktop builds workflow produce unsigned development builds. For a Developer ID-signed and notarized macOS app, use `pnpm desktop:release` after completing the [Apple signing setup](macos-signing.md). A release ZIP is created only after its signature, notarization ticket, and Gatekeeper acceptance pass verification. Installers and automatic updates are not configured. Move the app to its permanent location before copying its MCP connection settings: those settings contain the executable's absolute path.

## Your database

The first desktop launch creates an empty database in Electron's per-user application-data directory, normally `~/Library/Application Support/Nextstep/nextstep.sqlite` on macOS. Choose **File → Open database…** to use an existing Nextstep SQLite file. It is opened in place, not copied, and the app remembers the selection. A missing previously selected file is an error rather than a reason to create an empty replacement.

You can also launch the app with `--database /absolute/path/to/nextstep.sqlite`. The selected file must already exist. `NEXTSTEP_DB_PATH` and its legacy alias `DB_PATH` work too. `NEXTSTEP_USER_DATA` selects a separate desktop settings directory for development or tests.

The MCP connection always includes the selected database's absolute path. Your agent can run from another folder or a worktree without creating a second pipeline. When switching databases, update the agent connection and check its scheduled task as well.

For a full backup, stop the app and any connected MCP helpers, then copy the database and any SQLite `-wal`/`-shm` companion files together. A SQLite backup operation is also safe while the database is open. JSON export includes preferences, current opportunities, schedule registration, and recent search reports; it is not a full database backup.

## First-run setup

The first launch opens a three-step wizard. Existing databases keep their jobs and preferences and can start or resume the wizard from **Search agent** in the compact header, without an interrupting modal.

1. **Your search:** describe the work you want and optionally your location and work arrangement. More preferences are tucked under an optional section. No profession, region, or company type is assumed.
2. **Your agent:** choose Codex or Claude Code Desktop. Search only when asked, or choose weekdays, daily, or a custom schedule. The timezone starts from your computer's setting.
3. **Ready to go:** click **Add connection** in the Mac app. Then **Copy request & open agent**, paste into a new **local** task, and send. For Claude, use the **Code** tab. The agent confirms it reached the correct board, asks about missing criteria, creates or updates a native schedule if requested, and runs the first search.

**Use the board for now** skips setup. Saved steps survive closing and reopening the app, and **Search agent** lets you resume. You can add and organize jobs manually at any time. Once connected, **Search agent → Copy search request** prepares another on-demand search without changing the schedule. Returning to the board does not imply that an agent or schedule is running.

Automatic connection is available on macOS for installed desktop agents. Nextstep uses the official bundled `codex mcp add` command for Codex, and merges the `nextstep` server into the documented user-level `~/.claude.json` for Claude Code, keeping a private backup when it changes that JSON file. Other settings are preserved. A conflicting `nextstep` connection to a different database is never silently replaced. Custom or managed configurations may need **Advanced connection**. If the agent was already open, start a new local task or restart it so it loads the tools.

The browser version and other platforms offer the generated connection settings under **Advanced connection**. Install the Mac app in its permanent location before connecting. Moving or renaming it later requires updating the executable path in the agent settings.

The wizard distinguishes **connection added** (settings saved), **agent connection confirmed** (an MCP tool call with the matching setup token reached this database), and **agent reported the scheduled task** (the native scheduler's task ID was reported). These are recorded events, not a live agent-health check. Completed searches and new matches appear in the board; an agent that finds no new matches still records a report.

An on-demand setup never requests a schedule. A recurring setup uses the agent's own scheduling tools after the user sends the request. Manage pause, resume, and deletion in the agent app. The local helper works while the Nextstep window is closed.

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

Official MCP and desktop connection references checked September 22, 2026:

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
| `nextstep_confirm_connection` | Confirm that the setup request reached this exact database; it does not activate a schedule. |
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

Tests use temporary databases and agent configurations. The desktop check goes through onboarding, installs the Codex connection into an isolated `CODEX_HOME` when Codex is installed (otherwise it checks the manual path), checks the clipboard handoff, confirms the connection through a real MCP client, imports a fictional match, verifies live board refresh, and reads the database after closing the window. `NEXTSTEP_AGENT_CONFIG_HOME` overrides the agent settings home for these tests; it is read only by the native main process. Agent opening is stubbed in the test, and no message is sent to an agent. It does not create a real task in Codex or Claude; provider-native scheduling must be checked during connection setup.
