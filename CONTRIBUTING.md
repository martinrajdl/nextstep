# Contributing

Bug fixes, accessibility improvements, better job identity matching, and clearer reusable prompts are welcome. Describe the concrete behavior you want to change and how you verified it.

1. Fork and clone the repository. Use Node 24 and the pnpm version in `package.json`.
2. Run `pnpm install --frozen-lockfile`, `pnpm run setup`, and `pnpm dev`.
3. Make a focused change. Preserve current data and include a migration when changing the SQLite schema.
4. Run `pnpm test`, `pnpm build`, and `pnpm lint`. For UI changes, install Chromium with `pnpm exec playwright install chromium`, run `pnpm test:e2e`, and visually inspect the affected flow.
5. Open a pull request explaining the problem, resulting behavior, and validation.

Keep `data/`, `.runtime/`, credentials, résumé files, exports, research, and personal browser screenshots out of commits and issue reports. Reproduce problems with fictional records. The automated tests use isolated temporary databases; never point them at your personal pipeline.

Changes to collection prompts should remain profile-driven, verify employer sources, preserve user decisions, and distinguish researching a job from submitting an application. Adding an agent prompt must not silently enable a schedule or an external service.

For Electron or MCP changes, read [docs/desktop.md](docs/desktop.md), install the Electron runtime with `pnpm exec install-electron`, and run `pnpm test:desktop` after building. Test a packaged executable as well when changing packaging. The manual Desktop builds workflow produces unsigned archives; signing credentials and personal data do not belong in this repository. A protocol smoke test does not prove that a provider's native scheduler is configured.

By contributing, you agree that your contribution is licensed under this project's MIT license.
