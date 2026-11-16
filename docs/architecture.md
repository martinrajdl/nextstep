# Nextstep architecture

Nextstep has two storage modes. The desktop app normally keeps its selected SQLite database on the computer. The optional hosted app keeps its shared workspace in Supabase Postgres. Both use the same interface and validation rules. Agents run in their own clients; Nextstep does not run a model or schedule their work.

## Local desktop

```mermaid
flowchart LR
  Person[You] --> UI[Electron window<br/>Bundled React interface]
  UI -->|Loopback HTTP| API[Local API<br/>Host and Origin checks]
  API --> Engine[CRM validation<br/>Versions, review and history]
  Agent[Local agent<br/>Codex, Claude or another client] -->|stdio MCP| MCP[Separate Nextstep<br/>background connector]
  MCP --> Engine
  Engine --> DB[(Selected SQLite file)]
  DB --> Sync[Optional notes folder sync<br/>Configured in Settings]
  Sync <-->|Markdown notes only| Folder[Your chosen folder]
```

The desktop process and MCP helpers share the same selected database file. Helpers also work when the desktop window is closed. Records, notes, proposals and history stay in SQLite; appearance and connection preferences live separately. Folder sync is optional, local-desktop only, and covers notes rather than the whole CRM.

For a private server, the desktop still serves its own bundled interface. It proxies requests through a loopback SSH tunnel to the private server's API and SQLite database. It opens no local shadow database. This private-server mode is separate from the authenticated Vercel/Supabase deployment.

## Hosted shared workspace

```mermaid
flowchart TD
  Browser[Browser<br/>Same React workspace] --> Static[Vercel static assets]
  Browser -->|Apple sign-in| Auth[Supabase Auth]
  Apple[Apple identity provider] <--> Auth
  Auth -->|PKCE callback and secure cookies| API[Vercel hosted API]
  Browser -->|Same-origin HTTPS| API
  API --> Access[Verified identity<br/>Live membership and workspace role]
  Access --> PG[(Supabase Postgres<br/>Workspace data and audit)]
  PG -->|Load workspace entities| Engine[Temporary in-memory engine<br/>Shared CRM validation and review]
  Engine -->|Commit changed entities atomically| PG
  Engine -->|Result| API
  API -->|Response| Browser
```

Supabase Postgres is the durable source for hosted records, notes, proposals, history and progress reports. Each operation uses a disposable in-memory SQLite engine to apply the same rules as the local app. It does not create a filesystem database on Vercel. Workspace locks, optimistic versions and a single Postgres transaction protect writes.

Invited membership and workspace roles are checked before data access. The restricted runtime role is subject to row-level security. Browser sessions use secure HttpOnly cookies. Folder-sync paths and desktop preferences are not shared entities. The browser periodically refreshes committed changes; this adapter does not use Supabase Realtime subscriptions.

### Where the hosted API runs

The API entry, permissions, validation and history run together inside one deployed Vercel function. The boxes above describe responsibilities within the backend. Internal calls between these modules stay in the same Node.js process; authentication and database requests connect to Supabase.

`pnpm build:hosted` builds the React interface as static assets and bundles the API entry with its server modules into `.vercel/output/functions/api/index.func/index.mjs`. All `/api/*` paths route to that function. The current build configuration selects Node.js 24, the Frankfurt region (`fra1`) and a 30-second request limit. Vercel manages function instances and can reuse an instance across requests.

| Responsibility | Owning source |
| --- | --- |
| API entry and lazy handler initialization | [api/[...path].mjs](../api/%5B...path%5D.mjs) |
| Host/Origin checks, identity and HTTP routing | [server/hosted/http.mjs](../server/hosted/http.mjs) |
| Apple session verification and secure cookies | [server/hosted/auth.mjs](../server/hosted/auth.mjs) |
| Workspace roles, agent credentials, Postgres transactions and audit | [server/hosted/postgres.mjs](../server/hosted/postgres.mjs) |
| Endpoint-to-CRM operation dispatch | [server/hosted/operations.mjs](../server/hosted/operations.mjs) |
| Temporary SQLite engine and entity differences | [server/hosted/workspace-engine.mjs](../server/hosted/workspace-engine.mjs) |
| Shared validation, versions, review and before/after history | [server/crm-store.mjs](../server/crm-store.mjs) |
| Workspace tables, restricted role and row-level security | [server/hosted/schema.sql](../server/hosted/schema.sql) |
| Function packaging, runtime and route configuration | [scripts/build-hosted.mjs](../scripts/build-hosted.mjs) |

For example, an authenticated change follows this path:

```mermaid
sequenceDiagram
  participant Client as Browser or MCP bridge
  participant API as Vercel API function
  participant PG as Supabase Postgres
  participant CRM as Temporary CRM engine
  Client->>API: POST /api/crm/apply with a change set
  API->>API: Verify browser session or agent identity
  API->>PG: Begin transaction and check workspace permissions
  PG-->>API: Current membership, role and credential status
  API->>PG: Lock workspace and load entities if cache is stale
  API->>CRM: Run shared validation, versions and review rules
  CRM-->>API: Changed entities, proposal and history as applicable
  API->>PG: Save entity differences, revision and audit; commit
  API-->>Client: JSON result with applied or pending status
```

The function returns a successful write result after the Postgres transaction commits. A failed transaction rolls back its changes. If Require review is enabled for an agent write, the saved result is a pending proposal; the proposed record or note edits wait for a signed-in person's approval. Applied changes include before/after history, and the authenticated audit entry records the person and agent connection responsible for the request.

Permissions and validation are enforced inside the request path. Clients use endpoints such as `POST /api/crm/preview`, `POST /api/crm/apply`, `POST /api/crm/proposals`, `GET /api/crm/history`, `GET /api/notes` and `GET /api/notes/:id`. Notes are written as typed operations through the same preview/apply/proposal endpoints.

A warm instance can retain a database pool and a bounded entity cache, but membership, credential validity and the database revision are checked before reusing cached entities. Each workspace operation creates and closes its own in-memory SQLite engine. Supabase remains the durable store. The adapter materializes a workspace in memory and currently supports at most 50,000 entities or 32 MiB, including history, with a 4 MiB HTTP request limit.

## Local agents working with hosted data

```mermaid
flowchart LR
  Setup[Hosted Agent page<br/>Create a named connection] -->|Credential shown once| File[Private credential file<br/>On your computer]
  Agent[Local agent<br/>Codex, Claude or another client] -->|stdio MCP| Bridge[Nextstep background connector<br/>Installed app or Node source]
  File --> Bridge
  Bridge -->|HTTPS API<br/>Bearer credential| API[Vercel hosted API]
  API --> Check[Token hash, expiry<br/>Membership and review policy]
  Check --> PG[(Same Supabase workspace)]
  PG -->|Saved changes| UI[Hosted browser workspace]
```

Create a connection in **Agent → Connection & instructions**, save its credential in an owner-only file, and add the generated `nextstep-shared` entry to the local agent's MCP settings. Nextstep 0.5.2 or newer provides this connector from the installed macOS app; a Node 24 source checkout is another option.

The connector exposes the same CRM and notes tools as the local connection. It calls authenticated HTTPS endpoints rather than reading the computer's SQLite file. It needs no Supabase password or Apple browser session. Credentials expire after 90 days, can be revoked, and lose access when membership is removed. Require review is enforced by the server; an agent cannot approve its own proposal or change the review policy.

This is stdio MCP bridged to an HTTPS API, rather than a remote Streamable HTTP MCP endpoint. Custom clients can call the same API with the agent credential. A failed hosted connection returns an error and never falls back to local storage.

## Boundaries

| Concern | Local desktop | Hosted workspace |
| --- | --- | --- |
| Durable CRM and notes | Selected SQLite file | Supabase Postgres |
| Human interface | Bundled Electron renderer | Browser assets from Vercel |
| Agent transport | stdio MCP to the selected file | stdio MCP bridge to authenticated HTTPS |
| Human access | Operating-system account | Invited Apple sign-in and workspace role |
| Agent access | Local process and explicit database path | Hashed, expiring workspace credential |
| Optional review | Enforced inside SQLite writes | Enforced before the Postgres commit |
| Notes folder sync | Optional, in Settings | Hidden; notes already use shared storage |
| Local/hosted synchronization | No automatic synchronization | No automatic synchronization |

Local and hosted databases are separate authorities. A selected one-time transfer can preserve records, notes and history; it does not establish bidirectional synchronization. Keep each agent connection aimed at the intended workspace.

Source entry points: `desktop/main.mjs`, `app/workspace.tsx`, `server/http.mjs`, `server/crm-store.mjs`, `mcp/crm-server.mjs`, `mcp/remote-options.mjs`, `mcp/remote-crm.mjs` and `server/hosted/`. See [self-hosting](self-hosting.md) for deployment and agent configuration, and [the CRM contract](composable-crm.md) for operations and data limits.
