// Rig templates: build common structures from a few world-space points instead of bone-by-bone.
import { addBone, addConstraint, findBone, findSlot, generateMesh, updateSlot } from "./rig.js";
import { UserError, type Workspace } from "./workspace.js";

export type Point = { x: number; y: number };

const angle = (a: Point, b: Point) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const r2 = (n: number) => Math.round(n * 100) / 100;

function boneAlong(ws: Workspace, name: string, parent: string, from: Point, to: Point): string {
	addBone(ws, { name, parent, x: from.x, y: from.y, rotation: r2(angle(from, to)), length: r2(dist(from, to)), space: "world" });
	return name;
}

function bind(ws: Workspace, slot: string, bone: string): void {
	findSlot(ws, slot);
	updateSlot(ws, { name: slot, bone, keepWorld: true });
}

export interface ChainSpec {
	name: string;
	parent?: string;
	/** Points along the chain, base first. With two points, `segments` splits the line evenly. */
	points: Point[];
	segments?: number;
	/** Parts to bind; each becomes a contour mesh weighted along the chain so it bends smoothly. */
	slots?: string[];
	/** Add a physics constraint per bone so the chain drags and settles on its own. */
	physics?: boolean;
}

/** Tails, necks, tentacles, ropes, branches, antennae. */
export function chain(ws: Workspace, s: ChainSpec): string[] {
	if (s.points.length < 2) throw new UserError("a chain needs at least 2 points");
	let pts = s.points;
	if (pts.length === 2 && (s.segments ?? 3) > 1) {
		const n = s.segments ?? 3;
		pts = Array.from({ length: n + 1 }, (_, i) => lerp(s.points[0], s.points[1], i / n));
	}
	const bones: string[] = [];
	let parent = s.parent ?? "root";
	findBone(ws, parent);
	for (let i = 0; i < pts.length - 1; i++) {
		parent = boneAlong(ws, `${s.name}${i + 1}`, parent, pts[i], pts[i + 1]);
		bones.push(parent);
	}
	for (const slot of s.slots ?? []) {
		bind(ws, slot, bones[0]);
		generateMesh(ws, { slot, bones, maxInfluences: 2 });
	}
	if (s.physics) {
		bones.forEach((bone, i) =>
			addConstraint(ws, {
				type: "physics",
				name: `${bone}-physics`,
				bone,
				rotate: 1,
				inertia: 0.5,
				strength: 100 - i * 10,
				damping: 0.85,
			}),
		);
	}
	return bones;
}

export interface HingeSpec {
	name: string;
	parent?: string;
	/** The pivot (hinge axis, jaw joint, door edge). */
	pivot: Point;
	/** Optional point the part extends toward, used for the bone's direction and length. */
	tip?: Point;
	slots?: string[];
}

/** Lids, doors, jaws, flaps, levers: one bone rotating around a pivot. */
export function hinge(ws: Workspace, s: HingeSpec): string[] {
	const parent = s.parent ?? "root";
	findBone(ws, parent);
	if (s.tip) boneAlong(ws, s.name, parent, s.pivot, s.tip);
	else addBone(ws, { name: s.name, parent, x: s.pivot.x, y: s.pivot.y, space: "world" });
	for (const slot of s.slots ?? []) bind(ws, slot, s.name);
	return [s.name];
}

export interface WheelSpec {
	name: string;
	parent?: string;
	center: Point;
	radius: number;
	slots?: string[];
}

/** Wheels, gears, fans: a bone at the hub. Roll with anim_tween rotate (distance / radius). */
export function wheel(ws: Workspace, s: WheelSpec): string[] {
	const parent = s.parent ?? "root";
	findBone(ws, parent);
	addBone(ws, { name: s.name, parent, x: s.center.x, y: s.center.y, length: r2(s.radius), space: "world" });
	for (const slot of s.slots ?? []) bind(ws, slot, s.name);
	return [s.name];
}

export interface LimbSpec {
	name: string;
	parent?: string;
	/** Shoulder / hip. */
	start: Point;
	/** Elbow / knee. */
	joint: Point;
	/** Wrist / ankle. */
	end: Point;
	upperSlots?: string[];
	lowerSlots?: string[];
	/** Hand / foot parts, bound to a bone at the end that follows the IK target. */
	endSlots?: string[];
	/** Bone that owns the IK target (root keeps feet planted while the body moves). */
	targetParent?: string;
}

/** Arms and legs: two bones with an IK target at the end, bending the way they are drawn. */
export function limb(ws: Workspace, s: LimbSpec): string[] {
	const parent = s.parent ?? "root";
	findBone(ws, parent);
	const upper = boneAlong(ws, `${s.name}-upper`, parent, s.start, s.joint);
	const lower = boneAlong(ws, `${s.name}-lower`, upper, s.joint, s.end);
	const target = `${s.name}-target`;
	addBone(ws, { name: target, parent: s.targetParent ?? "root", x: s.end.x, y: s.end.y, space: "world" });
	// Bend direction from the drawn pose: which side of start->end the joint is on.
	const cross = (s.end.x - s.start.x) * (s.joint.y - s.start.y) - (s.end.y - s.start.y) * (s.joint.x - s.start.x);
	addConstraint(ws, { type: "ik", name: `${s.name}-ik`, bones: [upper, lower], target, bendPositive: cross < 0 });
	const bones = [upper, lower, target];
	if (s.endSlots?.length) {
		const end = `${s.name}-end`;
		addBone(ws, { name: end, parent: lower, x: s.end.x, y: s.end.y, space: "world" });
		bones.push(end);
		for (const slot of s.endSlots) bind(ws, slot, end);
	}
	for (const slot of s.upperSlots ?? []) bind(ws, slot, upper);
	for (const slot of s.lowerSlots ?? []) bind(ws, slot, lower);
	return bones;
}

export interface BipedSpec {
	hips: Point;
	chest: Point;
	neck: Point;
	head: Point;
	leftShoulder?: Point;
	leftElbow?: Point;
	leftHand?: Point;
	rightShoulder?: Point;
	rightElbow?: Point;
	rightHand?: Point;
	leftHip: Point;
	leftKnee: Point;
	leftFoot: Point;
	rightHip: Point;
	rightKnee: Point;
	rightFoot: Point;
	/** slot -> bone (hips, torso, neck, head, left-arm-upper, left-leg-lower, left-leg-end ...). */
	parts?: Record<string, string>;
}

/** Two-legged characters: hips -> torso -> neck -> head, IK arms and legs (feet targets on root). */
export function biped(ws: Workspace, s: BipedSpec): string[] {
	const bones: string[] = [];
	addBone(ws, { name: "hips", parent: "root", x: s.hips.x, y: s.hips.y, space: "world" });
	bones.push("hips", boneAlong(ws, "torso", "hips", s.hips, s.chest));
	bones.push(boneAlong(ws, "neck", "torso", s.chest, s.neck));
	bones.push(boneAlong(ws, "head", "neck", s.neck, s.head));
	for (const side of ["left", "right"] as const) {
		const hip = s[`${side}Hip`];
		bones.push(
			...limb(ws, { name: `${side}-leg`, parent: "hips", start: hip, joint: s[`${side}Knee`], end: s[`${side}Foot`] }),
		);
		const [shoulder, elbow, hand] = [s[`${side}Shoulder`], s[`${side}Elbow`], s[`${side}Hand`]];
		if (shoulder && elbow && hand)
			bones.push(...limb(ws, { name: `${side}-arm`, parent: "torso", start: shoulder, joint: elbow, end: hand, targetParent: "torso" }));
	}
	for (const [slot, bone] of Object.entries(s.parts ?? {})) bind(ws, slot, bone);
	return bones;
}
