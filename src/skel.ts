// Converts a binary Spine 4.3 skeleton (.skel) to skeleton JSON. The official runtime reads the binary;
// this walks the resulting SkeletonData and writes the JSON the runtime's JSON reader expects.
// Bezier curves are stored by the runtime as 9 samples at t = 0.1 .. 0.9; the control points are
// recovered exactly by least squares on those samples.
import {
	AlphaTimeline,
	type Animation,
	type Attachment,
	AttachmentTimeline,
	AtlasAttachmentLoader,
	BlendMode,
	BoundingBoxAttachment,
	ClippingAttachment,
	type Color,
	type CurveTimeline,
	DeformTimeline,
	DrawOrderTimeline,
	EventTimeline,
	IkConstraintData,
	IkConstraintTimeline,
	Inherit,
	InheritTimeline,
	MeshAttachment,
	PathAttachment,
	PhysicsConstraintData,
	PhysicsConstraintDampingTimeline,
	PhysicsConstraintGravityTimeline,
	PhysicsConstraintInertiaTimeline,
	PhysicsConstraintMassTimeline,
	PhysicsConstraintMixTimeline,
	PhysicsConstraintResetTimeline,
	PhysicsConstraintStrengthTimeline,
	PhysicsConstraintWindTimeline,
	PointAttachment,
	RegionAttachment,
	RGBA2Timeline,
	RGBATimeline,
	RGB2Timeline,
	RGBTimeline,
	RotateTimeline,
	ScaleTimeline,
	ScaleXTimeline,
	ScaleYMode,
	ScaleYTimeline,
	ShearTimeline,
	ShearXTimeline,
	ShearYTimeline,
	type SkeletonData,
	SkeletonBinary,
	type Skin,
	TextureAtlas,
	type TextureAtlasRegion,
	type Timeline,
	TranslateTimeline,
	TranslateXTimeline,
	TranslateYTimeline,
	type VertexAttachment,
} from "@esotericsoftware/spine-core";
import type { SkeletonDoc } from "./types.js";
import { UserError } from "./workspace.js";

type Json = Record<string, unknown>;

/** Loader that gives every attachment a placeholder region: conversion needs geometry, not pixels. */
class PlaceholderLoader extends AtlasAttachmentLoader {
	private readonly region: TextureAtlasRegion;
	constructor() {
		const atlas = new TextureAtlas("placeholder.png\nsize:1,1\nfilter:Linear,Linear\nplaceholder\nbounds:0,0,1,1\n");
		super(atlas);
		this.region = atlas.regions[0];
	}
	protected findRegion(): TextureAtlasRegion {
		return this.region;
	}
}

/** Shortest decimal that round-trips the runtime's float32 value. */
const r = (n: number) => {
	const v = Number(Math.fround(n).toPrecision(7));
	return Object.is(v, -0) ? 0 : v;
};
const hex = (c: number) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0");
const rgba = (c: Color) => `${hex(c.r)}${hex(c.g)}${hex(c.b)}${hex(c.a)}`;
const rgb = (c: Color) => `${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);
/** Sets key only when the value differs from the JSON reader's default. */
function put(o: Json, key: string, value: unknown, fallback?: unknown): void {
	if (value === undefined || value === null) return;
	if (typeof value === "number" && typeof fallback === "number" && Math.abs(value - fallback) < 1e-6) return;
	if (value === fallback) return;
	o[key] = typeof value === "number" ? r(value) : value;
}

export function skelToJson(binary: Uint8Array): SkeletonDoc {
	let data: SkeletonData;
	try {
		// Copy first: the reader wraps binary.buffer from offset 0, and Node buffers are often slices of a pool.
		data = new SkeletonBinary(new PlaceholderLoader()).readSkeletonData(new Uint8Array(binary));
	} catch (e) {
		throw new UserError(`could not read the .skel file: ${(e as Error).message}`);
	}
	const unsupported = new Set<string>();
	const doc: Json = {};

	const skeleton: Json = {};
	put(skeleton, "hash", data.hash);
	put(skeleton, "spine", data.version);
	for (const k of ["x", "y", "width", "height"] as const) put(skeleton, k, data[k]);
	put(skeleton, "referenceScale", data.referenceScale, 100);
	put(skeleton, "fps", data.fps, 30);
	put(skeleton, "images", data.imagesPath);
	put(skeleton, "audio", data.audioPath);
	doc.skeleton = skeleton;

	doc.bones = data.bones.map((b) => {
		const o: Json = { name: b.name };
		if (b.parent) o.parent = b.parent.name;
		put(o, "length", b.length, 0);
		const s = b.setupPose;
		put(o, "x", s.x, 0);
		put(o, "y", s.y, 0);
		put(o, "rotation", s.rotation, 0);
		put(o, "scaleX", s.scaleX, 1);
		put(o, "scaleY", s.scaleY, 1);
		put(o, "shearX", s.shearX, 0);
		put(o, "shearY", s.shearY, 0);
		if (s.inherit !== Inherit.Normal) o.inherit = lowerFirst(Inherit[s.inherit]);
		if (b.skinRequired) o.skin = true;
		return o;
	});

	doc.slots = data.slots.map((s) => {
		const o: Json = { name: s.name, bone: s.boneData.name };
		const c = rgba(s.setupPose.color);
		if (c !== "ffffffff") o.color = c;
		if (s.setupPose.darkColor) o.dark = rgb(s.setupPose.darkColor);
		put(o, "attachment", s.attachmentName);
		if (s.blendMode !== BlendMode.Normal) o.blend = lowerFirst(BlendMode[s.blendMode]);
		if (s.visible === false) o.visible = false;
		return o;
	});

	doc.constraints = data.constraints.map((c) => {
		const o: Json = { name: c.name };
		if (c.skinRequired) o.skin = true;
		if (c instanceof IkConstraintData) {
			o.type = "ik";
			o.bones = c.bones.map((b) => b.name);
			o.target = c.target.name;
			if (c.scaleYMode !== ScaleYMode.None) o.scaleY = lowerFirst(ScaleYMode[c.scaleYMode]);
			const s = c.setupPose;
			put(o, "mix", s.mix, 1);
			put(o, "softness", s.softness, 0);
			if (s.bendDirection === -1) o.bendPositive = false;
			if (s.compress) o.compress = true;
			if (s.stretch) o.stretch = true;
		} else if (c instanceof PhysicsConstraintData) {
			o.type = "physics";
			o.bone = c.bone.name;
			for (const k of ["x", "y", "rotate", "scaleX", "shearX"] as const) put(o, k, c[k], 0);
			if (c.scaleYMode !== ScaleYMode.None) o.scaleY = lowerFirst(ScaleYMode[c.scaleYMode]);
			put(o, "limit", c.limit, 5000);
			put(o, "fps", 1 / c.step, 60);
			const s = c.setupPose;
			put(o, "inertia", s.inertia, 0.5);
			put(o, "strength", s.strength, 100);
			put(o, "damping", s.damping, 0.85);
			put(o, "mass", 1 / s.massInverse, 1);
			put(o, "wind", s.wind, 0);
			put(o, "gravity", s.gravity, 0);
			put(o, "mix", s.mix, 1);
			for (const k of ["inertia", "strength", "damping", "mass", "wind", "gravity", "mix"] as const)
				if (c[`${k}Global`]) o[`${k}Global`] = true;
		} else {
			unsupported.add(`${c.constructor.name} "${c.name}"`);
		}
		return o;
	});

	doc.skins = data.skins.map((skin) => writeSkin(data, skin, unsupported));

	if (data.events.length) {
		const events: Json = {};
		for (const e of data.events) {
			const o: Json = {};
			const s = e.setupPose;
			put(o, "int", s.intValue, 0);
			put(o, "float", s.floatValue, 0);
			put(o, "string", s.stringValue, "");
			if (e._audioPath) {
				o.audio = e._audioPath;
				put(o, "volume", s.volume, 1);
				put(o, "balance", s.balance, 0);
			}
			events[e.name] = o;
		}
		doc.events = events;
	}

	const animations: Json = {};
	for (const a of data.animations) animations[a.name] = writeAnimation(data, a, unsupported);
	doc.animations = animations;

	if (unsupported.size)
		throw new UserError(`this .skel uses features rydspine cannot convert yet: ${[...unsupported].join(", ")}; export JSON from Spine instead`);
	return doc as unknown as SkeletonDoc;
}

function vertices(att: VertexAttachment): number[] {
	if (!att.bones) return Array.from(att.vertices, (v) => r(v));
	const out: number[] = [];
	const v = att.vertices;
	for (let i = 0, w = 0; i < att.bones.length; ) {
		const count = att.bones[i++];
		out.push(count);
		for (let k = 0; k < count; k++, i++, w += 3) out.push(att.bones[i], r(v[w]), r(v[w + 1]), r(v[w + 2]));
	}
	return out;
}

function findAttachmentName(data: SkeletonData, target: Attachment): { skin: string; name: string } | null {
	for (const skin of data.skins)
		for (const e of skin.getAttachments()) if (e.attachment === target) return { skin: skin.name, name: e.placeholder };
	return null;
}

function writeSkin(data: SkeletonData, skin: Skin, unsupported: Set<string>): Json {
	const o: Json = { name: skin.name };
	if (skin.bones.length) o.bones = skin.bones.map((b) => b.name);
	for (const c of skin.constraints) {
		const key = c instanceof IkConstraintData ? "ik" : c instanceof PhysicsConstraintData ? "physics" : null;
		if (!key) continue;
		((o[key] as string[]) ??= []).push(c.name);
	}
	const attachments: Record<string, Record<string, Json>> = {};
	for (const entry of skin.getAttachments()) {
		const slot = data.slots[entry.slotIndex].name;
		const att = entry.attachment;
		const a: Json = {};
		if (att.name !== entry.placeholder) a.name = att.name;
		if (att instanceof RegionAttachment) {
			if (att.sequence.regions.length > 1 || att.sequence.pathSuffix) unsupported.add(`image sequence on ${slot}/${entry.placeholder}`);
			if (att.path && att.path !== att.name) a.path = att.path;
			for (const k of ["x", "y", "rotation"] as const) put(a, k, att[k], 0);
			put(a, "scaleX", att.scaleX, 1);
			put(a, "scaleY", att.scaleY, 1);
			a.width = r(att.width);
			a.height = r(att.height);
			if (rgba(att.color) !== "ffffffff") a.color = rgba(att.color);
		} else if (att instanceof MeshAttachment) {
			if (att.sequence.regions.length > 1 || att.sequence.pathSuffix) unsupported.add(`image sequence on ${slot}/${entry.placeholder}`);
			if (att.path && att.path !== att.name) a.path = att.path;
			if (rgba(att.color) !== "ffffffff") a.color = rgba(att.color);
			put(a, "width", att.width, 0);
			put(a, "height", att.height, 0);
			const source = att.getSourceMesh();
			if (source) {
				a.type = "linkedmesh";
				const found = findAttachmentName(data, source);
				if (!found) unsupported.add(`linked mesh ${slot}/${entry.placeholder} without a source`);
				else {
					a.source = found.name;
					if (found.skin !== "default") a.skin = found.skin;
				}
				if (att.timelineAttachment !== source) a.timelines = false;
			} else {
				a.type = "mesh";
				a.uvs = Array.from(att.regionUVs, (v) => r(v));
				a.triangles = [...att.triangles];
				a.vertices = vertices(att);
				a.hull = att.hullLength / 2;
				if (att.edges?.length) a.edges = [...att.edges];
			}
		} else if (att instanceof ClippingAttachment) {
			a.type = "clipping";
			if (att.endSlot) a.end = att.endSlot.name;
			if (att.convex) a.convex = true;
			if (att.inverse) a.inverse = true;
			a.vertexCount = att.worldVerticesLength / 2;
			a.vertices = vertices(att);
			a.color = rgba(att.color);
		} else if (att instanceof BoundingBoxAttachment) {
			a.type = "boundingbox";
			a.vertexCount = att.worldVerticesLength / 2;
			a.vertices = vertices(att);
			a.color = rgba(att.color);
		} else if (att instanceof PathAttachment) {
			a.type = "path";
			if (att.closed) a.closed = true;
			if (!att.constantSpeed) a.constantSpeed = false;
			a.vertexCount = att.worldVerticesLength / 2;
			a.vertices = vertices(att);
			a.lengths = att.lengths.map((v) => r(v));
			a.color = rgba(att.color);
		} else if (att instanceof PointAttachment) {
			a.type = "point";
			for (const k of ["x", "y", "rotation"] as const) put(a, k, att[k], 0);
			a.color = rgba(att.color);
		} else {
			unsupported.add(`${att.constructor.name} ${slot}/${entry.placeholder}`);
			continue;
		}
		(attachments[slot] ??= {})[entry.placeholder] = a;
	}
	o.attachments = attachments;
	return o;
}

function longestIncreasing(seq: number[]): Set<number> {
	const tails: number[] = [];
	const prev = new Array<number>(seq.length).fill(-1);
	seq.forEach((v, i) => {
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (seq[tails[mid]] < v) lo = mid + 1;
			else hi = mid;
		}
		prev[i] = lo > 0 ? tails[lo - 1] : -1;
		tails[lo] = i;
	});
	const out = new Set<number>();
	for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(seq[i]);
	return out;
}

/** Recovers a bezier's control points from the runtime's samples, for one value channel. */
function bezier(tl: CurveTimeline, frame: number, channel: number, t1: number, v1: number, t2: number, v2: number): number[] | "stepped" | undefined {
	const curves = (tl as unknown as { curves: ArrayLike<number> }).curves;
	const type = curves[frame];
	if (type === 0) return undefined;
	if (type === 1) return "stepped";
	const start = type - 2 + channel * 18;
	// x(t) = (1-t)^3 x0 + 3(1-t)^2 t c1 + 3(1-t) t^2 c2 + t^3 x3, sampled at t = 0.1 .. 0.9.
	const fit = (p0: number, p3: number, offset: number) => {
		let a11 = 0;
		let a12 = 0;
		let a22 = 0;
		let b1 = 0;
		let b2 = 0;
		for (let k = 1; k <= 9; k++) {
			const t = k / 10;
			const u = 1 - t;
			const B1 = 3 * u * u * t;
			const B2 = 3 * u * t * t;
			const y = curves[start + (k - 1) * 2 + offset] - u * u * u * p0 - t * t * t * p3;
			a11 += B1 * B1;
			a12 += B1 * B2;
			a22 += B2 * B2;
			b1 += B1 * y;
			b2 += B2 * y;
		}
		const det = a11 * a22 - a12 * a12;
		return [(b1 * a22 - b2 * a12) / det, (a11 * b2 - a12 * b1) / det];
	};
	const [cx1, cx2] = fit(t1, t2, 0);
	const [cy1, cy2] = fit(v1, v2, 1);
	return [r(cx1), r(cy1), r(cx2), r(cy2)];
}

/** Keys for a curve timeline whose frames hold `names.length` values after the time. */
function curveKeys(tl: CurveTimeline, names: string[], toJson: (values: number[]) => Json): Json[] {
	const n = tl.getFrameCount();
	const entries = tl.getFrameEntries();
	const f = tl.frames;
	const keys: Json[] = [];
	for (let i = 0; i < n; i++) {
		const base = i * entries;
		const values = names.map((_, c) => f[base + 1 + c]);
		const key: Json = {};
		if (f[base] !== 0) key.time = r(f[base]);
		Object.assign(key, toJson(values));
		if (i < n - 1) {
			const next = (i + 1) * entries;
			const curves = names.map((_, c) => bezier(tl, i, c, f[base], f[base + 1 + c], f[next], f[next + 1 + c]));
			if (curves[0] === "stepped") key.curve = "stepped";
			else if (curves[0]) key.curve = (curves as number[][]).flat();
		}
		keys.push(key);
	}
	return keys;
}

function writeAnimation(data: SkeletonData, anim: Animation, unsupported: Set<string>): Json {
	const bones: Record<string, Json> = {};
	const slots: Record<string, Json> = {};
	const ik: Json = {};
	const physics: Record<string, Json> = {};
	const attachments: Record<string, Record<string, Record<string, Json>>> = {};
	const out: Json = {};
	const one = (key: string, dflt?: number) => (v: number[]) => (dflt !== undefined && Math.abs(v[0] - dflt) < 1e-6 ? {} : { [key]: r(v[0]) });
	const two = (v: number[]) => ({ x: r(v[0]), y: r(v[1]) });
	const color = (v: number[], withAlpha: boolean) =>
		withAlpha ? `${hex(v[0])}${hex(v[1])}${hex(v[2])}${hex(v[3])}` : `${hex(v[0])}${hex(v[1])}${hex(v[2])}`;
	const boneKey = (tl: { boneIndex: number }) => (bones[data.bones[tl.boneIndex].name] ??= {});
	const slotKey = (tl: { slotIndex: number }) => (slots[data.slots[tl.slotIndex].name] ??= {});
	const physicsKey = (tl: { constraintIndex: number }) => (physics[tl.constraintIndex === -1 ? "" : data.constraints[tl.constraintIndex].name] ??= {});

	for (const tl of anim.timelines as Timeline[]) {
		if (tl instanceof RotateTimeline) boneKey(tl).rotate = curveKeys(tl, ["value"], one("value", 0));
		else if (tl instanceof TranslateTimeline) boneKey(tl).translate = curveKeys(tl, ["x", "y"], two);
		else if (tl instanceof TranslateXTimeline) boneKey(tl).translatex = curveKeys(tl, ["value"], one("value", 0));
		else if (tl instanceof TranslateYTimeline) boneKey(tl).translatey = curveKeys(tl, ["value"], one("value", 0));
		else if (tl instanceof ScaleTimeline) boneKey(tl).scale = curveKeys(tl, ["x", "y"], two);
		else if (tl instanceof ScaleXTimeline) boneKey(tl).scalex = curveKeys(tl, ["value"], one("value", 1));
		else if (tl instanceof ScaleYTimeline) boneKey(tl).scaley = curveKeys(tl, ["value"], one("value", 1));
		else if (tl instanceof ShearTimeline) boneKey(tl).shear = curveKeys(tl, ["x", "y"], two);
		else if (tl instanceof ShearXTimeline) boneKey(tl).shearx = curveKeys(tl, ["value"], one("value", 0));
		else if (tl instanceof ShearYTimeline) boneKey(tl).sheary = curveKeys(tl, ["value"], one("value", 0));
		else if (tl instanceof InheritTimeline) {
			const keys: Json[] = [];
			for (let i = 0; i < tl.getFrameCount(); i++) {
				const k: Json = {};
				if (tl.frames[i * 2]) k.time = r(tl.frames[i * 2]);
				k.inherit = lowerFirst(Inherit[tl.frames[i * 2 + 1]]);
				keys.push(k);
			}
			boneKey(tl).inherit = keys;
		} else if (tl instanceof RGBATimeline) slotKey(tl).rgba = curveKeys(tl, ["r", "g", "b", "a"], (v) => ({ color: color(v, true) }));
		else if (tl instanceof RGBTimeline) slotKey(tl).rgb = curveKeys(tl, ["r", "g", "b"], (v) => ({ color: color(v, false) }));
		else if (tl instanceof AlphaTimeline) slotKey(tl).alpha = curveKeys(tl, ["value"], (v) => ({ value: r(v[0]) }));
		else if (tl instanceof RGBA2Timeline)
			slotKey(tl).rgba2 = curveKeys(tl, ["r", "g", "b", "a", "r2", "g2", "b2"], (v) => ({ light: color(v, true), dark: color(v.slice(4), false) }));
		else if (tl instanceof RGB2Timeline)
			slotKey(tl).rgb2 = curveKeys(tl, ["r", "g", "b", "r2", "g2", "b2"], (v) => ({ light: color(v, false), dark: color(v.slice(3), false) }));
		else if (tl instanceof AttachmentTimeline) {
			const keys: Json[] = [];
			for (let i = 0; i < tl.getFrameCount(); i++) {
				const k: Json = {};
				if (tl.frames[i]) k.time = r(tl.frames[i]);
				k.name = tl.attachmentNames[i];
				keys.push(k);
			}
			slotKey(tl).attachment = keys;
		} else if (tl instanceof DeformTimeline) {
			const att = tl.attachment;
			const found = findAttachmentName(data, att);
			if (!found) {
				unsupported.add(`deform on an unknown attachment in ${anim.name}`);
				continue;
			}
			const setup = att.bones ? null : att.vertices;
			const frames = (tl as unknown as { vertices: ArrayLike<number>[] }).vertices;
			const keys: Json[] = [];
			for (let i = 0; i < tl.getFrameCount(); i++) {
				const k: Json = {};
				if (tl.frames[i]) k.time = r(tl.frames[i]);
				const v = Array.from(frames[i], (x, j) => r(x - (setup ? setup[j] : 0)));
				const first = v.findIndex((x) => x !== 0);
				if (first >= 0) {
					let last = v.length - 1;
					while (v[last] === 0) last--;
					if (first > 0) k.offset = first;
					k.vertices = v.slice(first, last + 1);
				}
				if (i < tl.getFrameCount() - 1) {
					const c = bezier(tl, i, 0, tl.frames[i], 0, tl.frames[i + 1], 1);
					if (c) k.curve = c;
				}
				keys.push(k);
			}
			const slotName = data.slots[tl.slotIndex].name;
			((attachments[found.skin] ??= {})[slotName] ??= {})[found.name] = { deform: keys };
		} else if (tl instanceof DrawOrderTimeline) {
			const orders = (tl as unknown as { drawOrders: (number[] | null)[] }).drawOrders;
			out.drawOrder = Array.from({ length: tl.getFrameCount() }, (_, i) => {
				const k: Json = {};
				if (tl.frames[i]) k.time = r(tl.frames[i]);
				const order = orders[i];
				if (order) {
					// Slots on the longest run already in setup order stay put; only the others are listed.
					const keep = longestIncreasing(order);
					k.offsets = order
						.map((slotIndex, position) => ({ slotIndex, position }))
						.filter((e) => !keep.has(e.slotIndex))
						.sort((a, b) => a.slotIndex - b.slotIndex)
						.map((e) => ({ slot: data.slots[e.slotIndex].name, offset: e.position - e.slotIndex }));
				}
				return k;
			});
		} else if (tl instanceof EventTimeline) {
			out.events = tl.events.map((e, i) => {
				const k: Json = {};
				if (tl.frames[i]) k.time = r(tl.frames[i]);
				k.name = e.data.name;
				const s = e.data.setupPose;
				if (e.intValue !== s.intValue) k.int = e.intValue;
				if (e.floatValue !== s.floatValue) k.float = r(e.floatValue);
				if (e.stringValue !== s.stringValue) k.string = e.stringValue;
				if (e.data._audioPath) {
					if (e.volume !== s.volume) k.volume = r(e.volume);
					if (e.balance !== s.balance) k.balance = r(e.balance);
				}
				return k;
			});
		} else if (tl instanceof IkConstraintTimeline) {
			const keys: Json[] = [];
			const f = tl.frames;
			for (let i = 0; i < tl.getFrameCount(); i++) {
				const b = i * 6;
				const k: Json = {};
				if (f[b]) k.time = r(f[b]);
				put(k, "mix", f[b + 1], 1);
				put(k, "softness", f[b + 2], 0);
				if (f[b + 3] === -1) k.bendPositive = false;
				if (f[b + 4]) k.compress = true;
				if (f[b + 5]) k.stretch = true;
				if (i < tl.getFrameCount() - 1) {
					const n = (i + 1) * 6;
					const c0 = bezier(tl, i, 0, f[b], f[b + 1], f[n], f[n + 1]);
					const c1 = bezier(tl, i, 1, f[b], f[b + 2], f[n], f[n + 2]);
					if (c0 === "stepped") k.curve = "stepped";
					else if (c0 && c1 && c1 !== "stepped") k.curve = [...c0, ...c1];
				}
				keys.push(k);
			}
			ik[data.constraints[tl.constraintIndex].name] = keys;
		} else if (tl instanceof PhysicsConstraintResetTimeline) {
			physicsKey(tl).reset = Array.from({ length: tl.getFrameCount() }, (_, i) => (tl.frames[i] ? { time: r(tl.frames[i]) } : {}));
		} else {
			const physicsKinds: [new (...a: never[]) => unknown, string][] = [
				[PhysicsConstraintInertiaTimeline, "inertia"],
				[PhysicsConstraintStrengthTimeline, "strength"],
				[PhysicsConstraintDampingTimeline, "damping"],
				[PhysicsConstraintMassTimeline, "mass"],
				[PhysicsConstraintWindTimeline, "wind"],
				[PhysicsConstraintGravityTimeline, "gravity"],
				[PhysicsConstraintMixTimeline, "mix"],
			];
			const kind = physicsKinds.find(([cls]) => tl instanceof cls);
			if (kind) {
				const ptl = tl as unknown as CurveTimeline & { constraintIndex: number };
				physicsKey(ptl)[kind[1]] = curveKeys(ptl, ["value"], (v) => ({ value: r(v[0]) }));
			} else unsupported.add(`${tl.constructor.name} in animation ${anim.name}`);
		}
	}
	if (Object.keys(slots).length) out.slots = slots;
	if (Object.keys(bones).length) out.bones = bones;
	if (Object.keys(ik).length) out.ik = ik;
	if (Object.keys(physics).length) out.physics = physics;
	if (Object.keys(attachments).length) out.attachments = attachments;
	return out;
}
