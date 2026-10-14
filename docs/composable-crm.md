# Composable Nextstep

Nextstep is an Electron app with a generic workspace at `/` and the preserved job-search workspace at `/jobs`. Both use the same selected SQLite database. Agents operate the primary workflow: source information, shape the workspace, propose changes, and continue enriching or moving records after review. Humans follow progress and make decisions in the CRM.

## The model

- **Collection:** a stable lowercase key, display name, description, color and up to 40 field definitions.
- **Record:** a UUID, title, typed values, optional external source key, optimistic version and timestamps. Archive keeps its identity and history. Restore is version checked.
- **Field types:** text, long text, number, email, URL, date, checkbox, select, multi-select and relation. A relation contains record UUIDs from a specific collection. Required fields and scalar unique fields are validated on every write.
- **View:** a durable name, table/board layout, visible fields, filters, sort and board grouping. Boards group by a select field. Views are visible to agents as well as people.
- **Change set:** up to 100 ordered operations, a stable idempotency key, title, summary and actor label. Every operation is validated and applied in one transaction or none are applied.
- **Proposal:** a validated change set in the review inbox. `pending` does not mean applied. Approve revalidates inside the write transaction; any stale version or invalid value leaves the entire proposal pending and changes no records. Reject preserves its proposed diff.
- **History:** before/after snapshots for every applied operation. Record history can populate the editor with earlier values; saving creates a new version. Exports include the complete history.

The initial workspace is empty. People, Companies, Projects, Research and Deals are optional empty templates. No examples are seeded into the user's database. Source identity is unique within a collection, including archived records, so re-imports cannot quietly resurrect removed data. Titles alone are not treated as unique.

## Shape data with an agent

On first launch, choose **Connect Codex** or **Connect Claude Code**. Nextstep adds the connection and opens a prepared conversation; review and send it in your agent. Describe your goal there, let the agent propose the schema, and approve it in Nextstep. The accepted collection opens automatically. **Your agent → Other agents & advanced setup** exposes a copyable config and request for other clients, targeting the exact running database. It uses a separate `nextstep-crm` connection; the existing `nextstep` Jobs research connector retains its original seven bounded tools.

From a source checkout:

```sh
node mcp/crm-stdio.mjs --database /absolute/path/to/nextstep.sqlite
```

Tools:

| Tool | Purpose |
| --- | --- |
| `nextstep_crm_context` | Discover collections, fields, views, templates, versions, policy and operation examples. |
| `nextstep_crm_query` | Read a bounded page, search, filter, sort and inspect archived records. |
| `nextstep_crm_get_record` | Get a complete record and its collection schema. |
| `nextstep_crm_preview` | Validate and return before/after diffs without storing any changes. |
| `nextstep_crm_propose` | Submit a change for human review. |
| `nextstep_crm_changes` | Read pending/applied/rejected status, with pagination. |
| `nextstep_crm_history` | Read recorded provenance and snapshots. |
| `nextstep_crm_flows` | List flows or read a specific flow with its latest 100 progress reports. |
| `nextstep_crm_report_flow` | Record progress, reported source links and actual linked change IDs. Does not change records. |

The default connection exposes no approval or direct-write tool. To trust a particular connection with direct writes, explicitly start it with `--allow-writes`. That adds `nextstep_crm_apply`. It still validates data, checks versions and records history. Actor names are provenance labels, not authenticated identities. A process with filesystem access to the SQLite file is already trusted at the operating-system boundary.

Packaged desktop connections use the application executable with `--crm-mcp --database …`. The app's Your agent panel generates the correct packaged or source command. The existing Jobs setup continues using `--mcp`.

There is no model runner, hidden AI service or model API key inside Nextstep. Your chosen agent performs interpretation and research; Nextstep provides deterministic shaping, storage and review. Record content is untrusted data, not instructions for an agent. Your agent provider may process the context it reads.

## The agent lifecycle

1. **Direction:** the user gives their connected agent an outcome. The setup conversation contains a brief with the workflow contract.
2. **Source:** the agent reads context, searches with its own authorized tools, and records a flow at stage `sourcing`, including source links and uncertainties.
3. **Shape:** the agent designs collections, relations and views, or updates existing records. It reports stage `shaping` and previews a typed change set.
4. **Review:** the agent submits proposals and reports stage `review` with real `changeIds`. Pending records remain unchanged. The user approves or rejects the exact diff; explicitly trusted agents can apply directly.
5. **Continue:** the agent reads the decision and fresh record versions, then continues at stage `updating`. It reports `complete` only when the linked work has been applied, or `blocked` with a reason when it cannot continue.

Start a flow with a stable `id`, a unique `reportId`, `version: 0`, `goal`, `actor`, `stage` and `message`. Later reports use the current flow version and a new report ID. Identical retries are idempotent. Each report can add up to 50 `{label,url}` sources and 100 `changeIds`; a flow retains at most 200 distinct sources and change IDs. IDs link existing proposals or applied change sets. Pending or rejected changes prevent a completed report. Rejected work can be marked blocked and a revised goal started in a new flow.

**Agent progress** refreshes every four seconds while visible and shows the last report time. Progress is agent-reported, not proof that an external process is still running. Applied-operation counts and proposal outcomes are derived from Nextstep's own history. Reports never grant approval or modify CRM records. The export retains the full report timeline. Nextstep does not execute, schedule, or automatically wake agents after review; the connected agent must read the review outcome to continue.

History without `after` returns recent events newest first. With `after > 0`, it returns the oldest unseen events first; advance the cursor to the last returned ID to avoid missing events across pages.

## A concrete change set

```json
{
  "id": "research-batch-001",
  "title": "Organize the first research notes",
  "summary": "Create a small research collection and one fictional example.",
  "actor": "Research helper",
  "operations": [
    {
      "type": "create_collection",
      "id": "research",
      "name": "Research",
      "fields": [
        { "key": "source", "name": "Source", "type": "url" },
        { "key": "summary", "name": "Summary", "type": "longtext" }
      ]
    },
    {
      "type": "create_record",
      "collectionId": "research",
      "collectionVersion": 1,
      "title": "Fictional field notes",
      "externalKey": "example-note-1",
      "values": { "source": "https://example.com/notes" }
    }
  ]
}
```

Supported operations: `create_collection`, `update_collection`, `create_record`, `update_record`, `archive_record`, `restore_record`, `create_view`, `update_view`, `delete_view`. Updates require the current `version`; record creation/updates also require `collectionVersion`. `values` on record updates is a patch: omitted fields are preserved and `null` explicitly clears an optional value. Collection `fields` replaces the field definition list only after validating every existing record and saved view. Changing the type of a populated field is refused; explicitly copy/convert into a new field first.

Operations run in order. Create related collections before declaring relation fields, and create target records before linking to them. Supply explicit record UUIDs when referencing new records in the same batch. Otherwise Nextstep derives stable record/view IDs from the change ID and operation index. Retry an uncertain result with exactly the same change ID and content; reusing an ID for different content is rejected.

Queries accept `collectionId`, `search`, `archived`, `limit` (1–200), `offset`, `filters` and `sort`. Filters use `{field,op,value}` with `eq`, `contains`, `empty`, `not_empty`, `gte`, or `lte`. Sort uses `{field,direction}`. Fields are collection keys or `title`, `createdAt`, `updatedAt`. Results include `total` and `nextOffset`. The UI pages records by 50; board counts describe that visible page. It does not fetch the entire database into an agent's context.

## CLI and JSON workbench

```sh
pnpm crm context
pnpm crm preview data/change.json
pnpm crm propose data/change.json
pnpm crm query data/query.json
pnpm crm apply data/change.json --allow-writes
pnpm crm export > data/workspace-export.json
```

The CLI resolves `NEXTSTEP_DB_PATH` exactly like the app and refuses a missing database. Personal inputs and exports belong in ignored `data/`.

In a collection, **Import JSON** accepts a change set, a record array, or `{ "records": […] }` where each record has `title`, `values` and optionally `externalKey`. **Validate & preview** writes nothing. **Send to review** creates a proposal for an explicit human decision. Record arrays are limited to 100 per change; split larger imports into independently reviewed batches with stable source keys. Raw CSV, binary attachments and formula fields are not implemented in this version.

## HTTP and private hosting

The UI uses `/api/crm/context`, `/query`, `/preview`, `/proposals`, `/apply`, `/changes`, `/changes/:id/review`, `/records/:id`, `/history`, `/flows`, `/flows/:id`, `/flows/report`, and `/export`. Host/Origin protection and loopback binding remain enabled. The API is a local application interface, not an internet-facing multi-tenant service.

See [self-hosting.md](self-hosting.md) to run on a private server through SSH. Multiple local processes can safely share the database using SQLite WAL, transactions and optimistic versions. Shared user accounts, per-user roles, public HTTP authentication and multi-owner collaboration are not part of this release.

## Existing data and backups

The generic model adds `crm_*` tables and a separate schema version. It does not rewrite Jobs tables, stages, orders, notes, preferences, activity, schedule registrations or removed identities. Job import and research behavior remains governed by [JOB-FINDER.md](../JOB-FINDER.md).

**Export workspace** includes generic collections, all generic records including archived records, views, proposal decisions, agent flows and full generic history. The Jobs workspace has its existing separate export. Neither JSON export is a byte-for-byte database restore format. For a complete backup of both workspaces, stop the app and connected helpers and copy the selected SQLite file and its companion files together; the source-checkout `data/` folder is the full private working directory. Keep backups private. See [desktop.md](desktop.md#your-database) for desktop locations.

The standalone public marketing website lives in its own repository. No marketing build or public hosting configuration belongs in this CRM repository.
