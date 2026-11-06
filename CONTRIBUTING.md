# Contributing to rydspine

Thanks for helping. Bug reports, rigging recipes, fixes and new tools are all welcome. Open an issue first for larger changes, so we can agree on the tool shape before you write it.

## Setup

Requires Node 20+.

```bash
npm install
npx playwright install chromium   # PNG previews and the player page tests
npm run typecheck
npm test
```

The first `npm test` downloads Esoteric Software's coin sample from `spine-runtimes` into `~/.cache/rydspine/coin`, so it needs network access once.

## How the code is laid out

| File | What it does |
|---|---|
| `src/server.ts` | The MCP tool surface: names, descriptions, input schemas. Every editing tool runs on a fresh copy of the project, checks the result with the runtime, then saves it as a new version. |
| `src/workspace.ts` | A project on disk: skeleton, images, metadata, one snapshot per change, locks. |
| `src/types.ts` | Spine 4.3 skeleton JSON as rydspine writes it. |
| `src/runtime.ts` | Loads, poses and validates projects with the official `spine-core` runtime. |
| `src/rig.ts`, `src/templates.ts`, `src/mirror.ts`, `src/skins.ts` | Bones, slots, attachments, meshes, constraints, rig templates, mirroring, skins. |
| `src/contour.ts` | Meshes that follow an image's outline, and automatic weights. |
| `src/motion.ts`, `src/deform.ts`, `src/draworder.ts` | Animation keys and motion primitives, deform keys, draw order keys. |
| `src/psd.ts`, `src/split.ts`, `src/importer.ts`, `src/skel.ts` | PSD import, flat picture splitting, importing Spine exports, reading binary `.skel`. |
| `src/atlas.ts`, `src/preview.ts`, `src/diff.ts` | Atlas packing, previews and the HTML player, version diffs. |
| `src/ui.ts`, `src/setup.ts` | The rydspine studio web view, the setup wizard run by the installers. |
| `acceptance/` | Acceptance suites that build whole assets through the MCP tools, and round trips through the Spine Editor. |
| `test/` | Vitest tests; most drive the server through a real MCP client (`test/helpers.ts`). |

## Making a change

- **Tests.** Add a test for every new tool or fix. Prefer checking results with the runtime (pose a bone, compare vertices) over comparing JSON text.
- **Tool reference.** `TOOLS.md` is generated from the server's tool definitions. After changing a tool's description or parameters, run `npm run docs:tools`; a test fails while it is stale.
- **Showcase.** The animation at the top of `README.md` is rendered from the acceptance assets: `npm run acceptance && npm run showcase` (needs ffmpeg). Re-render it when a change alters how those assets look.
- **Docs.** Keep the workflow in `README.md` and the `spine-rigging` skill (`.claude/skills/spine-rigging/SKILL.md`) in step with tool changes. The skill teaches agents how to rig; add new patterns there when you learn them.
- **Spine Editor checks.** If you have the Spine Editor, run `npm run spine:check` for changes to the file format, meshes, constraints or timelines: it round-trips the acceptance assets through the real editor and compares every frame. Set `SPINE_CLI` to the Spine executable. `npm run skel:examples` checks `.skel` reading on Spine's official examples.
- **Style.** TypeScript, ES modules, tabs. Match the surrounding code; comments explain why, not what. `npm run typecheck` must pass.
- **Commits and pull requests.** One topic per pull request, with a short description of what changed and how you checked it (tests, previews, Spine round trip).

## Things never to commit

- Spine license keys or activation codes. `SPINE_ACTIVATION_CODE` is read only from the environment and must never appear in output, code or files.
- Third-party art, including Esoteric Software's example art and anything you do not have the right to publish. Tests download what they need.
- Your own projects (`workspaces/`) and generated output (`acceptance/out/`); both are ignored by git.

## License

By contributing you agree that your contributions are released under the project's [MIT License](LICENSE).
