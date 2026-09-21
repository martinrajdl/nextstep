# Set up Nextstep

You are helping me set up this local job-search CRM. Work in this repository and read `README.md`, `AGENTS.md`, and `JOB-FINDER.md` first.

1. Check Node and pnpm against `package.json`. Install the locked dependencies with `pnpm install --frozen-lockfile`. Do not install a cloud database or request an API key for the app.
2. Inspect the current installation before creating anything. Preserve any existing database, private profile, runtime configuration, and running instance. For a genuinely new installation, run `pnpm run setup` to create the empty database and ignored `data/profile.md`; never replace a missing established database with an empty one.
3. Help me complete `data/profile.md` from facts I provide. Ask concisely for missing essentials: actual country and work eligibility, target role scope, evidence of experience, work setup, compensation requirements, and hard exclusions. Existing conversation facts can fill these fields. Do not invent a résumé or adopt the author's personal preferences. The optional `templates/remote-emea.example.md` preset can be used if I want that search.
4. Build with `pnpm build`. Start the app with `pnpm background:start` if it is not already running. Verify the health endpoint and that the board opens at the configured local URL. Use `node scripts/job-finder.mjs context` to verify the intended database.
5. Tell me how to open and stop the app, where my private data lives, and which prompt runs collection. Do not populate the real board with fictional examples. If I also asked you to find jobs, continue with `prompts/collect-jobs.md` after the criteria are sufficient.

Do not create a schedule unless I request one. Keep personal details in ignored `data/` files. Setup does not require publishing, applying, contacting recruiters, or sharing my résumé externally.
