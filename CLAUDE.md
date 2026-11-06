# Notes for Claude

Project rules for anyone working on rydspine with Claude Code. Personal preferences go in `CLAUDE.local.md` (not committed).

- Read `CONTRIBUTING.md` for the checks to run before a change is done. The tool reference `TOOLS.md` is generated: after changing a tool's description or parameters, run `npm run docs:tools`.
- `SPINE_ACTIVATION_CODE` is read only from the environment: never print it or write it into code, git or result files. Mask the code in all output (`sed "s/$SPINE_ACTIVATION_CODE/<CODE>/g"`).
- Never commit third-party art or Spine license files; the coin sample and Spine's example art are downloaded at run time.
- Check with the real Spine Editor: `npm run spine:check` (needs network access to `*.esotericsoftware.com` and, on Linux, the `x11-xserver-utils` package).
- Check `.skel` reading on Spine's official examples: `npm run skel:examples`. How to rig like Spine's examples: the skill `.claude/skills/spine-rigging/SKILL.md` (update it when you learn new patterns).
- Reference projects (community Spine MCPs, official runtimes): `REFERENCES.md`; add new sources as you find them.
- Development history and plans: `dev-notes/` (`PROGRESS.md` is the working log).
