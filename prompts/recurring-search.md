# Recurring job search task

Use the prompt below in your local coding-agent scheduler. Set its working directory to this checkout and choose your own frequency, time, and timezone. The agent needs browsing, local command/file access, and the same `NEXTSTEP_DB_PATH` as the app if customized. An asleep/offline computer may miss runs; behavior depends on the scheduler. Creating this file alone does not schedule anything.

---

Run the Nextstep job collection workflow in this repository. Read `AGENTS.md`, `JOB-FINDER.md`, and `prompts/collect-jobs.md`, then read the live `profile` returned by `node scripts/job-finder.mjs context` on every run. These are my current Search preferences saved in the app. Do not copy personal criteria into public prompt files or use a built-in job-type preset.

Start with live CRM context and compare Uninterested, Interested, Applied, other stages, and removed records. Find currently open roles matching my criteria, verify them on live employer pages, and save only net-new strong matches at the top of Prospects through the importer. Preserve all existing stages, notes, priorities, history, and relative card order. Do not resurrect removed or declined roles.

Use Interested as positive feedback and Uninterested as negative feedback to adjust search terms and ranking. Read explicit reasons in notes; never invent a reason. Explicit Search preferences override inferred patterns. Keep any learning tentative, cite the opportunity IDs that support it in the research notes, and revise it when newer decisions contradict it. Do not silently save inferred preferences or make a declined specific role into a company-wide exclusion. Never change the app's code or interface as part of this task.

Save dated research and batch JSON under ignored `data/research/`, and keep a concise `data/research/monitor.md` for meaningful changes already reported. Recheck context after importing and report saved jobs only if their IDs exist. Record important closures or changed requirements in monitor notes rather than modifying my existing cards. Do not repeat unchanged recommendations as new finds.

If the intended database or browsing access is unavailable, do not create a replacement pipeline or claim a successful search/import. Report the concrete blocker. If the profile has no defined job type (`roles` is blank), ask me to complete setup or Search preferences and pause dependent collection until my answers are saved in the app. Never choose the job type for me. Do not fabricate new leads to satisfy a quota.

Stay quiet when nothing actionable has changed. Notify me when new strong matches were actually saved, a meaningful known-role change needs attention, or a failure requires my action. Include a short fit/gaps summary and direct links, with salary and eligibility uncertainties stated. Use whatever notification controls the scheduler supports.

Do not submit applications, contact employers, schedule additional tasks, change existing stages, or publish private information.
