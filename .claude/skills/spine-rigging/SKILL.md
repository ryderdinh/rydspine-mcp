---
name: spine-rigging
description: Rig and animate 2D art for Spine 4.3 with the rydspine MCP tools — choosing bones, meshes and constraints (IK, transform, path, physics, slider) the way Esoteric's own example projects do, with their typical settings, and checking the result. Use when building or fixing a Spine skeleton or animation through rydspine.
---

# Rigging for Spine 4.3 with rydspine

The patterns and numbers below come from the official Spine 4.3 example projects
(github.com/EsotericSoftware/spine-runtimes, `examples/*/export`: spineboy, raptor, mix-and-match,
stretchyman, tank, vine, sack, celestial-circus, diamond, …). Read the art first, then build in this order.

## Workflow

1. `project_create` or `project_import` (JSON or `.skel`), then `image_import` / `psd_import`. Look at the
   parts with `image_view`; read joint positions off the art in world pixels.
2. Bones: prefer `rig_template` (chain, hinge, wheel, limb, biped, quadruped) over `bone_add` one by one.
   Give world points (`{x, y}`) read from the art.
3. Bind slots (`slot_update`, `keepWorld` keeps the art in place); fix draw order (0 = back).
4. Parts that bend get meshes: `mesh_generate` with `bones` for automatic weights. Rigid parts stay regions.
5. Constraints (`constraint_add`), see the recipes below. Game hooks and masks with `shape_add`.
6. Animate: `anim_create` (say `loop`), then `anim_gait`, `anim_oscillate`, `anim_tween`, `anim_bounce`,
   `anim_set_keys`, `anim_slot_keys`; constraints over time with `anim_constraint_keys`, flipbooks with
   `anim_sequence_keys`, game cues with `anim_event_keys`, layer swaps with `anim_draw_order_keys`.
7. Check after every step that matters: `validate`, `motion_check`, `preview` (look at the frames).
   `project_status` shows the rig as text. Lock approved parts with `lock_set`; undo with `history_revert`.
8. `export` when done. With Spine available, `npm run spine:check` round-trips through the real editor.

## Constraint recipes

How often the examples use each kind: physics 134, transform 53, IK 29, path 11, slider 1, image sequences 13.

**IK** — 2 bones for limbs (thigh + shin, upper arm + forearm), target bone outside the chain, usually a
child of root or of the hip. 1-bone IK for aiming (`aim-ik`, `look-constraint`, cannons, guns).
`bendPositive` picks the knee/elbow side. The examples rarely use stretch, compress or softness.

**Transform** — the second most used constraint, in four patterns:
- *Holder that stays put*: x+y with `mixX: -1` cancels the source's motion (`face-holder`,
  `corners-bottom`, `pan-front`), e.g. to keep a face still while the body bounces.
- *Parallax and follow*: x+y with a partial mix makes parts trail a control bone: eyes 0.2, hair 0.05–0.15,
  hat 0.6, pupils 0.4, `tail` 0.45. One control bone moving many face parts at different mixes gives a
  cheap 3D turn.
- *Copy everything*: rotate, x, y, scaleX, scaleY and shearY from a parent, with some mixes at 0
  (alien `eye`, `eye-root`) to choose which channels follow.
- *Local*: `localSource` + `localTarget` copies local values, e.g. a squash control driving left/right bones.
Write it as `{type: "transform", name, bones, source, properties: {x: {to: {x: {}}}, y: {to: {y: {}}}}, mixX, mixY}`;
`mixY` defaults to `mixX`. Mixes may be negative.

**Path** — bones follow a curve. Give `points` read off the art and rydspine creates the path slot.
- Rubber limbs (stretchyman, mix-and-match): `spacingMode: "percent"`, `rotateMode: "chainScale"`, 4–8 bones.
  In the examples the path is weighted to a few control bones so moving them bends the whole limb: give
  `pathBones` (control bones outside the chain; each point takes the nearest, `maxInfluences` default 2) and
  animate those bones. Without it the path follows one bone (`pathBone`).
- Chains, ropes, vines: `spacingMode: "length"`, `rotateMode: "chain"` (morningstar 8 bones, vine 13).
- Tank treads: `closed: true`, `length` + `chain`, one bone per tread (36), animate `position` to roll.
- Use `pathBone` so the curve moves with the body, or `pathBones` to hang it between parts (a vine weighted to
  its branch and a tip control bone).

**Physics** — the most used, on almost every pro example.
- `rotate: 1` for hair strands, feathers, capes, ears, antennae (most cases). `x`/`y` for soft masses that
  bounce (belly, chest, cheeks, face-control). `rotate` + `scaleX` for ruffles.
- Typical settings: inertia ≈ 0.37 (0.12–1), strength ≈ 135 (up to 173), damping ≈ 0.82 (0.15–1),
  mass ≈ 2.8 (1.4–4), limit 500, fps 20 when set; gravity 70 only where hanging things should droop.
- `rig_template` chain with `physics: true` adds drag/settle physics along a chain.

**Slider** — plays an animation by a value instead of time. Create the animation first.
- Bone-driven (diamond): `{type: "slider", animation, bone, property: "rotate", scale: 1/360, loop: true}`
  turns a control bone's rotation into animation time (one turn = one second here).
- Time-driven: `time` sets a fixed pose of the animation (expression presets, turn-around sheets).

**Image sequences** — frame-by-frame effects on one attachment (diamond shines: 7 frames). `sequence_import`
takes the PNG frames in order; play them with `anim_sequence_keys` (`mode`: hold, once, loop, pingpong and
reverse variants; `delay` seconds per frame, e.g. 1/12; `index` to start or hold a frame).

**Keying constraints** (`anim_constraint_keys`) — channels left out keep the setup value.
- Path `position` 0→1 over a loop rolls treads or runs sparks round a closed path; `spacing` stretches a chain.
- Physics `wind` / `gravity` keys for gusts; `reset` at a cut or teleport; `mix` 0 to switch physics off.
- Transform mixes fade a follow in and out; IK `mix` 0→1 hands a limb from FK to IK (pick-up, plant a foot).
- Slider `time` scrubs its animation (expression or brightness presets).
- A transform has mixes only for the properties it drives; others read as 0 in the runtime.

## Events, draw order and curves

- Events are how the game hears the animation: footsteps on the contact frames of a walk (`anim_gait`
  reports them, and keys them with `event: "footstep"`), `hit` on the impact frame, sound cues with `audio`. Define the values once with
  `event_define` (spineboy: `footstep`, `shoot`; raptor: `roar`); keys override only what changes.
- Draw order keys swap layers mid-animation: an arm swinging behind the body, a card's back showing as it
  turns, a lid falling behind the glow. List only the slots that trade places; each key holds until the next.
- `ease` takes a CSS cubic-bezier `[x1, y1, x2, y2]` when no preset fits: `[0.15, 0.85, 0.35, 1]` snaps then
  settles, y above 1 overshoots. x must stay within 0..1.

## Points, hit boxes and masks

`shape_add` puts each in a new slot. Shapes are world points, or `around: <slot>` traces that slot's image
outline (or mesh hull) with `padding`.
- `point`: where the game spawns or attaches things: a muzzle (spineboy `crosshair`-style aim bones carry
  one), a hand grip, a coin spawn on a lid. Give its bone so it rides along; `rotation` is the direction.
- `boundingbox`: hit areas the game tests with `SkeletonBounds` (raptor, spineboy `head-bb`). Trace the part.
- `clipping`: masks the slots from `from` up to `end` (a window, a portal, the inside of a chest); it is
  placed right below `from`, and draw order keys are kept. Clipping is costly at runtime; keep few vertices.
- `preview` with bones shown draws boxes dashed green and points as an orange mark.

## Things the Spine Editor is strict about

rydspine already handles these; keep them in mind when editing JSON by hand:
- Each mesh vertex lists its bones in skeleton order, or import fails ("Index -2 out of bounds").
- Meshes need `edges`, or Spine warns that the file lacks nonessential data.
- Key times within ~0.06 frame of a 30 fps frame are snapped by Spine; put keys on frames.
- Spine sorts animations by name on import (natural, case-insensitive, folders last) but keeps slider
  animation references by file index; rydspine saves animations in that order so sliders stay correct.
- Spine writes floats with 7–8 digits; the JS runtime reads JSON as doubles and `.skel` as float32, so a key
  exactly on a frame can land on either side of it. Compare poses between frames.

## Not yet in the tools

Mirroring an animation or a rig; it round-trips through import/export and `.skel` conversion but has no tool yet.
