Download **Nextstep-0.3.2-macOS-arm64-DMG.zip** from Assets below.

For Apple silicon Macs (M1 or later). The app and DMG are signed with Developer ID and notarized by Apple.

### Fixed agent setup

The previous setup button opened the agent app without selecting a new conversation. In Claude, that could leave the request in Cowork, where Nextstep's local tools were unavailable.

- **Open setup in Claude Code** adds the MCP connection and opens a new local conversation in Claude Desktop's Code tab with the complete request prefilled.
- **Open setup in Codex** adds the connection and opens a new local Codex task in the ChatGPT desktop or Codex app with the complete request prefilled.
- The app provides a local Research folder and keeps the MCP connection tied to your selected database.
- No copy and paste is needed. Clipboard restrictions do not block opening the agent.
- On-demand searches also open a new conversation. Connection confirmation still requires the agent to reach the correct database.

### Install or update

1. Unzip the download and open the DMG.
2. Quit the previous Nextstep app, then drag the new app into Applications and replace it.
3. Open Nextstep and go to **Search agent → Guided setup**.
4. Choose your agent and click **Open setup in Claude Code** or **Open setup in Codex**.
5. Confirm the Research folder if asked, review the prepared request, and press **Send**. In Claude Code, keep **Local** selected.

Existing jobs and preferences are preserved. New installations start empty. Personal data and credentials are not included.

Scheduled searches start only after your agent creates the requested task. Keep your computer awake and the local agent running.

### Verification

41 unit tests, 17 browser tests, build, lint, and both Claude Code and Codex onboarding checks against the signed package passed. Packaged checks use isolated settings and real MCP calls against temporary databases. The Claude Code desktop destination was also checked with an unsent draft; no real search or scheduled task was created by the tests.

SHA-256 of the ZIP: `eaa2b149a7b3a5c023ca2704524fe69cea75f77da7e539a03ba2e4314c081fe7`
