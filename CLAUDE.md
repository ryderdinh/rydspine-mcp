# Working notes for Claude

- **Tell the user when to compact.** When the conversation has grown long (many tool calls, large outputs) and is at a sensible stopping point (a piece of work done, committed and pushed, `PROGRESS.md` updated), say: "Nên compact bây giờ" ("Time to compact"), with the reason and what comes next. Do not wait for automatic compaction in the middle of a task.
- **Tell the user when context has been compacted.** As soon as you see the conversation was just summarized (compacted), the first sentence of your next message must say: "Context vừa được compact" ("Context was just compacted"), along with the task in progress. Do not carry on silently.
- Progress and next steps live in `PROGRESS.md`; update it after each piece of work. Plan: `PLAN.md`. Requirements: `REQUIREMENTS.md`.
- Reply to the user in Vietnamese.
- Commit and push only when a piece of work is done. When done, merge the branch into `main` yourself (`--no-ff`, run the tests after the merge) and push, without asking; create a PR only when the user asks.
- `SPINE_ACTIVATION_CODE` is read only from the environment: never print it or write it into code, git or result files. Mask the code in all output (`sed "s/$SPINE_ACTIVATION_CODE/<CODE>/g"`).
- Check with the real Spine Editor: `npm run spine:check` (needs network access to `*.esotericsoftware.com` and the `x11-xserver-utils` package).
- Check `.skel` reading on Spine's official examples: `npm run skel:examples`. How to rig like Spine's examples: the skill `.claude/skills/spine-rigging/SKILL.md` (update it when you learn new patterns).
- Reference projects (community Spine MCPs, official runtimes): `REFERENCES.md`; add new sources as you find them.
