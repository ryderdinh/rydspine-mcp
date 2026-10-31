// Mirroring left/right: copy one side of a rig to the other (mirror_bones) and swap or reflect an
// animation between the sides (mirror_animation). Sides are told apart by name: left/right, l/r tokens.
import { type BonePose, Vector2 } from "@esotericsoftware/spine-core";
import { type DrawOrderJson, offsetsToNames, orderToOffsets, remapDrawOrders } from "./draworder.js";
import { assertUnlocked, findBone } from "./rig.js";
import { boneByName, load } from "./runtime.js";
import type { AnimationJson, AttachmentJson, BoneJson, ConstraintJson, SlotJson, ValueKey } from "./types.js";
import { checkName, UserError, type Workspace } from "./workspace.js";

export type Sides = [string, string];
const DEFAULT_SIDES: Sides[] = [
	["left", "right"],
	["l", "r"],
];

/** Words of a name: lower, Capitalized and UPPER runs, split at camelCase and separators. */
const WORD = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g;

function matchCase(like: string, word: string): string {
	if (like.length > 1 && like === like.toUpperCase()) return word.toUpperCase();
	if (like[0] === like[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
	return word;
}

/** The other side's name (left-arm → right-arm, armL → armR, eye_l → eye_r); the same name when it has no side. */
export function otherSide(name: string, sides?: Sides): string {
	const pairs = sides ? [sides] : DEFAULT_SIDES;
	return name.replace(WORD, (w) => {
		const lower = w.toLowerCase();
		for (const [a, b] of pairs) {
			if (lower === a.toLowerCase()) return matchCase(w, b);
			if (lower === b.toLowerCase()) return matchCase(w, a);
		}
		return w;
	});
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function descendants(ws: Workspace, roots: string[]): Set<string> {
	const out = new Set(roots);
	for (const b of ws.doc.bones) if (b.parent && out.has(b.parent)) out.add(b.name);
	return out;
}

function rotationInto(frame: BonePose, worldRotation: number): number {
	const r = (worldRotation * Math.PI) / 180;
	return (Math.atan2(frame.a * Math.sin(r) - frame.c * Math.cos(r), frame.d * Math.cos(r) - frame.b * Math.sin(r)) * 180) / Math.PI;
}

export interface MirrorBonesSpec {
	/** Bones to copy, each with everything below it. */
	bones: string[];
	/** World x of the mirror line (default: the root bone's x). */
	axis?: number;
	sides?: Sides;
}

export interface MirrorBonesResult {
	bones: string[];
	slots: string[];
	constraints: string[];
	warnings: string[];
}

/**
 * Copies bones (with their slots, attachments, IK and physics constraints) to the other side of a vertical
 * mirror line. A copy's x axis is the mirror image of the original's, so it bends the opposite way for the
 * same rotation; attachments are flipped with a negative scaleY (regions) or mirrored vertices (meshes, paths,
 * boxes, clips), reusing the same images.
 */
export function mirrorBones(ws: Workspace, spec: MirrorBonesSpec): MirrorBonesResult {
	if (!spec.bones.length) throw new UserError("give the bones to mirror");
	for (const b of spec.bones) findBone(ws, b);
	if (spec.bones.includes("root")) throw new UserError("root cannot be mirrored; give the bones of one side");
	const set = descendants(ws, spec.bones);
	const originals = ws.doc.bones.filter((b) => set.has(b.name));
	const partner = new Map<string, string>();
	for (const b of originals) {
		const p = otherSide(b.name, spec.sides);
		if (p === b.name) throw new UserError(`bone "${b.name}" has no side in its name (left/right, l/r); rename it first`);
		if (ws.doc.bones.some((x) => x.name === p)) throw new UserError(`bone "${p}" already exists; mirror_bones makes the other side`);
		partner.set(b.name, checkName("bone", p));
	}
	const warnings: string[] = [];
	const before = load(ws).skeleton;
	const axis = spec.axis ?? boneByName(before, "root").appliedPose.worldX;
	const mirror = (x: number, y: number) => new Vector2(2 * axis - x, y);

	// Bones, parents first; each copy's frame is the reflected original with its y axis flipped back.
	for (const b of originals) {
		const pose = boneByName(before, b.name).appliedPose;
		const parent = partner.get(b.parent!) ?? b.parent!;
		const parentPose = boneByName(load(ws).skeleton, parent).appliedPose;
		const at = parentPose.worldToLocal(mirror(pose.worldX, pose.worldY));
		const copy: BoneJson = { ...structuredClone(b), name: partner.get(b.name)!, parent };
		const shearX = -(b.shearX ?? 0);
		let rotation = r2(rotationInto(parentPose, 180 - pose.getWorldRotationX()) - shearX);
		if (rotation <= -180) rotation += 360;
		for (const k of ["x", "y", "rotation", "shearX", "shearY"] as const) delete copy[k];
		if (r2(at.x)) copy.x = r2(at.x);
		if (r2(at.y)) copy.y = r2(at.y);
		if (rotation) copy.rotation = rotation;
		if (shearX) copy.shearX = shearX;
		if (b.shearY) copy.shearY = -b.shearY;
		ws.doc.bones.push(copy);
	}
	const after = load(ws).skeleton;
	const boneFor = (name: string) => partner.get(name) ?? (ws.doc.bones.some((b) => b.name === otherSide(name, spec.sides)) ? otherSide(name, spec.sides) : name);

	// Slots and their attachments, each copy drawn right above its original.
	const slotPartner = new Map<string, string>();
	const setupOrder = ws.doc.slots.map((s) => s.name);
	for (const s of ws.doc.slots.filter((s) => set.has(s.bone))) {
		const p = otherSide(s.name, spec.sides);
		if (p === s.name) throw new UserError(`slot "${s.name}" has no side in its name (left/right, l/r); rename it first`);
		if (ws.doc.slots.some((x) => x.name === p)) throw new UserError(`slot "${p}" already exists`);
		slotPartner.set(s.name, checkName("slot", p));
	}
	const vertexMirror = (att: Record<string, unknown>, slotBone: string, count: number): number[] => {
		const v = att.vertices as number[];
		const out: number[] = [];
		if (v.length === count * 2) {
			const from = boneByName(before, slotBone).appliedPose;
			const to = boneByName(after, boneFor(slotBone)).appliedPose;
			for (let i = 0; i < v.length; i += 2) {
				const w = from.localToWorld(new Vector2(v[i], v[i + 1]));
				const l = to.worldToLocal(mirror(w.x, w.y));
				out.push(r2(l.x), r2(l.y));
			}
			return out;
		}
		const names = ws.doc.bones.map((b) => b.name);
		for (let i = 0; i < v.length; ) {
			const n = v[i++];
			const entries: [number, number, number, number][] = [];
			for (let k = 0; k < n; k++, i += 4) {
				const name = names[v[i]];
				const w = boneByName(before, name).appliedPose.localToWorld(new Vector2(v[i + 1], v[i + 2]));
				const target = boneFor(name);
				const l = boneByName(after, target).appliedPose.worldToLocal(mirror(w.x, w.y));
				entries.push([names.indexOf(target), r2(l.x), r2(l.y), v[i + 3]]);
			}
			// Spine Editor needs each vertex's bones in skeleton order.
			entries.sort((a, b) => a[0] - b[0]);
			out.push(n, ...entries.flat());
		}
		return out;
	};
	const attachmentPartner = new Map<string, Map<string, string>>();
	for (const skin of ws.doc.skins) {
		for (const [slot, p] of slotPartner) {
			const atts = skin.attachments[slot];
			if (!atts) continue;
			const keyFor = (key: string) => {
				const k = otherSide(key, spec.sides);
				return k !== key && !atts[k] ? k : key;
			};
			const out: Record<string, AttachmentJson> = {};
			const slotBone = ws.doc.slots.find((s) => s.name === slot)!.bone;
			for (const [key, att] of Object.entries(atts)) {
				const copy = structuredClone(att) as Record<string, unknown>;
				const type = (att.type as string | undefined) ?? "region";
				if (type === "region" || type === "mesh") copy.path ??= key;
				if (type === "region") {
					if (copy.y) copy.y = -(copy.y as number);
					if (copy.rotation) copy.rotation = -(copy.rotation as number);
					copy.scaleY = -((copy.scaleY as number | undefined) ?? 1);
				} else if (type === "point") {
					if (copy.y) copy.y = -(copy.y as number);
					if (copy.rotation) copy.rotation = -(copy.rotation as number);
				} else if (type === "mesh") {
					copy.vertices = vertexMirror(copy, slotBone, (att as { uvs: number[] }).uvs.length / 2);
				} else if (type === "path" || type === "boundingbox" || type === "clipping") {
					copy.vertices = vertexMirror(copy, slotBone, copy.vertexCount as number);
					if (type === "clipping" && copy.end) copy.end = slotPartner.get(copy.end as string) ?? copy.end;
				} else if (type === "linkedmesh") {
					copy.parent = keyFor(copy.parent as string);
					copy.path ??= key;
				} else warnings.push(`${slot}/${key}: ${type} attachment copied unmirrored`);
				out[keyFor(key)] = copy as AttachmentJson;
				const names = attachmentPartner.get(slot) ?? new Map<string, string>();
				names.set(key, keyFor(key));
				attachmentPartner.set(slot, names);
			}
			skin.attachments[p] = out;
		}
	}
	for (const [slot, p] of slotPartner) {
		const index = ws.doc.slots.findIndex((s) => s.name === slot);
		const s = ws.doc.slots[index];
		const copy: SlotJson = { ...structuredClone(s), name: p, bone: partner.get(s.bone)! };
		if (s.attachment) copy.attachment = attachmentPartner.get(slot)?.get(s.attachment) ?? s.attachment;
		ws.doc.slots.splice(index + 1, 0, copy);
	}
	remapDrawOrders(ws.doc.animations, setupOrder, ws.doc.slots.map((s) => s.name));

	// IK and physics on the mirrored bones; the copy's flipped frame bends the other way.
	const constraints: string[] = [];
	const refs = (c: ConstraintJson) => [...((c.bones as string[] | undefined) ?? []), ...["bone", "target", "source"].map((k) => c[k]).filter((v): v is string => typeof v === "string")];
	for (const c of [...ws.doc.constraints]) {
		if (!refs(c).some((b) => set.has(b))) continue;
		const name = otherSide(c.name, spec.sides);
		if (c.type !== "ik" && c.type !== "physics") {
			warnings.push(`${c.type} constraint ${c.name} not mirrored; add the other side with constraint_add`);
			continue;
		}
		if (name === c.name || ws.doc.constraints.some((x) => x.name === name)) {
			warnings.push(`constraint ${c.name} not mirrored: ${name === c.name ? "no side in its name" : `"${name}" already exists`}`);
			continue;
		}
		const copy = structuredClone(c);
		copy.name = name;
		if (copy.bones) copy.bones = (copy.bones as string[]).map(boneFor);
		for (const k of ["bone", "target"]) if (typeof copy[k] === "string") copy[k] = boneFor(copy[k] as string);
		if (c.type === "ik") {
			if (c.bendPositive === false) delete copy.bendPositive;
			else copy.bendPositive = false;
		}
		ws.doc.constraints.splice(ws.doc.constraints.indexOf(c) + 1, 0, copy);
		constraints.push(name);
	}
	return { bones: [...partner.values()], slots: [...slotPartner.values()], constraints, warnings };
}

export interface MirrorAnimationSpec {
	animation: string;
	/** New animation (default <animation>-mirrored); the same name mirrors it in place. */
	to?: string;
	/**
	 * swap: each side plays what the other side did, values unchanged (side views: a walk led by the other
	 * leg). mirror: the whole motion reflected across a vertical line (front views: wave with the other hand).
	 */
	mode?: "swap" | "mirror";
	sides?: Sides;
}

type Matrix = [number, number, number, number];
const linear = (p: BonePose): Matrix => [p.a, p.b, p.c, p.d];

/** Reflection taking the original's local frame to the partner's: inverse(partner) · mirror · original. */
function reflection(from: Matrix, to: Matrix): Matrix {
	const [a, b, c, d] = [-from[0], -from[1], from[2], from[3]];
	const det = to[0] * to[3] - to[1] * to[2];
	const [ia, ib, ic, id] = [to[3] / det, -to[1] / det, -to[2] / det, to[0] / det];
	return [ia * a + ib * c, ia * b + ib * d, ic * a + id * c, ic * b + id * d];
}

const negateCurve = (curve: unknown, channels: boolean[]) => {
	if (!Array.isArray(curve)) return curve;
	return curve.map((v, i) => (i % 2 === 1 && channels[Math.floor(i / 4)] ? -v : v));
};

function scaled<K extends Record<string, unknown>>(keys: K[], fields: string[], signs: number[]): K[] {
	return keys.map((k) => {
		const out: Record<string, unknown> = { ...k };
		fields.forEach((f, i) => {
			if (typeof out[f] === "number" && signs[i] < 0) out[f] = -(out[f] as number) || 0;
		});
		if (Array.isArray(out.curve)) out.curve = negateCurve(out.curve, signs.map((s) => s < 0));
		return out as K;
	});
}

/** Swaps or mirrors an animation between the left and right sides of a rig. */
export function mirrorAnimation(ws: Workspace, spec: MirrorAnimationSpec): string {
	const src = ws.doc.animations[spec.animation];
	if (!src) throw new UserError(`animation "${spec.animation}" not found`);
	const to = checkName("animation", spec.to ?? `${spec.animation}-mirrored`);
	if (to !== spec.animation && ws.doc.animations[to]) throw new UserError(`animation "${to}" already exists`);
	assertUnlocked(ws, "animations", [to]);
	const mode = spec.mode ?? "swap";
	const warnings: string[] = [];
	const other = (names: string[]) => (n: string) => {
		const p = otherSide(n, spec.sides);
		return p !== n && names.includes(p) ? p : n;
	};
	const boneOf = other(ws.doc.bones.map((b) => b.name));
	const slotOf = other(ws.doc.slots.map((s) => s.name));
	const constraintOf = other(ws.doc.constraints.map((c) => c.name));
	const eventOf = other(Object.keys(ws.doc.events ?? {}));
	const attachmentOf = (slot: string, name: string) => {
		const p = otherSide(name, spec.sides);
		return p !== name && ws.doc.skins.some((sk) => sk.attachments[slot]?.[p]) ? p : name;
	};
	const skeleton = load(ws).skeleton;
	const pose = (bone: string) => boneByName(skeleton, bone).appliedPose;
	const mirror: Matrix = [-1, 0, 0, 1];
	const parentReflection = (bone: string): Matrix => {
		const p = findBone(ws, bone).parent;
		const q = findBone(ws, boneOf(bone)).parent;
		if (!p || !q) return mirror;
		return reflection(linear(pose(p)), linear(pose(q)));
	};

	const out = structuredClone(src) as AnimationJson & Record<string, unknown>;
	let moved = 0;
	if (src.bones) {
		out.bones = {};
		for (const [bone, timelines] of Object.entries(src.bones)) {
			const target = boneOf(bone);
			if (target !== bone) moved++;
			const copy = structuredClone(timelines);
			if (mode === "mirror") {
				const f = parentReflection(bone);
				if (Math.abs(f[1]) > 0.05 || Math.abs(f[2]) > 0.05)
					warnings.push(`${bone}: its parent and the other side's parent are not mirror images; translate keys are approximate`);
				const sx = f[0] < 0 ? -1 : 1;
				const sy = f[3] < 0 ? -1 : 1;
				for (const [name, keys] of Object.entries(copy)) {
					const k = keys as unknown as Record<string, unknown>[];
					if (name === "rotate") copy[name] = scaled(k, ["value"], [-1]) as ValueKey[];
					else if (name === "translate") copy[name] = scaled(k, ["x", "y"], [sx, sy]) as ValueKey[];
					else if (name === "translatex") copy[name] = scaled(k, ["value"], [sx]) as ValueKey[];
					else if (name === "translatey") copy[name] = scaled(k, ["value"], [sy]) as ValueKey[];
					else if (name === "shear") copy[name] = scaled(k, ["x", "y"], [-1, -1]) as ValueKey[];
					else if (name === "shearx" || name === "sheary") copy[name] = scaled(k, ["value"], [-1]) as ValueKey[];
				}
			}
			out.bones[target] = copy;
		}
	}
	if (src.slots) {
		out.slots = {};
		for (const [slot, timelines] of Object.entries(src.slots)) {
			const target = slotOf(slot);
			if (target !== slot) moved++;
			const copy = structuredClone(timelines);
			if (copy.attachment)
				copy.attachment = (copy.attachment as { name?: string | null }[]).map((k) => (k.name ? { ...k, name: attachmentOf(target, k.name) } : k));
			out.slots[target] = copy;
		}
	}
	for (const type of ["ik", "transform", "path", "physics", "slider"]) {
		const group = src[type] as Record<string, unknown> | undefined;
		if (!group) continue;
		const mapped: Record<string, unknown> = {};
		for (const [name, timelines] of Object.entries(group)) {
			const target = name ? constraintOf(name) : name;
			if (target !== name) moved++;
			let copy = structuredClone(timelines);
			if (type === "ik" && mode === "mirror") {
				// Bend direction relative to each side's setup: bending like the setup stays like the setup.
				const setup = (n: string) => ws.doc.constraints.find((c) => c.name === n)?.bendPositive !== false;
				const [from, into] = [setup(name), setup(target)];
				copy = (copy as { bendPositive?: boolean }[]).map((k) => {
					const bend = k.bendPositive ?? true;
					return { ...k, bendPositive: bend === from ? into : !into };
				});
			}
			mapped[target] = copy;
		}
		out[type] = mapped;
	}
	const attachments = src.attachments as Record<string, Record<string, Record<string, Record<string, unknown>>>> | undefined;
	if (attachments) {
		const mapped: typeof attachments = {};
		for (const [skin, slots] of Object.entries(attachments)) {
			mapped[skin] = {};
			for (const [slot, atts] of Object.entries(slots)) {
				const target = slotOf(slot);
				if (target !== slot) moved++;
				mapped[skin][target] = {};
				for (const [att, timelines] of Object.entries(atts)) {
					const copy = structuredClone(timelines);
					const name = attachmentOf(target, att);
					if (copy.deform && mode === "mirror") {
						const mesh = ws.doc.skins.find((s) => s.name === skin)?.attachments[target]?.[name] as { vertices?: number[]; uvs?: number[] } | undefined;
						const s = ws.doc.slots.find((x) => x.name === slot)!;
						const t = ws.doc.slots.find((x) => x.name === target)!;
						if (!mesh?.uvs || mesh.vertices!.length !== mesh.uvs.length) {
							warnings.push(`${slot}/${att}: deform keys on a weighted mesh left out`);
							delete copy.deform;
						} else {
							const f = reflection(linear(pose(s.bone)), linear(pose(t.bone)));
							copy.deform = (copy.deform as { offset?: number; vertices?: number[] }[]).map((k) => {
								if (!k.vertices) return k;
								const start = k.offset ?? 0;
								const v = k.vertices.map((value, i) => {
									const j = start + i;
									const [x, y] = j % 2 === 0 ? [value, k.vertices![i + 1] ?? 0] : [k.vertices![i - 1] ?? 0, value];
									return r3(j % 2 === 0 ? f[0] * x + f[1] * y : f[2] * x + f[3] * y);
								});
								return { ...k, vertices: v };
							});
						}
					}
					if (Object.keys(copy).length) mapped[skin][target][name] = copy;
				}
			}
		}
		out.attachments = mapped;
	}
	if (src.drawOrder) {
		const setup = ws.doc.slots.map((s) => s.name);
		out.drawOrder = (src.drawOrder as DrawOrderJson[]).map((k) => {
			const names = offsetsToNames(setup, k.offsets).map(slotOf);
			const offsets = orderToOffsets(setup, names.map((n) => setup.indexOf(n)));
			const key: DrawOrderJson = { ...k };
			if (offsets) key.offsets = offsets;
			else delete key.offsets;
			return key;
		});
	}
	if (src.events) out.events = (src.events as { name: string }[]).map((e) => ({ ...e, name: eventOf(e.name) }));

	ws.doc.animations[to] = out;
	ws.meta.loops[to] = ws.meta.loops[spec.animation] ?? true;
	const lines = [`${mode === "mirror" ? "mirrored" : "swapped"} ${spec.animation} into ${to}: ${moved} timeline group(s) changed side`];
	if (!moved) warnings.push("no timeline has a left/right partner; check the names or give sides");
	return [...lines, ...warnings.map((w) => `warning: ${w}`)].join("\n");
}
