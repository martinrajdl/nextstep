# Recurring job search task

Use the prompt below in your local coding-agent scheduler. Set its working directory to this checkout and choose your own frequency, time, and timezone. The agent needs browsing, local command/file access, and the same `NEXTSTEP_DB_PATH` as the app if customized. An asleep/offline computer may miss runs; behavior depends on the scheduler. Creating this file alone does not schedule anything.

---

Run the Nextstep job collection workflow in this repository. Read `AGENTS.md`, `JOB-FINDER.md`, `prompts/collect-jobs.md`, and my private `data/profile.md` on every run so you use current criteria and implementation. Do not copy personal criteria into public prompt files.

Start with live CRM context and compare Uninterested, Interested, Applied, other stages, and removed records. Find currently open roles matching my criteria, verify them on live employer pages, and save only net-new strong matches at the top of Prospects through the importer. Preserve all existing stages, notes, priorities, history, and relative card order. Do not resurrect removed or declined roles.

Save dated research and batch JSON under ignored `data/research/`, and keep a concise `data/research/monitor.md` for meaningful changes already reported. Recheck context after importing and report saved jobs only if their IDs exist. Record important closures or changed requirements in monitor notes rather than modifying my existing cards. Do not repeat unchanged recommendations as new finds.

If the intended database, profile, or browsing access is unavailable, do not create a replacement pipeline or claim a successful search/import. Report the concrete blocker. Do not fabricate new leads to satisfy a quota.

Stay quiet when nothing actionable has changed. Notify me when new strong matches were actually saved, a meaningful known-role change needs attention, or a failure requires my action. Include a short fit/gaps summary and direct links, with salary and eligibility uncertainties stated. Use whatever notification controls the scheduler supports.

Do not submit applications, contact employers, schedule additional tasks, change existing stages, or publish private information.
