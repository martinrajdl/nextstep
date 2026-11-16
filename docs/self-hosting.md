# Run Nextstep on your own server

Nextstep is a local-first Electron app with two optional deployment paths. A private SQLite server connects to Electron through an SSH tunnel, as described below. A [shared web deployment on Vercel and Supabase](#shared-web-deployment-on-vercel-and-supabase) provides Apple sign-in and a Postgres workspace in a browser. Neither option changes the default desktop database or migrates it automatically.

## On the server

Install Node.js 24 and the package manager version pinned in `package.json`. Clone the repository and use a private directory for data:

```sh
pnpm install --frozen-lockfile
export NEXTSTEP_DB_PATH="$PWD/data/nextstep.sqlite"
pnpm run setup
pnpm build
pnpm start
```

`setup` is non-destructive and repeatable. To reuse an existing database, set `NEXTSTEP_DB_PATH` to its exact path for setup, the app, and all helpers. Investigate a missing established database rather than initializing a replacement at another path.

For a foreground service supervised by systemd, a minimal user-managed example is:

```ini
[Unit]
Description=Nextstep private CRM
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/nextstep
Environment=NEXTSTEP_DB_PATH=/srv/nextstep/data/nextstep.sqlite
Environment=PORT=4317
ExecStart=/usr/bin/node /srv/nextstep/server/index.mjs
Restart=on-failure
UMask=0077

[Install]
WantedBy=default.target
```

Adjust the checkout and Node binary paths. Run the service as an ordinary dedicated user who owns the data directory. The service does not install itself or require root privileges at runtime.

## On your computer

```sh
ssh -N -L 4317:127.0.0.1:4317 user@your-server
```

In Electron, open **Settings → Data & backend**, enter `http://127.0.0.1:4317`, and choose **Connect to backend**. Alternatively, open the address in a browser. Keep the SSH session open. If your computer already uses port 4317, choose a different port for **both** the remote service and the local tunnel so the forwarded Host header matches the allowlist. For example, run the server with `PORT=4319` and forward `4319:127.0.0.1:4319`; this is the suggested port in desktop Settings.

Electron validates the backend before switching and remembers the selection. It serves the installed interface locally and forwards only JSON API requests to the tunnel, retaining local Host/Origin checks, sandboxing and context isolation. Backend disconnects show an error rather than using the local database as a fallback. **Use local database** returns to your selected local file. Switching does not migrate or sync data between the two databases. A missing previously selected local file still raises an error rather than being replaced.

Do not bind the SQLite CRM to `0.0.0.0`, remove Host/Origin checks, or put it behind a public reverse proxy. The SSH deployment is for private ownership. Use the separate authenticated hosted API for a shared browser workspace.

## Let an agent reach the server

Use SSH as the stdio transport, with key-based authentication configured outside Nextstep:

```json
{
  "mcpServers": {
    "nextstep-crm": {
      "command": "ssh",
      "args": [
        "-T", "user@your-server",
        "node", "/srv/nextstep/mcp/crm-stdio.mjs",
        "--database", "/srv/nextstep/data/nextstep.sqlite"
      ]
    }
  }
}
```

Replace the host and paths. The agent can save changes by default. Enable **Require review** in Settings to require proposals for the selected database, or add `--require-review` to restrict this connection. The SSH account has filesystem access to its database; the MCP tool policy is not an operating-system sandbox.

## Backup and upgrade

Stop the app and connected MCP processes before copying the database directory, including any `-wal` and `-shm` companion files. Store backups outside the repository, with permissions restricted to you. Validate an upgrade against a backup first. Build/archive/upload/notarization are separate from this server deployment; an existing signed desktop release is not evidence that the new composable build has been shipped.

## Shared web deployment on Vercel and Supabase

This optional adapter serves the same CRM interface as a web app, without Electron. Vercel serves static assets and the authenticated `/api/*` handler; Supabase provides Apple Auth and Postgres. There is no persistent process, local file database, Render service, paid add-on, or background job required by this deployment. Choose provider plans appropriate to your use and their current limits; the adapter does not purchase or upgrade a plan. Supabase Free projects may pause after inactivity, so a Free deployment is not an uptime guarantee.

Use Node.js 24, the pinned package manager, and a **separate empty Supabase project**. Keep project references, invitations, completed configuration files, transfer files, database backups, private keys and deployment credentials outside Git. `work/`, `.env*` and `.vercel/` are ignored; restrict their permissions as well. Public documentation and fixtures must remain generic.

### Database setup

Read `server/hosted/schema.sql` before applying it. It creates a private `nextstep` schema, workspace membership, scoped CRM entities, audit and revocable agent credentials. Do not add this schema to the Supabase Data API's exposed schemas. `anon` and `authenticated` have no access. The API must connect as the restricted `nextstep_app` login, which neither owns tables nor bypasses RLS. Never deploy the `postgres` password or a Supabase secret/service-role key with the web app.

Use an administrative database connection only on your own computer to provision this separate project. Load `NEXTSTEP_ADMIN_DATABASE_URL` privately, with `sslmode=verify-full`; if required, load the public database CA as `NEXTSTEP_DATABASE_CA`. Supabase supplies the pooler address and CA in **Connect** and **Database Settings**. Do not disable certificate checks. Then run:

```sh
pnpm hosted migrate --apply
pnpm hosted runtime-credential --apply --out work/runtime-password
pnpm hosted workspace --config work/workspace.json
```

`migrate` is transactional and versioned; repeating it leaves existing rows intact. `runtime-credential` writes a new random password to a new owner-only file without printing it. Running it again rotates the login, so update the deployment secret at the same time. The admin connection must never be supplied to Vercel.

Create `work/workspace.json` privately. This fictional example provisions a workspace ready for an import:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "Example outreach",
  "ready": false,
  "members": [
    { "email": "owner@example.com", "role": "owner" },
    { "email": "teammate@example.com", "role": "editor" }
  ]
}
```

Choose your own UUID. For a new empty workspace, omit `ready` or set it to `true`. A false value keeps a workspace unavailable until a verified import completes. Provisioning is additive: rerunning this command does not change existing members or access. Use a reviewed administrative change to change roles or set a member's `disabled_at`. Roles are `owner`, `editor` and `viewer`. Only owners can change Require review. Viewers cannot write or create agent connections.

Invite each person's actual Apple sign-in email privately. On the first verified Apple login, the invitation binds to the Supabase user UUID; subsequent access follows that UUID. Choose **Share My Email** at first sign-in. If an account uses an Apple private relay address, invite the verified relay address instead. Signing in without an invitation never grants CRM access. Do not reuse user UUIDs from another Supabase project.

### Apple sign-in

In your Apple Developer account, register a dedicated Services ID and enable Sign in with Apple under a suitable existing primary App ID. Register the Supabase project hostname as the domain and `https://YOUR_PROJECT.supabase.co/auth/v1/callback` as the exact return URL. Generate a client secret for that Services ID using your Apple signing key; the `.p8` key remains on your computer. Follow [Apple's web configuration guide](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/) and [Supabase's Apple Auth instructions](https://supabase.com/docs/guides/auth/social-sign-in/auth-apple).

In **Supabase → Authentication → Sign In / Providers**, enable Apple with the Services ID and generated secret. Disable unused providers, including email, phone and anonymous sign-in. Allow OAuth user creation so invited people can complete their first login; workspace invitations remain the admission boundary. Do not enable manual identity linking. Set **URL Configuration → Site URL** to your exact production app origin and allow only `https://YOUR_APP/api/auth/callback` as its redirect. Do not use wildcard production redirects.

Apple web client secrets expire in at most six months. Keep the expiry in your private operational notes and replace the secret before it expires. Rotation does not require changing the Services ID or signing key, and must not alter another app's Apple configuration.

### Vercel runtime and build

Create a separate Vercel project with **Other** as the framework and Node.js 24. Use the repository's `vercel.json` and `pnpm build:hosted`. It generates the Build Output API directory `.vercel/output`: static assets and one Node function. `pnpm build` alone remains the ordinary desktop/local build. `scripts/build-hosted.mjs` rejects unexpected deployment files and common credential patterns; review the output before upload as well.

Set the five variables in `hosted.env.example` as private **runtime** deployment settings:

| Variable | Value |
| --- | --- |
| `NEXTSTEP_APP_URL` | Exact HTTPS production origin |
| `NEXTSTEP_SUPABASE_URL` | Supabase project's HTTPS origin |
| `NEXTSTEP_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key for Auth |
| `NEXTSTEP_DATABASE_URL` | Restricted `nextstep_app` transaction-pooler URL with `sslmode=verify-full` |
| `NEXTSTEP_DATABASE_CA` | Public database CA certificate; PEM newlines or literal `\n` supported |

For Supabase's transaction pooler, the username is generally `nextstep_app.PROJECT_REF`. Copy the actual pooler host from the selected project instead of guessing it. URI-encode the password. The app uses one connection per function instance, no session-level database identity, and transaction-scoped RLS settings. Do not use `VITE_` or `NEXT_PUBLIC_` for runtime credentials.

Link the intended Vercel team and project, inspect `.vercel/project.json`, then deploy the reviewed build:

```sh
pnpm build:hosted
vercel deploy --prebuilt --prod
```

Keep preview deployments protected and give previews a separate test database, configuration and invited test accounts if you enable them. The production domain must reach Nextstep's Apple sign-in screen without a Vercel account. The API accepts only the configured origin and Host; generated deployment URLs do not become alternate access paths. Do not remove its checks to test a preview.

### Transfer an existing workspace

Back up SQLite using its backup API, or stop all writers before copying it. The export helper opens its source read-only and requires explicit collection and note IDs. It never changes the original database. Create a private selection file such as:

```json
{ "collectionIds": ["example_contacts"], "noteIds": [] }
```

Export to a new private file, preview its counts and inspect its scope before applying it:

```sh
pnpm hosted export --database /private/backups/source.sqlite --selection work/selection.json --out work/transfer.json
pnpm hosted import --workspace YOUR_WORKSPACE_UUID --file work/transfer.json
pnpm hosted import --workspace YOUR_WORKSPACE_UUID --file work/transfer.json --apply
```

Transfers preserve selected records, schemas, views, versions, timestamps, notes, proposals, flow updates and linked history. Mixed-scope changes are filtered to selected entities; unrelated change metadata and local filesystem-sync paths are excluded. Export only what belongs in the shared workspace. An import checks its fingerprint and the stored rows, and refuses to overwrite a nonempty destination. An identical retry reports `already_imported`; it does not reapply data over subsequent edits.

This is a one-time copy, not bidirectional sync. After acceptance, choose the hosted workspace as the authority for those shared collections and point their agents at it. Existing desktop and compatibility connectors continue using their original local data until explicitly changed. Do not run the same outreach workflow against both copies.

### Connect agents

While signed in, open **Settings → Agent tools** and create a named connection. It issues a credential once, scoped to your account and workspace, expiring after 90 days. Save it in an owner-only file outside Git. The server stores only its hash. Revoking the connection or disabling membership takes effect on subsequent requests, including warm function instances.

Use a separate MCP entry so local/private workflows retain their existing connector:

```json
{
  "mcpServers": {
    "nextstep-shared": {
      "command": "node",
      "args": [
        "/srv/nextstep/mcp/crm-stdio.mjs",
        "--server", "https://nextstep.example.com",
        "--workspace", "11111111-1111-4111-8111-111111111111",
        "--credential-file", "/private/credentials/nextstep-shared"
      ]
    }
  }
}
```

The bridge exposes the same CRM tools, honors Require review, and never falls back to local storage when the hosted app is unavailable. Agent connections cannot approve their own proposals, change Require review, or manage other connections. `NEXTSTEP_AGENT_TOKEN` is an alternative for a private process environment; never put a token in command arguments, prompts, logs or committed MCP configuration.

### Verification, limits and recovery

Run `pnpm test:hosted`, `pnpm test`, `pnpm lint`, `pnpm test:e2e` and `pnpm build:hosted` before deployment. Desktop changes also require `pnpm test:desktop`. The hosted tests use fictional workspaces and exercise RLS isolation, revocation, review, concurrent edits, transfer scope, cookie security and retries. Verify the deployed flow separately: Apple login, invited access, shared edits from both accounts, sign-out, and anonymous rejection of records, notes, history and exports. A green build does not prove Apple account acceptance.

The adapter hydrates one workspace's CRM entities into disposable in-memory SQLite per request, reuses the established validation engine, and commits row differences to Postgres atomically. A workspace lock serializes writers; optimistic record versions still reject stale edits. A bounded warm cache uses the live Postgres revision and always follows a fresh access check. The cache is disposable; durable data lives only in Postgres. No filesystem persistence is used in Vercel functions.

This adapter is intended for small shared workspaces: at most 50,000 stored entities including history, 32 MiB of workspace content and 4 MiB per request. Larger workspaces need a native Postgres query adapter before lifting these bounds. Folder sync and compatibility job-search endpoints remain local-only. There is no live push subscription; existing polling refreshes shared changes.

Use encrypted, access-restricted Postgres backups outside Git, including the private `nextstep` schema and the Auth identities it references. Verify restoration into a separate project before relying on a backup. Free hosting is not a backup policy. Keep the original SQLite backup and transfer fingerprint until acceptance. Rolling back a deployment changes code, not data: avoid importing the old SQLite copy over hosted edits. Export or back up the hosted workspace first, reconcile any newer changes, and restore only to an explicitly selected destination.
