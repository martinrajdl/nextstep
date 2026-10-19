# Desktop app and local agent connection

Nextstep is primarily a local-first Electron app. It bundles its interface, HTTP server, SQLite runtime, and local MCP connectors. Your agent runs the workflow: sourcing information, shaping collections, saving changes and moving records. You follow progress on the Agent page and can opt into reviewing changes. Connection and setup instructions are optional, expandable tools on that same page. No model key or external database service is needed for local use.

On macOS, reopening the app also works while an agent connector is running. If macOS sends the open request to a windowless connector, it starts or focuses the desktop process using the desktop's saved database/backend selection. The connector keeps its separate database selection and stdio connection.

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

Source runs and unsigned development packages use a black icon with a blue blueprint drawing of the N and the window title **Nextstep Dev**. Signed production releases retain the neutral icon. Desktop tests set `NEXTSTEP_DEV_ICON=1` so even a signed package uses the blueprint Dock icon while being tested. This flag changes branding only; the test scripts still use their separate temporary databases and settings. Rebuild the development ICNS with `pnpm desktop:icon --dev`.

To choose another target after building the interface, run `node scripts/package-desktop.mjs <platform> <arch>`. Supported values are `darwin`, `win32`, or `linux`, and `arm64` or `x64`. The manual **Desktop builds** GitHub workflow builds on each operating system. Only macOS Apple silicon has been exercised with the full desktop smoke test so far.

`desktop:package` and the manual Desktop builds workflow produce unsigned development builds. For a Developer ID-signed and notarized macOS app, use `pnpm desktop:release` after completing the [Apple signing setup](macos-signing.md). A release ZIP is created only after its signature, notarization ticket, and Gatekeeper acceptance pass verification. The macOS download is a ZIP containing Nextstep.app. Unzip it and drag the app into Applications. Starting with version 0.4.3, use **Settings → App updates** to check, download and restart into a newer signed macOS version. Earlier versions need one manual replacement in Applications; the separate database is preserved. Move the app to its permanent location before connecting your agent: the connection contains the executable's absolute path.

## In-app updates

The signed macOS app checks Electron’s public update service shortly after startup and every six hours. A small dot on Settings indicates a newer release. **Download update** starts Electron’s native Squirrel.Mac downloader and signature verification. **Restart to update** applies it; a downloaded update also applies on the next normal quit and launch. Unsaved-edit prompts remain active. The database and settings live outside the app bundle and are not replaced.

**Check for updates automatically** can be turned off; manual checks remain available. Offline checks show a retryable message and do not stop the CRM. Development builds, MCP helpers, Linux and the current unsigned Windows packages do not use the in-app installer. `NEXTSTEP_DISABLE_UPDATES=1` disables update checks for isolated tests. See [privacy.md](privacy.md#update-checks) for network details.

Release assets must retain `Nextstep-<version>-macOS-<arch>.zip` naming in the public GitHub repository. The updater accepts only newer stable versions for the running architecture, and Electron verifies the application signature. Never bypass signing checks to publish an update. Validate the actual public feed after publishing, separately from testing the download UI.

## Appearance and backend settings

Open **Nextstep → Settings…** (Command-comma on macOS), **View → Settings…**, or **Settings** in the workspace sidebar. **View → Appearance** offers Light, Dark and System modes, followed by Neutral (the white and light gray default), Green, Blue, Violet, Rose and Slate accents. The Settings panel also has a custom accent picker. The title bar follows the chosen mode; the sidebar extends behind the macOS window controls and the content toolbar is draggable. Interactive controls remain clickable. Preferences persist in the desktop settings directory across restarts and backend changes. The generated app icon keeps its neutral colors. Browser appearance preferences are stored for that origin only.

Local SQLite is the default. To use a backend on your own server, start a private SSH tunnel and enter its loopback address under **Settings → Data & backend**. Electron continues to serve its bundled interface locally and proxies API requests through the tunnel. It never loads a remote renderer or grants native privileges to server code. No local shadow database is opened in this mode. A failed connection shows an error; it does not fall back to writing locally. **Use local database** returns to the existing selected file without copying, merging or deleting records. See [self-hosting.md](self-hosting.md).

Automatic agent installation is available only for a local database. Self-hosted agents must connect over SSH on the server, using the server's exact database path. The Agent page’s Connection & instructions panel can generate an SSH configuration from a host or alias you provide.

## Your database

The first desktop launch creates an empty database in Electron's per-user application-data directory, normally `~/Library/Application Support/Nextstep/nextstep.sqlite` on macOS. Choose **File → Open database…** to use an existing Nextstep SQLite file. It is opened in place, not copied, and the app remembers the selection. A missing previously selected file is an error rather than a reason to create an empty replacement.

You can also launch the app with `--database /absolute/path/to/nextstep.sqlite`. The selected file must already exist. `NEXTSTEP_DB_PATH` and its legacy alias `DB_PATH` work too. `NEXTSTEP_USER_DATA` selects a separate desktop settings directory for development or tests.

The MCP connection always includes the selected database's absolute path. Your agent can run from another folder or a worktree without creating a second pipeline. When switching databases, update the agent connection to target the selected file.

For a full backup, stop the app and any connected MCP helpers, then copy the database and any SQLite `-wal`/`-shm` companion files together. A SQLite backup operation is also safe while the database is open. Workspace JSON export includes collections, records, views, proposals, flows and history; it is not a full database backup.

Data downloads live in **Settings → Data & backend**. **Export collections** includes all records, including archived ones, rather than only the visible page. Existing workspaces are included as collections in that same export. Workspace and pipeline toolbars stay focused on browsing and editing.

## First-run setup

The first launch asks you to **Connect your agent**. Choose **Connect Codex** or **Connect Claude Code**. Nextstep adds a separate `nextstep-crm` MCP connection for the selected database and opens a new local conversation with the setup request prefilled. Review and send it in your agent; Nextstep does not send automatically.

The agent asks what you want to track, creates collections, typed fields, relationships, views and known records, and reports its progress. The first collection opens automatically. **Require review** in Settings is off by default; enable it to approve proposed changes before they are saved. The agent can discover and query that same schema through MCP. Manual schema and JSON tools are under **Other agents & advanced setup** on the empty workspace, and **Manual tools** on the populated home page.

The CRM handoff uses a `Workspace` folder in Nextstep's application-data directory. It preserves other agent connections and their permissions. Existing conflicting agent configurations are never silently replaced. Other agents and self-hosted workspaces can copy the exact configuration and setup request under **Other agents & advanced setup**. The general connector writes directly by default and respects the selected database’s Require review setting. Existing `--allow-writes` configurations keep working without overriding that setting.

**Workspace home** in the top bar returns home from any collection or workspace. The sidebar stays present while navigating, so switching does not reload the entire app. The current collection or workspace stays visible in the header.

## Connect another agent

Use the exact configuration shown under **Agent → Connection & instructions → Other agents & advanced setup**. It targets the selected database and the installed executable. For a packaged desktop app, the command has this shape:

```sh
/absolute/path/to/Nextstep --crm-mcp --database /absolute/path/to/nextstep.sqlite
```

On macOS the executable is inside `Nextstep.app/Contents/MacOS/Nextstep`. Quote paths containing spaces. From a source checkout, use:

```sh
node mcp/crm-stdio.mjs --database /absolute/path/to/nextstep.sqlite
```

The helper is a separate stdio process launched by the agent and works while the Nextstep window is closed. No public MCP endpoint or relay is started. The HTTP interface binds only to loopback and the renderer has no Node access.

The general connector reads context, previews changes and saves changes directly by default. Enable Require review in Settings to receive proposals instead. It exposes no approval tool; validation, version checks and history apply in either mode. See [composable-crm.md](composable-crm.md) for the complete tool and change-set contract.

Nextstep does not run or schedule agents. Your chosen agent provider may process the context it reads. Optional usage counts are off by default under **Settings → Privacy**; the check-in never includes CRM records or agent content. See [privacy.md](privacy.md) for the exact payload and retention.

## Verify a build

```sh
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
pnpm test:desktop
node scripts/test-desktop.mjs "/absolute/path/to/Nextstep.app/Contents/MacOS/Nextstep"
node scripts/test-desktop-settings.mjs "/absolute/path/to/Nextstep.app/Contents/MacOS/Nextstep"
node scripts/test-desktop-crm.mjs "/absolute/path/to/Nextstep.app/Contents/MacOS/Nextstep"
node scripts/test-desktop-updates.mjs "/absolute/path/to/Nextstep.app/Contents/MacOS/Nextstep"
```

Tests use temporary databases and isolated agent configurations. They verify native connection setup, the prepared unsent conversation, a real MCP session, schema proposals, human approval, automatic collection display, appearance, backend handling and preservation of existing data. `NEXTSTEP_AGENT_CONFIG_HOME` selects isolated agent settings for tests. External URL dispatch is captured without opening or sending a real conversation.

The packaged updater check stubs release transport and native install calls to verify UI/IPC transitions without updating a real app. It also verifies stage settings across restarts and checks that records remain unchanged. Distribution verification must separately exercise a real signed update in a disposable app copy.

The sidebar can collapse to an icon rail. Navigation and collection icons keep their labels in tooltips, and the desktop app remembers the chosen width across launches and backend changes. Small browser windows use the full navigation drawer.
