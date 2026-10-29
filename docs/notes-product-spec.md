# Nextstep notes and folder sync product specification

Status: product direction and future acceptance targets. Updated: 29 October 2026. The 0.5.0 release implements local notes, typed agent writes and opt-in beta folder sync. See [the implemented release scope](notes-development.md#release-050) for the exact shipped behavior and limitations. The accepted sync model is user-owned Markdown folders; no CloudKit container is required.

## Product decision

Add a first-class notes experience to Nextstep: fast Markdown writing, tags, backlinks and search, with direct links to CRM records. A person can keep a standalone idea or meeting note, then connect it to the people, projects or other records it concerns. Agents can find and maintain those notes through the existing preview, write and optional review workflow.

Use Bear as a reference for writing and navigation quality. Build the experience with Nextstep's own components, appearance and CRM relationships. The defining benefit is keeping written context beside structured work, with human and agent edits visible in the same history.

Keep SQLite as the local store and include optional Markdown folder synchronization in the first feature branch. Users select their own folder, which may be in iCloud Drive or another file-sync service. Sync covers notes only. iPhone and iPad require a separate client project that follows the same portable file contract.

## Storage and sync decision

Each device keeps its own local SQLite database. Notes travel as individual Markdown documents in a user-selected folder. Never place the live SQLite database in iCloud Drive as the sync mechanism. File copies cannot reconcile database transactions or coordinate SQLite journals across independent machines. [SQLite file safety](https://www.sqlite.org/howtocorrupt.html).

The folder approach meets the requirement that Nextstep need no maintainer-owned CloudKit container. Users own and can inspect their files, choose their sync provider and use other Markdown editors. A hidden recovery directory preserves immutable Markdown revisions for conflict recovery.

Private CloudKit was considered: its private databases belong to users and are not visible to the developer through the portal, but the app container and provisioning remain tied to a developer team. The selected folder model removes that dependency. No Apple container was registered. [Apple private database ownership](https://developer.apple.com/documentation/cloudkit/ckcontainer/privateclouddatabase).

A future iPhone client can select the same folder through the Files document picker. It must retain authorized folder access, coordinate file operations, download cloud placeholders safely and maintain its own offline cache. This is separate client work; the Electron app does not run on iPhone. [Apple directory access](https://developer.apple.com/documentation/uikit/providing-access-to-directories), [Apple file coordination](https://developer.apple.com/documentation/foundation/nsfilecoordinator).

## User outcomes

- Capture a thought without choosing fields, designing a collection or talking to an agent first.
- Write meeting notes with headings, checklists and links while staying in Nextstep.
- Open any record and see its associated notes; open a note and see the records it references.
- Find a passage by words, tags or a linked record, even offline in local mode.
- Ask an agent to summarize or update selected notes, inspect its changes and recover previous content.
- Later, resume the same private workspace on another Mac without moving database files manually.

## Navigation and writing flow

The first note, explicit Notes action or note import creates the note library in the selected database. New installations remain empty. A dedicated collection capability identifies the library; an existing user collection named Notes must not be repurposed by name.

Notes uses three panes inside Nextstep's existing shell: navigation with tags, a searchable note list, and the editor. The collapsed sidebar retains its existing behavior. A narrow window shows the list or editor with back navigation. Focus mode hides navigation and the list while preserving a clear exit action.

Selecting Notes restores the last selection for that database. New note creates an empty document and focuses its title; an empty title displays as Untitled. The list shows title, a short text preview, modification time and pin state. The record detail panel offers a Notes section with Add note and existing linked notes. Add note from a record prelinks that record.

The editor uses live Markdown formatting with a source mode available. It preserves caret position, selection, composition input and undo across autosaves. Links and formatting appear inline; there is no required preview step. Metadata and agent history live in a collapsible inspector rather than occupying the writing canvas.

## Feature scope

| Capability | First notes release | Following release |
| --- | --- | --- |
| Writing | Paragraphs, headings, emphasis, links, lists, checkboxes, quotes, fenced code and tables; keyboard formatting; source mode | Heading folding, outline and find within note |
| Organization | All notes, untagged, pinned, archived and trash; nested tags such as `#project/research`; tag autocomplete | Tag rename and merge with a preview of affected notes |
| Connections | Note links, backlinks and links to records in any collection; record Notes section | Heading links and suggestions for unlinked mentions |
| Retrieval | Title and body search, tag filter, linked-record filter, title and modification sorting | Advanced saved note searches |
| Capture | New note shortcut and Add note from a record | Optional global capture shortcut, file drop and paste attachments |
| Recovery | Autosave status, undo, document revisions, trash and restore | Attachment recovery and broader import tooling |
| Portability | Markdown files with a metadata and link manifest; bulk Markdown import with preview | Bear Markdown or TextBundle export import with attachments |
| Agents | Discover, read, search, create and edit notes through bounded tools and optional review | Attachment text extraction only when explicitly requested |
| Sync | Optional desktop Markdown folder sync; iCloud Drive or another user-selected location | Separate iPhone client using the same files; improved provider-specific status |

Bear's published feature set includes Markdown, tags, backlinks, offline writing, attachments and iCloud sync. These are reference capabilities; the release columns above define Nextstep's scope. [Bear features](https://bear.app/).

Real-time collaboration, public publishing, handwriting, OCR, password-locked notes, a web clipper and a plugin marketplace are outside these releases. Embedded checkboxes remain note content; converting them into CRM tasks is a separate explicit action. Editing a note never schedules work or sends messages.

## Detailed behavior

### Editing and saving

Autosave begins after approximately 500 ms without typing and on intentional navigation. Saving is a version-checked transaction. Saved means committed to the selected backend; cloud synchronization has a separate status. Failed saves retain the editor buffer, offer Retry and Copy text, and prevent silent navigation loss. Closing or changing database/backend prompts if content remains unsaved.

An incoming human, agent or sync edit must not replace text beneath an active cursor. Attempt a three-way merge against the common revision. If edits overlap, preserve both bodies and offer Compare, Keep mine, Keep incoming and Save both. Last-write-wins must not silently discard note text.

Keep document revisions distinct from per-keystroke operations. Coalesce ordinary typing into revision checkpoints at editing pauses and session boundaries; keep explicit agent changes and restores attributable. Target at least 30 days of revision recovery, with the retention policy visible before cleanup. Current content remains durable independently of revision coalescing.

### Tags and links

Parse tags outside code spans and code blocks, support nested paths and Unicode, and define one normalization rule shared by the editor, importer and agent tools. Parent tag filtering includes descendants. Removing the last use of a tag removes it from the active tag list.

Typing `[[` opens a searchable picker of notes and CRM records. Persist the target's stable ID and a readable label; duplicate titles remain distinguishable by collection. A rename updates presentation without breaking the target. Backlinks are derived from resolved targets. Unresolved imported links stay visible and are reported rather than attached to an arbitrary match.

Archiving a target keeps links intact with an archived indicator. Trashing a note hides it from ordinary search and keeps its identity recoverable. Permanent deletion is a distinct confirmed action; it leaves references marked as deleted and would require a future deletion protocol. The current branch offers recoverable trash and propagates that state through files; it does not offer permanent deletion.

### Import and export

Imports show note counts, unsupported formatting, unresolved links, attachments and possible duplicates before applying. Use an import-source identity and content fingerprints to recognize repeat imports, including archived and trashed identities. Never overwrite an edited destination because a filename matches. Apply validated batches with checkpoints so interrupted imports can resume without duplicates.

Preserve Markdown source, titles, tags, timestamps when available, internal link mappings and attachment references. Bear import operates on user-provided exports; it does not open Bear's private database. Missing attachments produce explicit warnings. Export includes everything selected, plus the metadata needed to preserve identities and links on round trip.

## Data and agent integration

Extend the existing CRM model additively. A note has one canonical `crm_records` identity for its title, collection, archive status and ordinary record relationships. Store the Markdown body and document revision in a dedicated table keyed by that record ID, managed by `server/crm-store.mjs`. The existing `longtext` field is limited to 20,000 characters; full documents need a separate validation contract rather than an invisible increase across every text field.

Proposed document limit: 1 MiB of UTF-8 Markdown per note, with a clear error before exceeding it. Keep body content out of ordinary collection-list payloads and fetch documents on demand. Search indexes, tag indexes and backlink indexes are derived and rebuildable. Revisions, link mappings and document changes commit atomically with the corresponding record changes.

Support note-body operations in the same change-set boundary as record edits. A change that updates a note and links a record either commits completely or makes no changes. Generic title edits, archive/restore and compatibility connectors continue to use the same record identity. Existing inline CRM notes remain unchanged; converting one into a document requires an explicit preview.

Agents discover note capabilities through context, search metadata first and fetch bodies only when needed. Provide bounded operations for document read, search, create, replace and append, each with expected revision and idempotency handling. Append must fail on a stale base unless safely rebased. Preview shows a readable body diff and relationship changes.

Require review remains off by default and is checked within each write transaction when enabled. Pending note proposals do not change documents, indexes or applied counts. Replayed proposals cannot overwrite newer human edits. Progress reporting never approves a proposal. Restoring an older revision creates a new attributable change.

Attachments arrive in the following release. Use an application-managed private asset directory, immutable asset IDs, content hashes and validated file types. Portable exports must include assets. Define safe deletion only after checking live documents, recovery revisions and sync tombstones. Do not commit assets or use personal notes in screenshots.

## Folder synchronization

### Scope and controls

Sync is off by default. In the desktop app, users choose a directory using the native folder picker, then enable sync explicitly. Nextstep uses a dedicated `Nextstep Notes` subfolder. On another device, choose that same directory in the user's own synced storage. File-provider transfer timing is independent of Nextstep's local save status.

The sync scope is note title, body, stable identity, pin state, archive/trash state, tags derived from Markdown and linked IDs. CRM records and collections, agent proposals, review policy, local activity, credentials and agent configuration remain local. A referenced CRM record may be unavailable on another device. Review applies to agent writes on each device; file transfer never approves a proposal.

The UI distinguishes saved locally from folder updates. Show disabled, syncing, queued changes, folder up to date, missing files and errors. Up to date means Nextstep reconciled the selected local folder; it does not prove another device has downloaded the files. Self-hosted mode continues using its existing remote database without a local shadow database or desktop-folder fallback.

### File contract and recovery

Each working note is a UTF-8 `.md` file with a visible title and Markdown body. A small frontmatter entry preserves format version, record ID, pin/trash/archive state, linked IDs and the parent revision fingerprint. Keep that metadata when editing externally to retain note identity. Users can add plain Markdown files; Nextstep assigns a stable identity and adds its metadata while retaining their text.

Local database changes and dirty tracking commit atomically. Upload acknowledgments cannot clear a newer edit. Read individual files safely, reject symbolic links and unsupported or oversized metadata, validate through the note store and use atomic file replacement. Do not expose arbitrary folder-path writes to the renderer; only the native picker selects a folder.

Before changing working files, persist immutable revisions under `.nextstep-history/`. Reconcile unseen revision branches and preserve differing local text in conflict notes. These snapshots also preserve versions when a cloud service replaces a working copy during concurrent edits. Recovery files are private user data and remain inside the chosen user folder. Automatic recovery cleanup is deferred; explain that history consumes storage.

Removing a Markdown file does not delete its local note. Show missing files and offer explicit restoration. Use Trash inside Nextstep to propagate a recoverable removal. A disconnected or unavailable folder pauses transfer while local writing continues. Disabling sync preserves all data. Switching to a different folder requires a separate local database in this first branch so unrelated libraries cannot merge silently.

### iPhone compatibility

Keep the file contract independent of Node and Electron. A future Swift or other iOS client can use its own local database, the same IDs and frontmatter, and the same revision/conflict rules. It must implement the Files picker, retained security-scoped access, file coordination, offline behavior and iCloud download status. Sync while an app is closed depends on platform scheduling and must not be presented as immediate delivery.

## Delivery milestones

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| 1 Notes and folder sync branch | Markdown writing, source mode, search, tags, links, history, agent tools, native folder selection and portable file sync | Unit/migration checks, browser/desktop flows, packaged checks and explicit real iCloud Drive transfer verification. |
| 2 Better capture and portability | Attachments, Bear export import, batch import previews, heading navigation and tag management | Repeat/interrupted imports, attachment safety and export fidelity. |
| 3 iPhone client | Folder selection, offline notes and the same Markdown/revision protocol | Two-device interoperability and iOS lifecycle, authorization and conflict tests. |

The user authorized publishing 0.5.0 after testing. Future milestones remain planned scope, rather than completed acceptance results.

## Acceptance and release verification

Use fictional temporary databases and example.com links throughout. These are proposed acceptance targets, not measured results.

| Area | Required result |
| --- | --- |
| Capture | Create and focus a note with one shortcut; capture from a record creates its backlink. |
| Editing | Markdown round trip preserves source meaning; IME, Unicode, paste, selection and undo remain correct after saves. |
| Durability | After Saved, process termination and restart lose no committed text; failed writes retain a recoverable buffer. |
| Conflicts | Two editors or an editor and agent update one note; both versions survive overlapping edits. |
| Search | On a documented reference Mac, 10,000 fictional text notes open within 200 ms p95 and search returns within 150 ms p95 after input debounce. Test 100,000-character documents for responsive typing. |
| Relationships | Rename, archive, trash, restore and duplicate titles do not misdirect note or record links. |
| Review | With review enabled, a proposed body edit changes nothing until approval; stale approval fails atomically. |
| Migration | Existing records, inline notes, IDs, activity, decisions, compatibility imports and ordering survive additive migrations. |
| Portability | Import the same export twice, interrupt a batch, and import edited duplicates; preserve decisions and report unresolved data. Export and reimport retain links and supported attachments. |
| Sync | Two Macs converge after independent offline edits, retries, duplicated/reordered deliveries and restarts, without lost text or partial visible change sets. |
| Sync recovery | Test unavailable folders, missing files, provider conflict copies, unsupported metadata, symbolic links and concurrent file replacement. Never infer deletion from an absent file. |
| Distribution | Verify the native folder picker, saved folder selection, restart behavior and actual file reconciliation in the packaged app. Separately verify iCloud Drive transfer with fictional notes on two devices. |
| Accessibility | Full keyboard navigation, visible focus, editor labels, screen reader behavior, resizing and light/dark visual checks. |

For implementation, run the required unit, migration, build and lint checks. UI changes also need Playwright and visual verification; desktop changes need runtime installation, desktop smoke tests and another check against the packaged executable. Local folder tests do not establish real iCloud Drive delivery.

## Decisions to settle during the prototypes

- Choose the editor after testing Markdown fidelity, composition input, source mode, accessibility and large documents; pin the selected dependencies.
- Validate iOS folder authorization, file coordination and offline behavior before starting the separate mobile client.
- Finalize recovery-history retention, attachment portability and provider conflict-file handling before a public sync release.
- Validate the macOS notes flow before committing to a separate mobile app or adding team collaboration.

## Implementation references

Current contracts: `README.md`, `docs/composable-crm.md`, `docs/desktop.md`, `docs/self-hosting.md` and `docs/macos-signing.md`. Main implementation boundaries: `server/crm-store.mjs`, `server/store.mjs`, `server/crm-flows.mjs`, `mcp/crm-server.mjs`, `app/workspace.tsx`, `components/crm/`, `lib/crm.ts` and `desktop/main.mjs`.

Preserve unrelated work in this checkout. Personal records remain private under ignored data paths. This specification does not authorize uploading an existing database, provisioning Apple services, publishing a release or modifying the separate marketing website.
