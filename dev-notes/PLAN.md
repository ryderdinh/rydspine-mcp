# rydspine-mcp — Implementation plan

> **Development notes.** The original implementation plan, written before the code. Tool names and scope here are the plan, not the result; see [TOOLS.md](../TOOLS.md) and [README.md](../README.md) for what rydspine does today.

Status: proposal, based on `REQUIREMENTS.md`. Items marked "(proposed)" are default choices to start with. They may change once section 10 of `REQUIREMENTS.md` is settled.

## 1. Scope of the first version (v1)

**Proposed for v1:**

- Inputs: multi-layer PSD, a set of PNGs already split into parts, existing 4.3 skeleton JSON, a text description of the motion.
- Assets: two-legged characters, creatures with wings/tails (segmented chains), trees/soft objects, hinged objects (chest), wheeled vehicles, logos/independent shapes.
- Rig: bones, slots, attachments (region + mesh), auto weights, IK, transform and physics constraints.
- Animation: generated from descriptions, looping or not, adjustable parameters, combining several motions.
- Outputs: skeleton JSON, atlas, PNG, `.spine` project (via the Spine CLI), HTML/GIF preview, report.

**After v1:**

- Splitting parts from flat pictures and painting in hidden areas.
- Motion reference from video.
- Driving an open Spine Editor. v1 works entirely through files.
- Complex path constraints, advanced skins. v1 only supports basic attachment swaps.

## 2. Overall architecture

```
MCP client (Claude, ...)  ── stdio ──►  rydspine-mcp server (Node/TypeScript)
                                          ├─ tools/        : MCP tools (public API)
                                          ├─ model/        : internal skeleton model (typed, matches 4.3 JSON)
                                          ├─ ops/          : checked editing operations (rig, anim)
                                          ├─ import/       : PSD, PNG, JSON → model
                                          ├─ rig/          : rig templates, auto mesh, auto weights, IK
                                          ├─ motion/       : motion library & composer
                                          ├─ validate/     : data checks + motion checks
                                          ├─ preview/      : render with the 4.3 spine runtime (headless)
                                          ├─ export/       : JSON, atlas packing, Spine CLI → .spine
                                          └─ store/        : workspace, version history, locks
```

Principles:

1. **The LLM reasons, the server executes.** The LLM client reads the images and description, then chooses structure and parameters. The server provides typed, valid, undoable operations. The server never calls an LLM itself, so the model can be swapped, cost stays under control and everything is testable.
2. **Every change goes through `ops/`.** Each op is an atomic step, validated and logged. That gives undo, version comparison, locking of approved parts and correctly scoped edits.
3. **File-based processing.** The source format is 4.3 skeleton JSON. The `.spine` project is produced with the Spine CLI (JSON import). When the user edits in Spine, they export JSON for the server to import again.
4. **Check with the real runtime.** Every result is loaded with `spine-core` 4.3 before success is reported.

**Technology (proposed):** TypeScript, `@modelcontextprotocol/sdk`, `@esotericsoftware/spine-core` / `spine-webgl` 4.3, `ag-psd` (PSD reading), `sharp` (image processing), Playwright (headless preview rendering), Vitest (tests).

## 3. Planned MCP tools

| Group | Tool | Description |
|---|---|---|
| Workspace | `project_create`, `project_open`, `project_status` | Create or open a workspace, view a summary of its state |
| Input | `import_psd`, `import_png_set`, `import_skeleton_json` | Load assets and create the initial slots/attachments |
| Analysis | `asset_describe`, `asset_get_image`, `analysis_set` | Return images/bounding boxes/layers to the LLM, store the analysis (parts, relations, pivots) for the user to correct |
| Rig | `rig_apply_template`, `bone_add/update/remove`, `slot_*`, `attachment_*`, `mesh_generate`, `weights_auto`, `constraint_add` (ik/transform/physics), `skin_*`, `pose_test` | Build and adjust the rig |
| Animation | `anim_create`, `anim_apply_motion` (uses primitives), `anim_set_keys`, `anim_retime`, `anim_scale_amplitude`, `anim_offset`, `anim_layer` | Create and adjust animations |
| Editing | `history_list`, `history_diff`, `history_revert`, `lock_set`, `lock_clear` | Versions and locks |
| Checks | `validate`, `motion_check`, `preview_render` | Data errors, motion errors, image/GIF/HTML previews |
| Output | `export_runtime` (JSON/binary + atlas), `export_spine_project`, `report` | Export files and reports |

Common parameters for scoped edits: `bones[]`, `slots[]`, `animation`, `timeRange`. An op that touches a locked part is rejected, with a clear message saying which part is locked.

## 4. Rigging

- **Rig templates** by structure type: `biped`, `quadruped`, `winged`, `chain` (tail, neck, snake, rope), `hinge` (lid, door), `wheeled`, `plant` (trunk and branches), `prop/logo`. A template is a parametric skeleton, fitted to the asset from the bounding boxes and pivots the LLM proposes.
- **Automatic mesh:** contour from alpha → simplify → triangulate, with a density parameter.
- **Auto weights:** by distance to bone segments, with smoothing and a limit on bones per vertex.
- **IK** for legs/arms. **Physics constraints** (a 4.2+ feature) for hair, tails, branches, giving secondary motion without hand keys.
- `pose_test`: apply test poses (bends, extreme rotations), render and report abnormally deformed areas.

## 5. Animation

A library of parametric **motion primitives**. The LLM composes primitives from the description instead of generating raw keyframes:

- Cycles: `walk_cycle`, `run_cycle`, `flap`, `wheel_roll`, `sway`, `breathe`, `idle_bob`.
- Actions: `swing`, `open_hinge`, `appear` (scale/alpha), `bounce_settle`, `stop`.
- Modifiers: `follow_through` (delay along a bone chain), `anticipation`, `overshoot`, `noise`.
- Common parameters: `duration`, `speed`, `amplitude`, `delay`, `easing`/curve, `loop`.
- **Composition:** sequential on the timeline (run → stop → swing sword) and parallel by bone group (flapping wings + neck + tail).
- **Seamless loops:** cycle primitives match the first and last keys, with a velocity continuity check.
- **Hand keyframes:** still available through `anim_set_keys` for custom moves. Users can save them as new primitives to extend the set of actions.

## 6. Checks and preview

- `validate`: 4.3 JSON schema, broken references, missing images, unnormalized weights, parent–child cycles, a trial load with `spine-core`.
- `motion_check` (frame-sampled with the runtime):
  - foot sliding: velocity of the contact point while on the ground;
  - joint separation and deformation: mesh edge stretch, joint distances;
  - pops at the loop seam: position and velocity difference between the last and first frames;
  - exceeding the requested amplitude.
- `preview_render`: Playwright + `spine-webgl` render frames or a GIF/contact sheet, with bone/mesh/weight overlays. Plus an HTML player page to scrub and view any point in time.

## 7. Versions, locks and the Spine round trip

- A workspace holds the current `skeleton.json`, `images/`, `ops.log` and snapshots. Every tool call creates a version.
- `history_diff` compares by bone, slot and animation. `history_revert` goes back to any version.
- Locks by bone, slot, animation or time range.
- Re-importing JSON after the user edits in Spine: match by name and record it as a "manual edit" version.

## 8. Roadmap

| Phase | Content | Verification |
|---|---|---|
| **0. Spike & decisions** (~1 week) | Confirm the 4.3 JSON format; try the Spine CLI importing JSON → `.spine` and exporting (needs a license, check Essential/Professional); load JSON with `spine-core` 4.3 in Node; headless rendering; settle the points in section 10 | A hand-written skeleton makes the full JSON → `.spine` → opens in Spine 4.3 → render loop |
| **1. Core** | MCP server skeleton, model, ops, store/history, `validate`, `export_runtime` | JSON round-trip tests; a minimal skeleton built with the tools |
| **2. Input** | `import_psd`, `import_png_set`, `import_skeleton_json`, atlas packing, analysis tools | Sample PSD → slots/attachments in the right order and position |
| **3. Rig** | bone/slot ops, rig templates, mesh and auto weights, IK, physics, `pose_test` | The 6 sample assets rigged, test poses without errors |
| **4. Animation** | Motion primitives, composition, curves, loops, parameter adjustment | All 6 sample animations from section 5 of `REQUIREMENTS.md` generated |
| **5. Checks & preview** | `motion_check`, `preview_render`, HTML player | Correctly detects the errors in a set of deliberately broken cases |
| **6. Editing** | Scoped edits, locks, diff/revert, re-importing JSON from Spine | Editing one part leaves the rest unchanged (by diff) |
| **7. Output & acceptance** | `export_spine_project`, `report`, run the acceptance suite | Meets the criteria in section 9 of `REQUIREMENTS.md` |

Phase 0 progress: see `spike/README.md`. The 4.3 runtime runs headless; a Spine CLI trial on the user's machine is still pending.

Phases 2 and 3 can run in parallel once the core is done. Phase 5 should start early at a minimal level (frame rendering) so it can check phases 3–4.

## 9. Proposed acceptance suite

Six sample assets, each with an input, a prompt, expected parameters and automatic check thresholds:

1. Character (PSD): run → stop → swing sword. No foot sliding beyond the threshold.
2. Dragon (PNG set): looping wing flap, neck and tail out of phase. Seamless loop.
3. Tree (PSD): leaning in the wind, branches out of phase. No mesh deformation beyond the threshold.
4. Chest (PNG set): lid opens around the hinge then bounces slightly. Pivot on the hinge.
5. Car (PNG set): wheels roll matching the distance travelled, body bobs.
6. Logo (PNG): appears, bounces, settles. Not looping.

Besides the automatic checks, each sample needs a person to review the preview by eye. Visual quality criteria need agreed reference samples.

## 10. Risks

- **Spine CLI and license:** the user has a Spine Professional license. Note: meshes, weights, IK and physics require Professional. The server must run on a machine with the Spine Editor installed and activated to call the CLI. The key must not be committed to the repo; if CI is needed, put it in an environment variable or secret.
- **4.3 format changes:** confirmed that 4.3 JSON merges constraints into one `constraints` array with a `type`. Pin `spine-core` 4.3.13 and adjust once the exact Editor version is known.
- **Automatic quality:** automatic pivots and weights may be wrong on unusual assets. Mitigated by the analysis review step, `pose_test` and manual adjustment through the tools.
- **Subjective motion quality:** reference samples and concrete thresholds are needed before acceptance.

## 11. Information security

- **Spine license:** never put the key in chat, the repo, logs or committed config files. The key is only used to activate the Spine Editor on the user's machine. The server calls an already activated Spine CLI and never reads or stores the key.
- **Other secrets** (if any): read only from environment variables or a local `.env` file (already in `.gitignore`). The repo only keeps an `.env.example` with no real values.
- **User assets** (PSD, PNG, projects): kept in a local workspace folder, never committed. The acceptance suite only uses sample assets allowed to be public in the repo.
- **Local execution:** the MCP server runs over stdio on the user's machine and opens no network ports. The server sends no data out; the only images the LLM sees are those the client requests through tools.
- **Logs and reports:** never record sensitive absolute paths or secret contents; strip environment details from error reports.
- **Repo:** public, MIT licensed. Before every push, check there are no secrets (enable GitHub secret scanning). Third-party art (the coin sample, Spine's example art) is downloaded at run time, never committed.

## 12. Needs user confirmation before phase 1

1. The v1 scope in section 1 (in particular: flat pictures left out of v1).
2. ~~Spine license?~~ Professional. Still needed: the exact 4.3.x version and the OS of the machine running the server.
3. Target runtime (web, Unity, Godot, ...)?
4. Level of automation: stop after analysis for the user to review, or go straight through to animation?
5. Is the TypeScript/Node stack suitable?
