# Privacy and optional usage counts

Nextstep keeps CRM data in your selected SQLite database, locally or on your own backend. Your connected agent provider may process the context it reads through MCP.

## Off by default

**Settings → Privacy → Share anonymous usage** is optional and starts off, including after an upgrade. Leaving it off sends no usage check-ins. It does not affect any app features. Browser and self-hosted server builds do not send check-ins; neither do MCP helpers or development Electron builds.

If you turn it on, the packaged desktop app sends at most one successful check-in per UTC day while its window is focused:

| Field | Example | Purpose |
| --- | --- | --- |
| `schema` | `1` | Payload format |
| `day` | `2026-10-13` | UTC counting day |
| `dailyId` | A 64-character random-looking hash | Avoid counting this installation twice that day |
| `version` | `0.4.1` | App version |
| `platform` | `darwin`, `win32` or `linux` | Operating system family |

A random seed is saved in the desktop app's preferences when you opt in. The seed never leaves your computer. Each day's identifier is a hash of the seed and date, so receipts have no stable identifier across days. The check-in contains no account, name, email, machine identifier, exact operating-system version, database path, records, contacts, prompts, agent reports or feature events. There is no session replay, advertising identifier or analytics cookie.

The HTTPS endpoint is `https://nextstep-website-lemon.vercel.app/api/usage`. It accepts only the fields above and stores a private receipt in Vercel Blob in Frankfurt. The application does not store IP addresses or request headers in those receipts. As with any HTTPS request, Vercel processes network metadata, including an IP address, to serve and secure the request; infrastructure logs follow Vercel's own retention settings. This is not a promise that no network metadata is processed.

Receipts are scheduled for deletion outside a 31-day window by daily cleanup. Service outages or storage quotas can delay that cleanup. They count **active installations that opted in**, not all users or unique people. Daily identifiers cannot be combined into a unique monthly-user count. Public, unauthenticated counts can be incomplete or spoofed and are only a product-usage estimate.

Turn the setting off at any time to stop future check-ins, cancel an in-flight request where possible and remove the local seed. Previously received daily receipts expire through cleanup; turning the setting off does not recall them. Turning it back on creates a new seed. No history is queued for later upload. Offline requests fail silently and retry no more than hourly while the app is active.

## Update checks

The packaged macOS app checks `https://update.electronjs.org/martinrajdl/nextstep/darwin-<architecture>/<version>` at startup and every six hours. **Settings → App updates → Check for updates automatically** turns these checks off independently of optional usage counts. Manual checks send the same request. The request includes the app version and CPU architecture, with no installation identifier, database path, records or agent content. Electron’s service processes normal network metadata such as the IP address.

Downloads begin only when you choose **Download update** and use the public GitHub release asset through Electron’s native signed updater. GitHub and its download infrastructure receive normal download requests. A downloaded update applies when you choose **Restart to update** or next quit and reopen. The updater source is [`desktop/updates.mjs`](../desktop/updates.mjs); `NEXTSTEP_DISABLE_UPDATES=1` disables it for tests and managed installations.

## Downloads

Downloads use GitHub's existing public release-asset counters. These count download requests, including repeat downloads, rather than unique people or confirmed installations. Nextstep adds no tracking parameter or redirect to the download link.

## Inspect or disable in source

The sender is [`desktop/usage.mjs`](../desktop/usage.mjs). The collector, retention job and owner-only statistics command are in the separate [website repository](https://github.com/martinrajdl/nextstep-website). `NEXTSTEP_DISABLE_USAGE=1` disables reporting even when the local preference is enabled. The app works normally if the collector is unavailable or reaches its storage quota.
