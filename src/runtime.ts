// Bridges the workspace to the official Spine 4.3 runtime: loading, posing and validation.
import { existsSync } from "node:fs";
import { join } from "node:path";
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
	type SkeletonData,
	SkeletonJson,
	TextureAtlas,
} from "@esotericsoftware/spine-core";
import { pack } from "./atlas.js";
import { UserError, type Workspace } from "./workspace.js";

export const FPS = 30;
const SEAM_TOLERANCE = 0.05;
const IK_TOLERANCE = 1;

export interface Loaded {
	data: SkeletonData;
	skeleton: Skeleton;
}

/** Loads the workspace with spine-core. Throws a UserError carrying the runtime's message on bad data. */
export function load(ws: Workspace): Loaded {
	const atlas = new TextureAtlas(pack(ws.imagesDir, ws.imageNames(), "page.png").text);
	let data: SkeletonData;
	try {
		data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(ws.doc);
	} catch (e) {
		throw new UserError(`Spine runtime rejected the skeleton: ${(e as Error).message}`);
	}
	const skeleton = new Skeleton(data);
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	return { data, skeleton };
}

export function boneByName(skeleton: Skeleton, name: string): Bone {
	const bone = skeleton.findBone(name);
	if (!bone) throw new UserError(`bone "${name}" not found`);
	return bone;
}

/** Poses the skeleton at time t of an animation, keyed values only (no physics). */
export function poseAt(loaded: Loaded, animationName: string, t: number): void {
	const animation = loaded.data.findAnimation(animationName);
	if (!animation) throw new UserError(`animation "${animationName}" not found`);
	loaded.skeleton.setupPose();
	animation.apply(loaded.skeleton, t, t, false, null, 1, MixFrom.current, false, false, false);
	loaded.skeleton.updateWorldTransform(Physics.none);
}

/** Plays an animation from the start with physics, calling visit at each frame. */
export function play(loaded: Loaded, animationName: string, frames: number, visit: (frame: number) => void): void {
	const { data, skeleton } = loaded;
	skeleton.setupPose();
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, animationName, true);
	const dt = 1 / FPS;
	for (let i = 0; i <= frames; i++) {
		if (i > 0) {
			state.update(dt);
			skeleton.update(dt);
		}
		state.apply(skeleton);
		skeleton.updateWorldTransform(Physics.update);
		visit(i);
	}
}

export interface Report {
	ok: boolean;
	errors: string[];
	warnings: string[];
	info: string[];
}

export function validate(ws: Workspace): Report {
	const errors: string[] = [];
	const warnings: string[] = [];
	const info: string[] = [];
	let loaded: Loaded;
	try {
		loaded = load(ws);
	} catch (e) {
		return { ok: false, errors: [(e as Error).message], warnings, info };
	}
	const { data, skeleton } = loaded;
	info.push(
		`${data.bones.length} bones, ${data.slots.length} slots, ${data.constraints.length} constraints, ` +
			`${data.animations.length} animations`,
	);

	for (const skin of data.skins) {
		for (const entry of skin.getAttachments()) {
			const att = entry.attachment;
			if (!(att instanceof RegionAttachment || att instanceof MeshAttachment)) continue;
			if (!existsSync(join(ws.imagesDir, `${att.path}.png`)))
				errors.push(`missing image "${att.path}" for ${skin.name}/${entry.placeholder}`);
			if (att instanceof MeshAttachment && att.bones) {
				const v = att.vertices;
				for (let i = 0, n = att.bones.length, vi = 0; i < n; ) {
					const count = att.bones[i++];
					let sum = 0;
					for (let k = 0; k < count; k++, i++, vi += 3) sum += v[vi + 2];
					if (Math.abs(sum - 1) > 0.01) {
						errors.push(`mesh ${entry.placeholder}: vertex weights sum to ${sum.toFixed(3)}, expected 1`);
						break;
					}
				}
			}
		}
	}

	for (const animation of data.animations) {
		const name = animation.name;
		if (animation.duration <= 0) {
			warnings.push(`${name}: empty animation`);
			continue;
		}
		const frames = Math.max(1, Math.round(animation.duration * FPS));
		let bad = false;
		play(loaded, name, frames, (frame) => {
			if (bad) return;
			for (const b of skeleton.bones) {
				const p = b.appliedPose;
				if (!Number.isFinite(p.worldX) || !Number.isFinite(p.worldY)) {
					errors.push(`${name}: bone ${b.data.name} is not finite at frame ${frame}`);
					bad = true;
					return;
				}
			}
		});
		let line = `${name}: ${animation.duration.toFixed(3)}s`;
		if (ws.meta.loops[name]) {
			const seam = loopSeam(loaded, name, animation.duration);
			line += `, loop seam ${seam.distance.toFixed(3)}px`;
			if (seam.distance > SEAM_TOLERANCE)
				errors.push(`${name}: loop seam jumps ${seam.distance.toFixed(2)}px at bone ${seam.bone}`);
		}
		info.push(line);
	}

	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	for (const c of ws.doc.constraints) {
		if (c.type !== "ik") continue;
		const bones = c.bones as string[];
		const tip = skeleton.findBone(bones[bones.length - 1]);
		const target = skeleton.findBone(c.target as string);
		if (!tip || !target || bones.length !== 2) continue;
		const p = tip.appliedPose;
		const miss = Math.hypot(
			p.worldX + p.a * tip.data.length - target.appliedPose.worldX,
			p.worldY + p.c * tip.data.length - target.appliedPose.worldY,
		);
		if (miss > IK_TOLERANCE)
			warnings.push(`ik ${c.name}: target out of reach in setup pose (${miss.toFixed(1)}px short)`);
	}

	return { ok: errors.length === 0, errors, warnings, info };
}

function loopSeam(loaded: Loaded, name: string, duration: number): { distance: number; bone: string } {
	const sample = (t: number) => {
		poseAt(loaded, name, t);
		return loaded.skeleton.bones.map((b) => [b.appliedPose.worldX, b.appliedPose.worldY]);
	};
	const start = sample(0);
	const end = sample(duration);
	let distance = 0;
	let bone = "";
	start.forEach(([x, y], i) => {
		const d = Math.hypot(x - end[i][0], y - end[i][1]);
		if (d > distance) {
			distance = d;
			bone = loaded.skeleton.bones[i].data.name;
		}
	});
	return { distance, bone };
}
