# rydspine-mcp

An MCP server that builds Spine 4.3 rigs and animations from natural-language requests. The Spine Editor does not have to be installed: the server writes Spine data directly and checks it with the official Spine 4.3 runtime. Each user still needs their own Spine license, see [License](#license).

- Tool reference: [`TOOLS.md`](TOOLS.md)
- Changes: [`CHANGELOG.md`](CHANGELOG.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md) · Security: [`SECURITY.md`](SECURITY.md)
- Development notes (plan, requirements, working log): [`dev-notes/`](dev-notes/)

## Installation

**Users:** open the [`docs/index.html`](docs/index.html) page (GitHub Pages), download the installer for macOS or Windows and double-click it. The installer downloads the source into `~/.rydspine/app` and runs the setup program `src/setup.ts`, which writes the MCP configuration for Claude Code, Claude Desktop and Codex. Run it again to update. Repackage the installers after editing `installer/`: `npm run installers`.

**Development:** requires Node 20+.

```bash
npm install
npx playwright install chromium   # for PNG previews and the player page tests
npm test
```

## Using with Claude Code

The repo ships a `.mcp.json`, so Claude Code opened in this folder picks up the `rydspine` server automatically. For other MCP clients, run the server over stdio:

```bash
npx tsx src/index.ts
```

Projects are stored in `workspaces/` (change it with the `RYDSPINE_WORKSPACES` variable); this folder is not committed to git.

## Workflow

1. `project_create`: create a project; or `project_import` to open an existing Spine 4.3 project (JSON or `.skel`).
2. `psd_import` or `image_import`: bring in the parts, each at its own position. In a PSD, a layer `<name>[pivot]` (a small dot, may be hidden) places the bone for the layer or group `<name>` next to it; a `[pivot]` inside a group is that group's bone. Bones nest like the groups, and each part is bound to the nearest bone.
   Flat picture (one image, not split into layers): `image_inspect` returns the image with a coordinate grid; `image_split` splits the separate islands on a transparent or single-color background automatically, or cuts one polygon per part (listed back to front). `overlap` paints in the area hidden by the part in front, only inside that part's polygon, so outline the hidden piece too (neck under the head, thighs under the shirt) so joints show no gap when they turn. `dryRun` only returns the overlay for adjusting polygons. On a white or single-color background the anti-aliased rim is unmixed from the background color (`matte`), so parts show no light halo over other backdrops.
3. `rig_template` (chain/wing, hinge, wheel, IK limb, biped, quadruped) or `bone_add` (`space: "world"`): place bones at the joints in the art.
4. `slot_update`: bind parts to bones; the art stays in place.
5. `mesh_generate` (follows the image outline by default; call again to rebuild the mesh; `smooth` lets paper and cloth bend smoothly without tearing), `constraint_add`: add bending, IK, transform, physics, path (give points on the art and rydspine builds the curve; `pathBones` weights the curve to a few control bones) and slider (plays an animation by a control bone). `shape_add`: game anchor points (`point`: gun muzzle, hand grip), hit areas (`boundingbox`) or masks (`clipping`), from points on the art or traced around a slot's outline (`around`).
6. `mirror_bones`: copy one side of the rig to the other (bones, slots, flipped images, IK, physics). `mirror_animation`: move an animation to the other side (`swap` for side views, `mirror` reflects for front views).
7. `skin_create` / `skin_variant` when several outfits are needed.
8. `anim_create`, then `anim_oscillate` / `anim_tween` / `anim_bounce` / `anim_gait` / `anim_set_keys` / `anim_slot_keys`. Constraints that change over time (position on a path, physics wind, mix, slider time): `anim_constraint_keys`. Multi-frame effects (fire, sparkles): `sequence_import` then `anim_sequence_keys`. Game events (footsteps, hits, sounds): `event_define` and `anim_event_keys`. Front/back layer swaps during an animation: `anim_draw_order_keys`. Mesh shapes over time (a stretching glow, a billowing flag, a squashing blob): `anim_deform_keys`. `property: "scale"` keys both scale axes at once. Every `ease` takes a preset or a CSS-style bezier `[x1, y1, x2, y2]`.
9. `validate`, `motion_check` → `preview` → `export`.

## Interface

Run `npm run ui` (or call the `ui_open` tool) and open http://127.0.0.1:5180. The **rydspine studio** page plays every project's animations with the Spine player, and shows check results, the bone tree, version history and a frame strip.

## Acceptance suite

Run `npm run acceptance` to build 8 sample assets (character, dragon, tree, chest, car, logo, lantern, crab) through the MCP tools. Results land in `acceptance/out/`: exported files for each asset, `report.json` and the `studio-local.html` page.

Run `npm run real:art` for acceptance on real art: the dragon from Spine's example set (art by Thiago Brayner, for demonstration only). The script builds a PSD like one an artist would deliver (flat layers, `[pivot]` markers), rigs it and makes a flying animation entirely through the MCP tools, then compares the setup pose with the original pixel by pixel. With `SPINE_CLI` set it also round-trips through the Spine Editor. The art stays in `~/.cache` and `acceptance/out/` and is never committed or published.

Run `npm run spine:check` to check the 8 assets with the real Spine Editor: Spine imports each JSON file and exports it again, then the runtime compares both versions frame by frame; Spine also renders a frame strip for each animation. Set `SPINE_CLI` to point at Spine (for example `/Applications/Spine.app/Contents/MacOS/Spine`), or on Linux set `SPINE_ACTIVATION_CODE` so the script downloads Spine itself. Without either, the check is skipped.

Run `npm run skel:examples` to check `.skel` reading on Spine's official examples (sparse download from `github.com/EsotericSoftware/spine-runtimes`, branch 4.3): each file is converted to JSON and compared, frame by frame, with the runtime reading the `.skel` directly. `npx tsx acceptance/skel-fixture.ts` regenerates `test/fixtures/features` with the real Spine.

The `.claude/skills/spine-rigging` skill teaches agents to rig the way Spine's example projects do (choosing constraints, typical physics settings). Claude Code loads it automatically when this repo is open; to use it elsewhere, copy the folder into `~/.claude/skills/`.

Every operation is saved as a version: `history_list` to view, `history_diff` to compare, `history_revert` to go back, `lock_set` to lock approved parts. After editing in the Spine Editor and exporting JSON again, use `project_sync` to bring the edit back as a new version.

**`export` output:** `<name>.json`, `<name>.atlas`, `<name>.png` for the Spine 4.3 runtimes, and `<name>.html` to view the animations in a browser. Anyone with Spine opens the JSON file with **File → Import Data** to get a `.spine` project.

**Coordinate conventions:** y points up, units are pixels, angles are degrees counter-clockwise. Animation values are offsets from the setup pose; only `scalex`/`scaley` are multipliers.

Every tool, with all its parameters: [`TOOLS.md`](TOOLS.md). Reference projects (official runtimes, community Spine MCPs): `REFERENCES.md`.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the code layout and the checks to run. Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## License

rydspine's own code is released under the [MIT License](LICENSE).

It depends on the [Spine Runtimes](https://github.com/EsotericSoftware/spine-runtimes) (`@esotericsoftware/spine-core`, `@esotericsoftware/spine-player`), which are under the [Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license): each user of software that integrates them needs their own [Spine Editor license](https://esotericsoftware.com/spine-purchase). The `.html` player that `export` writes bundles `spine-player` together with that license notice. rydspine is an independent project, not affiliated with or endorsed by Esoteric Software; Spine is a trademark of Esoteric Software LLC.

The tests download Esoteric Software's coin sample, whose images may not be used commercially (see its `license.txt`); `npm run real:art` uses art that is for demonstration only. Neither is stored in this repo.
