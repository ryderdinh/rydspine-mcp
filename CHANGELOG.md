# Changelog

All notable changes to rydspine are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

The first public version: 49 MCP tools that build, animate, check and export Spine 4.3 skeletons. See [TOOLS.md](TOOLS.md) for the full reference.

### Input

- `project_create`, and `project_import` for existing Spine 4.3 exports: skeleton JSON or binary `.skel`, with a folder of images or an atlas (packed pages are unpacked, including rotated, trimmed and premultiplied regions).
- `image_import` for separate PNG parts; `psd_import` for layered PSDs, keeping position, order, opacity and blend mode. `<name>[pivot]` marker layers create bones, nested like the PSD groups.
- `image_inspect` and `image_split` for flat pictures: split separate islands automatically or cut one polygon per part, paint in hidden areas (`overlap`) and remove anti-aliased halos on plain backgrounds (`matte`).
- `sequence_import` for frame-by-frame image sequences.

### Rigging

- Bones, slots and attachments placed in world coordinates (`bone_add`, `bone_update` with `compensate`, `slot_update` with `keepWorld`, `attachment_update`).
- `rig_template`: chain/wing (with mesh and physics), hinge, wheel, two-bone IK limb, biped, quadruped.
- `mesh_generate`: meshes that follow the image outline or a grid, automatic weights, `smooth` weights for paper and cloth, rebuilding a mesh in place.
- `constraint_add`: IK, transform, physics, path (from points on the art, optionally weighted to control bones) and slider.
- `shape_add`: point attachments, bounding boxes and clipping masks, from points or traced around a slot.
- `mirror_bones` and `mirror_animation` (`swap` or `mirror`); skins with `skin_create`, `skin_variant`, `skin_remove`.

### Animation

- `anim_oscillate` (with follow-through), `anim_tween` (with anticipation), `anim_bounce`, `anim_gait` (walk and run cycles that report travel speed and foot contacts), `anim_set_keys`.
- Slot, constraint, event, draw order, image sequence and deform keys (`anim_slot_keys`, `anim_constraint_keys`, `event_define` + `anim_event_keys`, `anim_draw_order_keys`, `anim_sequence_keys`, `anim_deform_keys`).
- Every `ease` takes a preset or a CSS-style cubic bezier; `property: "scale"` keys both axes.

### Checks, preview and output

- `validate` loads every result in the official Spine 4.3 runtime and reports broken references, missing images, loop seams and folded, squashed or stretched meshes; `motion_check` finds sliding feet.
- `preview` renders frames to SVG or PNG; `export` writes JSON, atlas, PNG, an `images/` folder for the Spine Editor's Import Data, and a self-contained HTML player.
- Every edit is a version: `history_list`, `history_diff`, `history_revert`, `lock_set`, and `project_sync` to bring back edits made in the Spine Editor.
- The rydspine studio web view (`npm run ui`, `ui_open`).
- Installers for macOS and Windows that set up Claude Code, Claude Desktop and Codex (`docs/index.html`).

### Verification

- Acceptance suites that build eight assets entirely through the tools, rig real art from Spine's examples, and round-trip everything through the real Spine Editor 4.3 (`npm run acceptance`, `npm run real:art`, `npm run spine:check`).
- `.skel` reading checked against the official Spine examples (`npm run skel:examples`).
