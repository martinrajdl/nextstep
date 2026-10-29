# Notes and folder sync

Notes is included in Nextstep 0.5.0. Optional user-owned Markdown folder sync ships as a beta; no CloudKit container is required.

## Notes and agent operations

Notes provides a Markdown editor and source mode, autosave, search, nested tags, pinned notes, archive/trash/restore, document history, note and record links, backlinks, individual Markdown import/export, and Add note from CRM records. Existing inline note fields remain unchanged.

Agents read/search through `nextstep_crm_notes`, and create or update bodies with `create_note` and `update_note` in previewed atomic change sets. Optional Require review remains enforced inside writes. Only committed document changes enter the sync outbox; proposals and progress reports cannot approve changes.

Each document has one canonical CRM record and a separate body capped at 1 MiB. Collection lists omit full bodies. The first note creates a library without repurposing an existing collection named Notes. Workspace JSON export includes notes and their history.

The single-file importer confirms the filename and uses a source identity to reject repeat imports, including archived notes. Bear TextBundle attachments and bulk import previews remain future work. Source mode retains raw Markdown; rich edits serialize the editor's supported Markdown nodes.

## Choose a sync folder

Open Notes, then Folder sync. Use Choose folder to select a directory, preferably in your own iCloud Drive if you want Mac-to-Mac transfer. Nextstep creates or uses its `Nextstep Notes` subfolder. Enable folder sync explicitly after selecting it. On the second Mac, select the same synced directory.

The app polls while open. Keep the folder downloaded so cloud placeholders do not block file access. Up to date means the local folder is reconciled; the file-sync provider controls remote delivery. SQLite always remains in the selected local database location. No Nextstep account, Apple Developer account or CloudKit container is needed by users.

Notes, stable IDs, tags, links, pin/archive/trash states sync. CRM record details, proposals, review policy, local history, credentials and machine configuration stay local. Links to absent CRM records stay unresolved. The native folder picker is the only renderer-accessible method for choosing a filesystem location. Browser and self-hosted modes do not open a local shadow database or use a local folder fallback.

## Portable files and recovery

Each note is a UTF-8 Markdown file. Its frontmatter retains Nextstep's format version, ID, links, state and parent revision; its title and body remain readable Markdown. Keep this metadata when editing through other apps. New plain `.md` files in the dedicated folder are imported and given metadata without discarding text.

Immutable Markdown revisions live in `.nextstep-history/` beside the working notes. They preserve concurrent versions independently of the file provider's conflict handling. Reconciliation creates conflict notes when versions diverge. Recovery history is not automatically pruned in this branch and consumes storage in the user's chosen folder.

Deleting a file does not delete its local note. The sync controls report missing files and can restore them explicitly. Use Trash in Nextstep to propagate a recoverable removal. Missing drives, malformed files and symbolic links pause sync with an error; committed local writing remains available. Disabling sync keeps both files and local data. Choose a separate database to connect a different notes folder in this first version.

The format supports a future iPhone client, but this branch does not include an iPhone app. That client needs Files folder selection, retained permissions, file coordination, a local cache and the same revision/conflict rules.

## Verification

Run `pnpm test`, `pnpm build`, `pnpm lint`, `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`, `pnpm test:desktop` and `pnpm test:desktop:notes`. The notes desktop test substitutes the native folder dialog with a temporary directory, enables actual filesystem sync and verifies generated Markdown. Repeat it with the packaged executable argument after packaging.

Unit tests exercise two independent SQLite stores sharing a temporary folder, offline conflicts, external Markdown edits, plain-file import, concurrent writes, recovery snapshots, missing-file restoration, stale acknowledgments and unsafe path rejection. Real iCloud Drive transfer remains a separate check on two devices with fictional notes. Local filesystem checks do not establish Apple's delivery timing.


## Release 0.5.0

The writing interface supports CommonMark-style headings, emphasis, strikethrough, ordered/nested lists, checkboxes, blockquotes, fenced code, dividers, links, image URLs and GFM tables. Markdown source is always available. Extended syntax such as raw HTML, comments, footnotes and images embedded in prose stays in source mode so visual conversion cannot discard it; it is not executed or visually rendered. Image URLs load directly from their host and do not upload attachments. Command/Control-click opens a web link. New notes focus the title; Command/Control-N creates a note and Command/Control-S saves it.

The toolbar keeps pinning, focus and source mode nearby; secondary document actions and extra formatting use menus. Autosaves retain undo and protect active buffers from incoming edits. Failed saves keep text available for retry/copy; overlapping edits offer Save both. Search is title/body substring search; nested tags are derived from Markdown. Advanced tag management, attachment uploads, bulk import, heading navigation and a separate iPhone app remain future work.

Agents use `nextstep_crm_notes` and `nextstep_crm_write_note`, including safe append and exact-passage edits. See the [notes API contract](composable-crm.md#notes-api). Existing generic change-set tools can combine notes with CRM edits atomically.

Folder sync ships as an opt-in beta. The tests verify actual Markdown files, offline conflicts, immutable recovery revisions and two independent local databases. Real two-device iCloud Drive delivery has not been verified, and local up-to-date status does not establish it. Keep the folder downloaded on each Mac. Recovery snapshots consume storage and are not automatically pruned.
