# References

Projects worth learning from when improving rydspine. Read their code for ideas, do not copy it verbatim; licenses are noted alongside.
Update this file when new sources turn up.

## Official Spine

- **[EsotericSoftware/spine-runtimes](https://github.com/EsotericSoftware/spine-runtimes)** (branch 4.3). The reference runtimes
  (`spine-ts/spine-core` is the library rydspine uses) and `examples/*/export`: ~30 sample projects (spineboy, raptor, mix-and-match,
  stretchyman, tank, vine, sack, celestial-circus, diamond…) as `.json` + `.skel`.
  - `npm run skel:examples` downloads them and checks `.skel` reading on every sample.
  - Rigging patterns drawn from the samples: `.claude/skills/spine-rigging/SKILL.md`.
  - `SkeletonJson.js` / `SkeletonBinary.js` in `node_modules/@esotericsoftware/spine-core/dist` are the reference for the format
    (default values, curve channel order…).

## Community MCPs for Spine (checked 2026-10-31)

| Project | Language, license | Updated | Worth learning |
|---|---|---|---|
| [UmutFarukDilli/spine-mcp](https://github.com/UmutFarukDilli/spine-mcp) | Python, MIT | 2026-10 | Closest to rydspine: edits JSON, uses the Spine CLI for conversion, tests with spine-core 4.3. One tool `spine_set_keyframes` for every timeline (including `event`, `drawOrder`, `rgba2/rgb2`, `inherit`). Curves take presets or a normalized CSS-style bezier `[cx1,cy1,cx2,cy2]`, converted to absolute beziers and reshaped when keys are added. `spine_validate` catches unsorted keys, out-of-range curves, fields the runtime ignores, 4.2 vs 4.3 constraint layout. Has `spine_upgrade`, `spine_doctor`, `point` / `boundingbox` attachments, events. |
| [zhoushengmin/spine-mcp-server](https://github.com/zhoushengmin/spine-mcp-server) | TypeScript, no license stated | 2026-08 | Spine 3.8 + Cocos Creator, ~70 tools. Tool ideas: `mirror_bones`, `mirror_animation`, `mix_animations`, `pose_to_animation`, `apply_effect` (effect library), `mesh_wave`, `export_sheet` / `export_video`, `scale_project`, `batch_rename`, `rollback`, `cut_parts`, `repack_atlas`. |
| [egorfedorov/spine-mcp](https://github.com/egorfedorov/spine-mcp) | Python, MIT | 2026-08 | One-command rig + animate from a PSD or a PhotoshopToSpine export folder; detects head state families (eyes/mouth) from layer names; `batch` for a whole folder of characters; PNG montage previews; output runs in spine-pixi. |
| [ampersante/spine2d-animation-mcp](https://github.com/ampersante/spine2d-animation-mcp) (identical fork: [naosen/spine2d-animation-mcp](https://github.com/naosen/spine2d-animation-mcp)) | Python, MIT | 2026-06 | PSD → Spine 4.2: pivots at the joint edge of a part instead of the image center, or from `<part>[pivot]` marker layers; layer naming conventions → bone tree; draw order from the PSD layer stack. |

Directories to search for more: [glama.ai](https://glama.ai/mcp/servers?query=spine), [mcp.so](https://mcp.so) (search "spine").

## Taken / could take

- Done: key tool for every constraint timeline (the "empty channels keep the setup value" approach, like UmutFarukDilli), plus slider
  and image sequences (which they lack).
- Done: `event` and `drawOrder` keys, normalized CSS-style bezier curves for every `ease`, `point` / `boundingbox` attachments (after UmutFarukDilli); paths weighted to a few control bones as in the vine/stretchyman examples.
- Done: `mirror_animation` / `mirror_bones`.
- Done: pivots from `[pivot]` marker layers in `psd_import` (plus: `[pivot]` inside a group for the group's bone, bone tree following groups).
