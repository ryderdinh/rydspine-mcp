# Phase 0 — Spike

Goal: prove that the **skeleton JSON → `.spine` → export → 4.3 runtime** loop works before writing the core.

## Contents

- `fixtures/swing/`: a hand-written sample skeleton in the 4.3 JSON format. 7 bones, 4 slots, a region and a weighted mesh, an IK constraint, a physics constraint, 2 animations (`sway`, looping with bezier curves; `reach`, moving the IK target), plus images and an atlas.
- `runtime-check.ts`: loads the skeleton with `@esotericsoftware/spine-core` 4.3.13 and checks that:
  - every attachment has an image;
  - every bone stays finite while animations with physics play;
  - the loop seam does not pop;
  - IK reaches its target.
- `spine-roundtrip.ps1` (Windows) / `spine-roundtrip.sh` (macOS): call the Spine CLI on your machine to import the JSON into a `.spine`, export JSON again, then run `runtime-check` on the export.

## Running

Requires Node 20+.

```bash
npm install
npm run spike:check
```

Spine CLI round trip (on a machine with Spine installed and activated; the script does not read the license key):

```powershell
$env:SPINE_VERSION = "4.3.xx"   # version number from Help > About
.\spike\spine-roundtrip.ps1
```

```bash
SPINE_VERSION=4.3.xx ./spike/spine-roundtrip.sh
```

If Spine is not at the default path, also set `SPINE_EXE`. If the CLI reports bad arguments, run `Spine --help` and send back the output (it contains no license information).

## Results so far

- ✅ The hand-written JSON loads in runtime 4.3.13. The checks catch deliberately introduced errors: missing images, a popping loop, IK not reaching its target.
- ⚠️ The 4.3 format differs from 4.2: IK, transform, path, physics and slider constraints share one `constraints` array, told apart by `type`, instead of separate `ik`, `transform`, `path`, `physics` arrays. The runtime API changed too (`setupPose()`, `appliedPose`, `Physics`).
- ⚠️ The runtime needs a real atlas even headless, so atlas packing must exist from phase 1–2.
- ⏳ Not yet confirmed: Spine CLI arguments and opening the `.spine` in the Editor. Needs a run on your machine.
