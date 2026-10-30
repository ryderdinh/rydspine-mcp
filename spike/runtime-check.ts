// Phase 0 spike: load a Spine 4.3 skeleton JSON with the official runtime and sanity-check it.
// Usage: npx tsx spike/runtime-check.ts <path/to/skeleton.json>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
	AnimationState,
	AnimationStateData,
	AtlasAttachmentLoader,
	type Bone,
	MeshAttachment,
	MixFrom,
	Physics,
	RegionAttachment,
	Skeleton,
	SkeletonJson,
	TextureAtlas,
} from "@esotericsoftware/spine-core";

const FPS = 30;
const SEAM_TOLERANCE = 0.01;
const IK_TOLERANCE = 1;

const file = resolve(process.argv[2] ?? "spike/fixtures/swing/skeleton.json");
const errors: string[] = [];
const info: string[] = [];

// The loader needs atlas regions (for UVs) even headless; textures are never bound.
const atlasFile = readdirSync(dirname(file)).find((f) => f.endsWith(".atlas"));
if (!atlasFile) throw new Error(`no .atlas file next to ${file}`);
const atlas = new TextureAtlas(readFileSync(resolve(dirname(file), atlasFile), "utf8"));
const loader = new SkeletonJson(new AtlasAttachmentLoader(atlas));
const data = loader.readSkeletonData(readFileSync(file, "utf8"));
info.push(
	`loaded: ${data.bones.length} bones, ${data.slots.length} slots, ${data.constraints.length} constraints, ` +
		`${data.skins.length} skins, ${data.animations.length} animations`,
);

// Every region/mesh attachment must have an image on disk.
const imagesDir = resolve(dirname(file), data.imagesPath ?? "./images/");
for (const skin of data.skins) {
	for (const entry of skin.getAttachments()) {
		const att = entry.attachment;
		if (!(att instanceof RegionAttachment || att instanceof MeshAttachment)) continue;
		const png = resolve(imagesDir, `${att.path}.png`);
		if (!existsSync(png)) errors.push(`missing image for ${skin.name}/${entry.placeholder}: ${png}`);
	}
}

const skeleton = new Skeleton(data);
const worldPositions = () =>
	skeleton.bones.map((b: Bone) => [b.appliedPose.worldX, b.appliedPose.worldY] as const);

for (const animation of data.animations) {
	const name = animation.name;

	// 1. Play with physics at FPS; every bone must stay finite.
	skeleton.setupPose();
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, name, true);
	const frames = Math.max(1, Math.round(animation.duration * FPS));
	const dt = 1 / FPS;
	for (let i = 0; i <= frames; i++) {
		if (i > 0) {
			state.update(dt);
			skeleton.update(dt);
		}
		state.apply(skeleton);
		skeleton.updateWorldTransform(Physics.update);
		for (const b of skeleton.bones) {
			const p = b.appliedPose;
			if (!Number.isFinite(p.worldX) || !Number.isFinite(p.worldY))
				errors.push(`${name}: bone ${b.data.name} not finite at frame ${i}`);
		}
	}

	// 2. Loop seam: keyed pose at t=0 must equal t=duration (physics excluded).
	const poseAt = (t: number) => {
		skeleton.setupPose();
		animation.apply(skeleton, t, t, false, null, 1, MixFrom.current, false, false, false);
		skeleton.updateWorldTransform(Physics.none);
		return worldPositions();
	};
	const start = poseAt(0);
	const end = poseAt(animation.duration);
	let seam = 0;
	start.forEach(([x, y], i) => {
		seam = Math.max(seam, Math.hypot(x - end[i][0], y - end[i][1]));
	});
	if (seam > SEAM_TOLERANCE) errors.push(`${name}: loop seam jump ${seam.toFixed(3)}px`);
	info.push(`${name}: ${animation.duration}s, ${frames} frames, loop seam ${seam.toFixed(4)}px`);
}

// 3. IK reach check on the fixture's arm chain, if present.
const tip = skeleton.findBone("arm2");
const target = skeleton.findBone("target");
if (tip && target) {
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	const p = tip.appliedPose;
	const tx = p.worldX + p.a * tip.data.length;
	const ty = p.worldY + p.c * tip.data.length;
	const miss = Math.hypot(tx - target.appliedPose.worldX, ty - target.appliedPose.worldY);
	info.push(`ik: arm2 tip ${miss.toFixed(3)}px from target`);
	if (miss > IK_TOLERANCE) errors.push(`ik: arm2 tip misses target by ${miss.toFixed(3)}px`);
}

for (const line of info) console.log(`ok   ${line}`);
for (const line of errors) console.log(`FAIL ${line}`);
console.log(errors.length ? `\n${errors.length} problem(s)` : "\nall checks passed");
process.exit(errors.length ? 1 : 0);
