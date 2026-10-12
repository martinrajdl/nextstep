# Run Nextstep on your own server

Nextstep is a local-first Electron app with an optional backend on a server you control. The backend owns the SQLite database; the desktop interface remains bundled on your computer. The server deliberately listens on `127.0.0.1` with Host/Origin checks; an SSH tunnel provides private single-owner access.

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

Do not bind the CRM to `0.0.0.0`, remove Host/Origin checks, or put it behind a public reverse proxy without a separate authentication design. This deployment is for private ownership, not shared SaaS accounts.

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

Replace the host and paths. The agent defaults to proposing changes for review. Add `--allow-writes` only when intentionally granting direct writes to that connection. The SSH account has filesystem access to its database; the MCP tool policy is not an operating-system sandbox.

## Backup and upgrade

Stop the app and connected MCP processes before copying the database directory, including any `-wal` and `-shm` companion files. Store backups outside the repository, with permissions restricted to you. Validate an upgrade against a backup first. Build/archive/upload/notarization are separate from this server deployment; an existing signed desktop release is not evidence that the new composable build has been shipped.
