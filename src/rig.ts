// Rig editing: bones, slots, attachments, meshes and constraints.
import { basename, join } from "node:path";
import { type BonePose, Vector2 } from "@esotericsoftware/spine-core";
import { imageSize, readPng } from "./atlas.js";
import { type ContourOptions, contourMesh } from "./contour.js";
import { remapDrawOrders } from "./draworder.js";
import { boneByName, load } from "./runtime.js";
import type { AttachmentJson, BoneJson, ConstraintJson, MeshJson, RegionJson, SlotJson } from "./types.js";
import { checkName, UserError, type Workspace } from "./workspace.js";

export type Space = "local" | "world";

export function assertUnlocked(ws: Workspace, kind: "bones" | "slots" | "animations", names: string[]): void {
	const locked = names.filter((n) => ws.meta.locks[kind].includes(n));
	if (locked.length) throw new UserError(`locked ${kind}: ${locked.join(", ")} (use lock_set to unlock)`);
}

export function findBone(ws: Workspace, name: string): BoneJson {
	const bone = ws.doc.bones.find((b) => b.name === name);
	if (!bone) throw new UserError(`bone "${name}" not found`);
	return bone;
}

export function findSlot(ws: Workspace, name: string): SlotJson {
	const slot = ws.doc.slots.find((s) => s.name === name);
	if (!slot) throw new UserError(`slot "${name}" not found`);
	return slot;
}

function defaultSkin(ws: Workspace) {
	const skin = ws.doc.skins.find((s) => s.name === "default");
	if (!skin) throw new UserError("default skin missing");
	return skin;
}

function descendants(ws: Workspace, name: string): Set<string> {
	const out = new Set<string>([name]);
	for (const b of ws.doc.bones) if (b.parent && out.has(b.parent)) out.add(b.name);
	return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

// BonePose.worldToLocalRotation converts for the bone itself; these convert for things parented to it.
function rotationInto(frame: BonePose, worldRotation: number): number {
	const r = (worldRotation * Math.PI) / 180;
	const sin = Math.sin(r);
	const cos = Math.cos(r);
	return (Math.atan2(frame.a * sin - frame.c * cos, frame.d * cos - frame.b * sin) * 180) / Math.PI;
}

function rotationOutOf(frame: BonePose, localRotation: number): number {
	const r = (localRotation * Math.PI) / 180;
	const sin = Math.sin(r);
	const cos = Math.cos(r);
	return (Math.atan2(cos * frame.c + sin * frame.d, cos * frame.a + sin * frame.b) * 180) / Math.PI;
}

function toLocal(parent: BonePose, x: number, y: number, rotation: number) {
	const p = parent.worldToLocal(new Vector2(x, y));
	return { x: round(p.x), y: round(p.y), rotation: round(rotationInto(parent, rotation)) };
}

function toWorld(parent: BonePose, x: number, y: number, rotation: number) {
	const p = parent.localToWorld(new Vector2(x, y));
	return { x: p.x, y: p.y, rotation: rotationOutOf(parent, rotation) };
}

/** Current world transform (setup pose) of a bone's origin, plus its world rotation. */
function boneWorld(ws: Workspace, name: string) {
	const pose = boneByName(load(ws).skeleton, name).appliedPose;
	return { x: pose.worldX, y: pose.worldY, rotation: pose.getWorldRotationX() };
}

export interface BoneSpec {
	name: string;
	parent?: string;
	x?: number;
	y?: number;
	rotation?: number;
	length?: number;
	scaleX?: number;
	scaleY?: number;
	color?: string;
	space?: Space;
}

export function addBone(ws: Workspace, spec: BoneSpec): BoneJson {
	checkName("bone", spec.name);
	if (ws.doc.bones.some((b) => b.name === spec.name)) throw new UserError(`bone "${spec.name}" already exists`);
	const parent = spec.parent ?? "root";
	findBone(ws, parent);
	let { x = 0, y = 0, rotation = 0 } = spec;
	if (spec.space === "world") {
		const parentPose = boneByName(load(ws).skeleton, parent).appliedPose;
		({ x, y, rotation } = toLocal(parentPose, x, y, rotation));
	}
	const bone: BoneJson = { name: spec.name, parent };
	if (spec.length) bone.length = spec.length;
	if (x) bone.x = x;
	if (y) bone.y = y;
	if (rotation) bone.rotation = rotation;
	if (spec.scaleX !== undefined) bone.scaleX = spec.scaleX;
	if (spec.scaleY !== undefined) bone.scaleY = spec.scaleY;
	if (spec.color) bone.color = spec.color;
	ws.doc.bones.push(bone);
	return bone;
}

export interface BoneUpdate extends Partial<Omit<BoneSpec, "name">> {
	name: string;
	rename?: string;
}

export function updateBone(ws: Workspace, u: BoneUpdate): BoneJson {
	assertUnlocked(ws, "bones", [u.name]);
	const bone = findBone(ws, u.name);
	if (bone.name === "root" && (u.parent || u.rename)) throw new UserError("root bone cannot be reparented or renamed");

	if (u.parent && u.parent !== bone.parent) {
		findBone(ws, u.parent);
		if (descendants(ws, bone.name).has(u.parent))
			throw new UserError(`"${u.parent}" is a descendant of "${bone.name}"`);
		// Keep the bone where it is in the world unless new coordinates are given.
		const world = boneWorld(ws, bone.name);
		bone.parent = u.parent;
		reorderBones(ws);
		const parentPose = boneByName(load(ws).skeleton, u.parent).appliedPose;
		Object.assign(bone, toLocal(parentPose, world.x, world.y, world.rotation));
	}

	if (u.x !== undefined || u.y !== undefined || u.rotation !== undefined) {
		if (u.space === "world") {
			const current = boneWorld(ws, bone.name);
			const parentPose = boneByName(load(ws).skeleton, bone.parent ?? "root").appliedPose;
			Object.assign(
				bone,
				toLocal(parentPose, u.x ?? current.x, u.y ?? current.y, u.rotation ?? current.rotation),
			);
		} else {
			if (u.x !== undefined) bone.x = u.x;
			if (u.y !== undefined) bone.y = u.y;
			if (u.rotation !== undefined) bone.rotation = u.rotation;
		}
	}
	if (u.length !== undefined) bone.length = u.length;
	if (u.scaleX !== undefined) bone.scaleX = u.scaleX;
	if (u.scaleY !== undefined) bone.scaleY = u.scaleY;
	if (u.color !== undefined) bone.color = u.color;

	if (u.rename) renameBone(ws, bone.name, checkName("bone", u.rename));
	return bone;
}

function renameBone(ws: Workspace, from: string, to: string): void {
	if (ws.doc.bones.some((b) => b.name === to)) throw new UserError(`bone "${to}" already exists`);
	for (const b of ws.doc.bones) {
		if (b.name === from) b.name = to;
		if (b.parent === from) b.parent = to;
	}
	for (const s of ws.doc.slots) if (s.bone === from) s.bone = to;
	const swap = (v: unknown) => (v === from ? to : v);
	for (const c of ws.doc.constraints)
		for (const [k, v] of Object.entries(c)) c[k] = Array.isArray(v) ? v.map(swap) : swap(v);
	for (const a of Object.values(ws.doc.animations)) {
		if (a.bones?.[from]) {
			a.bones[to] = a.bones[from];
			delete a.bones[from];
		}
	}
	ws.meta.locks.bones = ws.meta.locks.bones.map((n) => (n === from ? to : n));
}

/** Parents must precede children in Spine JSON. */
function reorderBones(ws: Workspace): void {
	const placed = new Set<string>();
	const out: BoneJson[] = [];
	let pending = [...ws.doc.bones];
	while (pending.length) {
		const next = pending.filter((b) => !b.parent || placed.has(b.parent));
		if (!next.length) throw new UserError("bone hierarchy has a cycle");
		for (const b of next) {
			out.push(b);
			placed.add(b.name);
		}
		pending = pending.filter((b) => !placed.has(b.name));
	}
	ws.doc.bones = out;
}

export function removeBone(ws: Workspace, name: string): void {
	assertUnlocked(ws, "bones", [name]);
	if (name === "root") throw new UserError("cannot remove root");
	findBone(ws, name);
	const refs: string[] = [];
	for (const b of ws.doc.bones) if (b.parent === name) refs.push(`child bone ${b.name}`);
	for (const s of ws.doc.slots) if (s.bone === name) refs.push(`slot ${s.name}`);
	for (const c of ws.doc.constraints) if (JSON.stringify(c).includes(`"${name}"`)) refs.push(`constraint ${c.name}`);
	if (refs.length) throw new UserError(`bone "${name}" is still used by: ${refs.join(", ")}`);
	ws.doc.bones = ws.doc.bones.filter((b) => b.name !== name);
	for (const a of Object.values(ws.doc.animations)) delete a.bones?.[name];
}

export interface ImageItem {
	path: string;
	name?: string;
	x?: number;
	y?: number;
	bone?: string;
}

/** Imports PNGs, each as a slot with a region attachment centered at world (x, y). */
export function importImages(ws: Workspace, items: ImageItem[]): { slot: string; width: number; height: number }[] {
	return items.map((item) => {
		const name = item.name ?? basename(item.path).replace(/\.png$/i, "");
		if (ws.doc.slots.some((s) => s.name === name)) throw new UserError(`slot "${name}" already exists`);
		ws.addImage(item.path, name);
		return addPart(ws, { image: name, x: item.x, y: item.y, bone: item.bone });
	});
}

export interface Part {
	image: string;
	x?: number;
	y?: number;
	bone?: string;
	slot?: Partial<SlotJson>;
}

/** Adds an image already in the workspace as a new slot (on top) with a region attachment at world (x, y). */
export function addPart(ws: Workspace, part: Part): { slot: string; width: number; height: number } {
	const name = part.image;
	if (ws.doc.slots.some((s) => s.name === name)) throw new UserError(`slot "${name}" already exists`);
	const { width, height } = imageSize(ws.imagePath(name));
	const bone = part.bone ?? "root";
	const parentPose = boneByName(load(ws).skeleton, bone).appliedPose;
	const local = toLocal(parentPose, part.x ?? 0, part.y ?? 0, 0);
	const region: RegionJson = { width, height };
	if (local.x) region.x = local.x;
	if (local.y) region.y = local.y;
	if (local.rotation) region.rotation = local.rotation;
	ws.doc.slots.push({ ...part.slot, name, bone, attachment: name });
	defaultSkin(ws).attachments[name] = { [name]: region };
	return { slot: name, width, height };
}

export interface SequenceSpec {
	/** Attachment name; also the slot name when a new slot is made. */
	name: string;
	/** PNG frames, in playing order. */
	images: string[];
	/** Existing slot to add the attachment to (default: a new slot named after it, on top). */
	slot?: string;
	x?: number;
	y?: number;
	bone?: string;
	/** Frame shown in the setup pose (0-based). */
	setup?: number;
}

/**
 * Imports frames as an image sequence region: images <name>/<name>01, <name>/<name>02, ... (Spine's numbered
 * path convention), sized by the first frame and centered at world (x, y).
 */
export function importSequence(ws: Workspace, spec: SequenceSpec): { slot: string; frames: number; width: number; height: number; warnings: string[] } {
	checkName("attachment", spec.name);
	const count = spec.images.length;
	if (count < 2) throw new UserError("a sequence needs at least 2 frames");
	const setup = spec.setup ?? 0;
	if (setup < 0 || setup >= count) throw new UserError(`setup frame ${setup} is outside the ${count} frames`);
	const digits = Math.max(2, String(count).length);
	const base = `${spec.name}/${spec.name}`;
	const slotName = spec.slot ?? spec.name;
	if (spec.slot) assertUnlocked(ws, "slots", [spec.slot]);
	const existing = spec.slot ? findSlot(ws, spec.slot) : undefined;
	if (!existing && ws.doc.slots.some((s) => s.name === slotName)) throw new UserError(`slot "${slotName}" already exists`);
	if (defaultSkin(ws).attachments[slotName]?.[spec.name]) throw new UserError(`attachment "${spec.name}" already exists in slot "${slotName}"`);
	const sizes = spec.images.map((path) => imageSize(path));
	const { width, height } = sizes[0];
	const warnings = sizes.some((s) => s.width !== width || s.height !== height)
		? [`frames differ in size; all are shown at ${width}x${height} (the first frame's size)`]
		: [];
	spec.images.forEach((path, i) => ws.addImage(path, `${base}${String(i + 1).padStart(digits, "0")}`));
	const bone = existing?.bone ?? spec.bone ?? "root";
	const parentPose = boneByName(load(ws).skeleton, bone).appliedPose;
	const local = toLocal(parentPose, spec.x ?? 0, spec.y ?? 0, 0);
	const region: RegionJson = { path: base, width, height, sequence: { count, start: 1, digits, ...(setup ? { setup } : {}) } };
	if (local.x) region.x = local.x;
	if (local.y) region.y = local.y;
	if (local.rotation) region.rotation = local.rotation;
	if (!existing) ws.doc.slots.push({ name: slotName, bone, attachment: spec.name });
	(defaultSkin(ws).attachments[slotName] ??= {})[spec.name] = region;
	return { slot: slotName, frames: count, width, height, warnings };
}

export interface SlotUpdate {
	name: string;
	bone?: string;
	keepWorld?: boolean;
	attachment?: string | null;
	color?: string;
	blend?: string;
	drawOrder?: number;
}

export function updateSlot(ws: Workspace, u: SlotUpdate): SlotJson {
	assertUnlocked(ws, "slots", [u.name]);
	const slot = findSlot(ws, u.name);
	if (u.bone && u.bone !== slot.bone) {
		findBone(ws, u.bone);
		if (u.keepWorld !== false) {
			const skeleton = load(ws).skeleton;
			const from = boneByName(skeleton, slot.bone).appliedPose;
			const to = boneByName(skeleton, u.bone).appliedPose;
			for (const skin of ws.doc.skins) {
				for (const att of Object.values(skin.attachments[slot.name] ?? {})) {
					if (att.type === undefined || att.type === "region") {
						const r = att as RegionJson;
						const w = toWorld(from, r.x ?? 0, r.y ?? 0, r.rotation ?? 0);
						Object.assign(r, toLocal(to, w.x, w.y, w.rotation));
					} else if (att.type === "mesh" && !isWeighted(att as MeshJson)) {
						const m = att as MeshJson;
						for (let i = 0; i < m.vertices.length; i += 2) {
							const p = to.worldToLocal(from.localToWorld(new Vector2(m.vertices[i], m.vertices[i + 1])));
							m.vertices[i] = round(p.x);
							m.vertices[i + 1] = round(p.y);
						}
					}
				}
			}
		}
		slot.bone = u.bone;
	}
	if (u.attachment !== undefined) {
		if (u.attachment === null) delete slot.attachment;
		else slot.attachment = u.attachment;
	}
	if (u.color) slot.color = u.color;
	if (u.blend) slot.blend = u.blend;
	if (u.drawOrder !== undefined) {
		const before = ws.doc.slots.map((s) => s.name);
		const i = ws.doc.slots.indexOf(slot);
		ws.doc.slots.splice(i, 1);
		ws.doc.slots.splice(Math.max(0, Math.min(u.drawOrder, ws.doc.slots.length)), 0, slot);
		// Draw order keys are offsets from the setup order; keep each key showing the same order.
		remapDrawOrders(ws.doc.animations, before, ws.doc.slots.map((s) => s.name));
	}
	return slot;
}

function isWeighted(m: MeshJson): boolean {
	return m.vertices.length > m.uvs.length;
}

export interface AttachmentUpdate {
	slot: string;
	attachment?: string;
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	space?: Space;
}

export function updateAttachment(ws: Workspace, u: AttachmentUpdate): RegionJson {
	assertUnlocked(ws, "slots", [u.slot]);
	const slot = findSlot(ws, u.slot);
	const name = u.attachment ?? slot.attachment ?? u.slot;
	const att = defaultSkin(ws).attachments[slot.name]?.[name];
	if (!att) throw new UserError(`attachment "${name}" not found in slot "${slot.name}"`);
	if (att.type !== undefined && att.type !== "region")
		throw new UserError(`attachment "${name}" is a ${att.type}; only regions can be moved this way`);
	const r = att as RegionJson;
	if (u.space === "world") {
		const pose = boneByName(load(ws).skeleton, slot.bone).appliedPose;
		const w = toWorld(pose, r.x ?? 0, r.y ?? 0, r.rotation ?? 0);
		Object.assign(r, toLocal(pose, u.x ?? w.x, u.y ?? w.y, u.rotation ?? w.rotation));
	} else {
		if (u.x !== undefined) r.x = u.x;
		if (u.y !== undefined) r.y = u.y;
		if (u.rotation !== undefined) r.rotation = u.rotation;
	}
	if (u.scaleX !== undefined) r.scaleX = u.scaleX;
	if (u.scaleY !== undefined) r.scaleY = u.scaleY;
	return r;
}

export interface MeshSpec extends ContourOptions {
	slot: string;
	attachment?: string;
	/** contour follows the opaque outline of the image; grid covers the whole rectangle. */
	shape?: "contour" | "grid";
	cols?: number;
	rows?: number;
	bones?: string[];
	maxInfluences?: number;
}

/** Replaces a region attachment with a mesh, optionally weighted to bones by distance. */
export function generateMesh(ws: Workspace, spec: MeshSpec): { vertices: number; triangles: number; warnings: string[] } {
	assertUnlocked(ws, "slots", [spec.slot]);
	const slot = findSlot(ws, spec.slot);
	const name = spec.attachment ?? slot.attachment ?? spec.slot;
	const skin = defaultSkin(ws);
	const att = skin.attachments[slot.name]?.[name];
	if (!att) throw new UserError(`attachment "${name}" not found in slot "${slot.name}"`);
	if (att.type !== undefined && att.type !== "region") throw new UserError(`attachment "${name}" is not a region`);
	const r = att as RegionJson;

	// Vertices as UVs (0..1, y down), hull first and in order around the outline.
	let uv: [number, number][];
	let triangles: number[];
	let hull: number;
	let warnings: string[] = [];
	if ((spec.shape ?? "contour") === "contour") {
		const png = readPng(ws.imagePath(r.path ?? name));
		const m = contourMesh(png, spec);
		uv = m.points.map(([x, y]) => [x / png.width, y / png.height]);
		({ triangles, hull, warnings } = m);
	} else {
		({ uv, triangles, hull } = gridMesh(Math.max(1, Math.round(spec.cols ?? 4)), Math.max(1, Math.round(spec.rows ?? 4))));
	}

	const local: number[] = [];
	const rad = ((r.rotation ?? 0) * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	for (const [u, v] of uv) {
		const ox = (u - 0.5) * r.width * (r.scaleX ?? 1);
		const oy = (0.5 - v) * r.height * (r.scaleY ?? 1);
		local.push((r.x ?? 0) + ox * cos - oy * sin, (r.y ?? 0) + ox * sin + oy * cos);
	}
	let vertices = local.map(round);
	if (spec.bones?.length) vertices = weigh(ws, slot.bone, local, spec.bones, spec.maxInfluences ?? 3);
	const uvs = uv.flatMap(([u, v]) => [Math.round(u * 1e5) / 1e5, Math.round(v * 1e5) / 1e5]);
	// Edges (vertex index * 2, pairs) are editor-only data; without them Spine Editor warns on import
	// that the file was exported without nonessential data. The hull outline is the only edge loop.
	const edges = Array.from({ length: hull }, (_, i) => [i * 2, ((i + 1) % hull) * 2]).flat();
	const mesh: MeshJson = { type: "mesh", uvs, triangles, vertices, hull, edges, width: r.width, height: r.height };
	if (r.path) mesh.path = r.path;
	skin.attachments[slot.name][name] = mesh;
	return { vertices: uv.length, triangles: triangles.length / 3, warnings };
}

function gridMesh(cols: number, rows: number) {
	const order: [number, number][] = [];
	for (let i = 0; i < cols; i++) order.push([i, 0]);
	for (let j = 0; j < rows; j++) order.push([cols, j]);
	for (let i = cols; i > 0; i--) order.push([i, rows]);
	for (let j = rows; j > 0; j--) order.push([0, j]);
	const hull = order.length;
	for (let j = 1; j < rows; j++) for (let i = 1; i < cols; i++) order.push([i, j]);
	const index = new Map(order.map(([i, j], k) => [`${i},${j}`, k]));
	const triangles: number[] = [];
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			const a = index.get(`${i},${j}`)!;
			const b = index.get(`${i + 1},${j}`)!;
			const c = index.get(`${i + 1},${j + 1}`)!;
			const d = index.get(`${i},${j + 1}`)!;
			triangles.push(a, b, c, c, d, a);
		}
	}
	return { uv: order.map(([i, j]) => [i / cols, j / rows] as [number, number]), triangles, hull };
}

/** Inverse-square distance to each bone segment, keeping the strongest influences. */
function weigh(ws: Workspace, slotBone: string, local: number[], boneNames: string[], maxInfluences: number): number[] {
	const skeleton = load(ws).skeleton;
	const slotPose = boneByName(skeleton, slotBone).appliedPose;
	const bones = boneNames.map((n) => {
		const bone = boneByName(skeleton, n);
		const p = bone.appliedPose;
		const len = bone.data.length || 1;
		return { index: bone.data.index, pose: p, ax: p.worldX, ay: p.worldY, bx: p.worldX + p.a * len, by: p.worldY + p.c * len };
	});
	const out: number[] = [];
	for (let i = 0; i < local.length; i += 2) {
		const w = slotPose.localToWorld(new Vector2(local[i], local[i + 1]));
		const scored = bones
			.map((b) => {
				const dx = b.bx - b.ax;
				const dy = b.by - b.ay;
				const t = Math.max(0, Math.min(1, ((w.x - b.ax) * dx + (w.y - b.ay) * dy) / (dx * dx + dy * dy || 1)));
				const d = Math.hypot(w.x - (b.ax + t * dx), w.y - (b.ay + t * dy));
				return { b, score: 1 / (d * d + 1) };
			})
			.sort((p, q) => q.score - p.score)
			.slice(0, maxInfluences);
		const total = scored.reduce((s, x) => s + x.score, 0);
		const weights = scored.map((x) => Math.round((x.score / total) * 1000) / 1000);
		weights[0] = Math.round((1 - weights.slice(1).reduce((s, x) => s + x, 0)) * 1000) / 1000;
		// Spine Editor fails to import some weighted meshes ("Index -2 out of bounds") unless each vertex
		// lists its bones in skeleton order; the runtime accepts any order.
		const kept = scored
			.map((x, k) => ({ ...x, weight: weights[k] }))
			.filter((x) => x.weight > 0)
			.sort((p, q) => p.b.index - q.b.index);
		out.push(kept.length);
		for (const { b, weight } of kept) {
			const p = b.pose.worldToLocal(new Vector2(w.x, w.y));
			out.push(b.index, round(p.x), round(p.y), weight);
		}
	}
	return out;
}

/** Cumulative length of each bezier segment of a path, vertexCount/3 entries like Spine writes (the last closes the
 * loop). The runtime reads them only when constantSpeed is false, and Spine recomputes them on import. */
export function pathLengths(v: number[]): number[] {
	const n = v.length / 6;
	const out: number[] = [];
	let total = 0;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const [x0, y0, x1, y1, x2, y2, x3, y3] = [v[i * 6 + 2], v[i * 6 + 3], v[i * 6 + 4], v[i * 6 + 5], v[j * 6], v[j * 6 + 1], v[j * 6 + 2], v[j * 6 + 3]];
		let px = x0;
		let py = y0;
		for (let k = 1; k <= 64; k++) {
			const t = k / 64;
			const u = 1 - t;
			const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
			const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
			total += Math.hypot(x - px, y - py);
			px = x;
			py = y;
		}
		out.push(Math.round(total * 1e4) / 1e4);
	}
	return out;
}

/** Smooth path through world points (Catmull-Rom handles), in the bone's local space: [in, point, out] per point. */
function pathThrough(ws: Workspace, bone: string, points: { x: number; y: number }[], closed: boolean): number[] {
	const frame = boneByName(load(ws).skeleton, bone).appliedPose;
	const n = points.length;
	const at = (i: number) => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
	const world: number[] = [];
	points.forEach((p, i) => {
		const [a, b] = [at(i - 1), at(i + 1)];
		// One-sided at open ends; a third of the neighbour distance keeps the curve from overshooting.
		const k = !closed && (i === 0 || i === n - 1) ? 1 / 3 : 1 / 6;
		const tx = (b.x - a.x) * k;
		const ty = (b.y - a.y) * k;
		world.push(p.x - tx, p.y - ty, p.x, p.y, p.x + tx, p.y + ty);
	});
	const local: number[] = [];
	for (let i = 0; i < world.length; i += 2) {
		const q = frame.worldToLocal(new Vector2(world[i], world[i + 1]));
		local.push(round(q.x), round(q.y));
	}
	return local;
}

export function addConstraint(ws: Workspace, c: ConstraintJson): ConstraintJson {
	checkName("constraint", c.name);
	if (ws.doc.constraints.some((x) => x.name === c.name)) throw new UserError(`constraint "${c.name}" already exists`);
	const boneRefs = [
		...((c.bones as string[] | undefined) ?? []),
		...["bone", "target", "source"].map((k) => c[k]).filter((v): v is string => typeof v === "string"),
	];
	for (const b of boneRefs) findBone(ws, b);
	if (c.type === "path") {
		const { points, closed, pathBone, ...rest } = c as ConstraintJson & { points?: { x: number; y: number }[]; closed?: boolean; pathBone?: string };
		const slotName = (rest.slot as string | undefined) ?? `${c.name}-path`;
		const existing = ws.doc.slots.find((s) => s.name === slotName);
		if (points) {
			if (existing) throw new UserError(`slot "${slotName}" already exists; give points only for a new path`);
			if (points.length < 2) throw new UserError("a path needs at least 2 points");
			const bone = pathBone ?? "root";
			findBone(ws, bone);
			const vertices = pathThrough(ws, bone, points, closed ?? false);
			const path: AttachmentJson = { type: "path", vertexCount: vertices.length / 2, vertices, lengths: pathLengths(vertices) };
			if (closed) path.closed = true;
			ws.doc.slots.push({ name: slotName, bone, attachment: slotName });
			(defaultSkin(ws).attachments[slotName] ??= {})[slotName] = path;
		} else {
			if (!existing) throw new UserError(`path slot "${slotName}" not found: give points to create it`);
			const atts = ws.doc.skins.flatMap((sk) => Object.values(sk.attachments[slotName] ?? {}));
			if (!atts.some((a) => a.type === "path")) throw new UserError(`slot "${slotName}" has no path attachment`);
		}
		c = { ...rest, slot: slotName } as ConstraintJson;
	}
	if (c.type === "slider") {
		const animation = c.animation as string | undefined;
		if (!animation || !ws.doc.animations[animation]) throw new UserError(`slider "${c.name}" needs an existing animation (got ${animation ?? "none"})`);
		if (c.bone && !c.property) throw new UserError("a bone-driven slider needs property: rotate, x, y, scaleX, scaleY or shearY");
	}
	if (c.type === "ik") {
		const bones = c.bones as string[];
		if (bones.length < 1 || bones.length > 2) throw new UserError("ik takes 1 or 2 bones");
		if (bones.length === 2 && findBone(ws, bones[1]).parent !== bones[0])
			throw new UserError(`ik bones must be parent then child: "${bones[1]}" is not a child of "${bones[0]}"`);
		if (descendants(ws, bones[0]).has(c.target as string))
			throw new UserError(`ik target "${c.target}" must not be a child of the constrained bones`);
	}
	ws.doc.constraints.push(c);
	return c;
}

export function removeConstraint(ws: Workspace, name: string): void {
	const before = ws.doc.constraints.length;
	ws.doc.constraints = ws.doc.constraints.filter((c) => c.name !== name);
	if (ws.doc.constraints.length === before) throw new UserError(`constraint "${name}" not found`);
	for (const a of Object.values(ws.doc.animations))
		for (const type of ["ik", "transform", "path", "physics", "slider"]) {
			const group = a[type] as Record<string, unknown> | undefined;
			if (!group || !(name in group)) continue;
			delete group[name];
			if (!Object.keys(group).length) delete a[type];
		}
}

/** Compact text view of the rig for the model to read. */
export function describe(ws: Workspace): string {
	const lines: string[] = [`project ${ws.meta.name} v${ws.meta.version}`, "bones:"];
	const walk = (name: string, depth: number) => {
		const b = findBone(ws, name);
		const t = [b.x && `x=${b.x}`, b.y && `y=${b.y}`, b.rotation && `rot=${b.rotation}`, b.length && `len=${b.length}`]
			.filter(Boolean)
			.join(" ");
		const lock = ws.meta.locks.bones.includes(name) ? " [locked]" : "";
		lines.push(`${"  ".repeat(depth + 1)}${name}${t ? ` (${t})` : ""}${lock}`);
		for (const c of ws.doc.bones.filter((x) => x.parent === name)) walk(c.name, depth + 1);
	};
	walk("root", 0);
	lines.push("slots (back to front):");
	for (const s of ws.doc.slots) {
		const atts = Object.entries(defaultSkin(ws).attachments[s.name] ?? {})
			.map(([n, a]) => `${n}:${a.type ?? "region"}`)
			.join(", ");
		lines.push(`  ${s.name} -> bone ${s.bone}; shows ${s.attachment ?? "nothing"}; attachments ${atts || "none"}`);
	}
	lines.push("constraints:");
	for (const c of ws.doc.constraints) {
		const { type, name, ...rest } = c;
		lines.push(`  ${type} ${name} ${JSON.stringify(rest)}`);
	}
	lines.push("animations:");
	for (const [name, a] of Object.entries(ws.doc.animations)) {
		const tracks = Object.entries(a.bones ?? {}).flatMap(([b, tl]) => Object.keys(tl).map((t) => `${b}.${t}`));
		const events = (a.events ?? []) as { time?: number; name: string }[];
		if (events.length) tracks.push(`events ${events.map((e) => `${e.name}@${e.time ?? 0}`).join(" ")}`);
		if (a.drawOrder) tracks.push(`draw order (${(a.drawOrder as unknown[]).length} keys)`);
		lines.push(`  ${name}${ws.meta.loops[name] ? " (loop)" : ""}: ${tracks.join(", ") || "empty"}`);
	}
	const events = Object.entries(ws.doc.events ?? {});
	if (events.length) lines.push(`events: ${events.map(([n, e]) => (Object.keys(e).length ? `${n} ${JSON.stringify(e)}` : n)).join(", ")}`);
	const named = ws.doc.skins.filter((s) => s.name !== "default");
	if (named.length) {
		lines.push("skins:");
		for (const s of named) {
			const swaps = Object.entries(s.attachments).flatMap(([slot, atts]) => Object.keys(atts).map((a) => `${slot}/${a}`));
			lines.push(`  ${s.name}: ${swaps.join(", ") || "no changes yet"}`);
		}
	}
	lines.push(`images: ${ws.imageNames().join(", ") || "none"}`);
	return lines.join("\n");
}
