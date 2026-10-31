// Animation keys and motion primitives. Bone timeline values are offsets from the setup pose
// (scale timelines are multipliers), so motions compose without knowing the rig's absolute pose.
import { type DrawOrderJson, orderToOffsets } from "./draworder.js";
import type { AnimationJson, Curve, EventJson, ValueKey } from "./types.js";
import { checkName, UserError, type Workspace } from "./workspace.js";
import { assertUnlocked, findBone } from "./rig.js";
import { load } from "./runtime.js";

export const PROPERTIES = ["rotate", "translatex", "translatey", "scalex", "scaley", "shearx", "sheary"] as const;
export type Property = (typeof PROPERTIES)[number];

export const EASES = ["linear", "stepped", "ease-in", "ease-out", "ease-in-out", "back-in", "back-out"] as const;
export type Ease = (typeof EASES)[number];
/** A preset, or a CSS-style cubic-bezier [x1, y1, x2, y2] in 0..1 of the segment's time and value. */
export type EaseSpec = Ease | [number, number, number, number];

const BEZIER: Record<Exclude<Ease, "linear" | "stepped">, [number, number, number, number]> = {
	"ease-in": [0.42, 0, 1, 1],
	"ease-out": [0, 0, 0.58, 1],
	"ease-in-out": [0.42, 0, 0.58, 1],
	"back-in": [0.36, 0, 0.66, -0.56],
	"back-out": [0.34, 1.56, 0.64, 1],
};

const EPS = 1e-4;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/**
 * Key times on (or within 2ms of) a 30fps frame are written as that exact frame: Spine Editor snaps
 * near-frame times when it imports, so 0.033 would otherwise move to 1/30 and shift the pose.
 */
const rt = (t: number) => {
	const frame = Math.round(t * 30);
	return Math.abs(t * 30 - frame) < 0.06 ? Math.round((frame / 30) * 1e8) / 1e8 : r3(t);
};
const neutral = (p: Property) => (p === "scalex" || p === "scaley" ? 1 : 0);

/** Spine stores a segment's curve as bezier control points in (time, value) space. */
function easeCurve(ease: EaseSpec, t0: number, v0: number, t1: number, v1: number): Curve | undefined {
	if (ease === "linear") return undefined;
	if (ease === "stepped") return "stepped";
	const [x1, y1, x2, y2] = typeof ease === "string" ? BEZIER[ease] : checkBezier(ease);
	const dt = t1 - t0;
	const dv = v1 - v0;
	return [t0 + x1 * dt, v0 + y1 * dv, t0 + x2 * dt, v0 + y2 * dv].map(r3);
}

/** Control point times must stay inside the segment, or the curve would run backwards in time. */
function checkBezier(b: number[]): [number, number, number, number] {
	if (b.length !== 4 || b.some((v) => !Number.isFinite(v))) throw new UserError("a bezier ease is [x1, y1, x2, y2]");
	if (b[0] < 0 || b[0] > 1 || b[2] < 0 || b[2] > 1) throw new UserError(`bezier ease [${b.join(", ")}]: x1 and x2 must be within 0..1`);
	return b as [number, number, number, number];
}

/** Cubic Hermite segment (values and slopes at both ends) as a Spine bezier. */
function hermite(t0: number, v0: number, d0: number, t1: number, v1: number, d1: number): Curve {
	const h = (t1 - t0) / 3;
	return [t0 + h, v0 + d0 * h, t1 - h, v1 - d1 * h].map(r3);
}

export interface Key {
	time: number;
	value: number;
	ease?: EaseSpec;
	curve?: Curve;
}

export function animation(ws: Workspace, name: string): AnimationJson {
	const anim = ws.doc.animations[name];
	if (!anim) throw new UserError(`animation "${name}" not found (create it with anim_create)`);
	return anim;
}

function timeline(ws: Workspace, anim: string, bone: string, property: Property): ValueKey[] {
	const a = animation(ws, anim);
	a.bones ??= {};
	a.bones[bone] ??= {};
	a.bones[bone][property] ??= [];
	return a.bones[bone][property];
}

/** Replaces the keys of one timeline inside [start, end], keeping keys outside the range. */
export function writeKeys(ws: Workspace, anim: string, bone: string, property: Property, keys: Key[], range?: [number, number]): void {
	assertUnlocked(ws, "animations", [anim]);
	assertUnlocked(ws, "bones", [bone]);
	findBone(ws, bone);
	if (!PROPERTIES.includes(property)) throw new UserError(`property must be one of ${PROPERTIES.join(", ")}`);
	if (!keys.length) return;
	const sorted = [...keys].sort((a, b) => a.time - b.time);
	const [start, end] = range ?? [sorted[0].time, sorted[sorted.length - 1].time];
	const tl = timeline(ws, anim, bone, property);
	const kept = tl.filter((k) => (k.time ?? 0) < start - EPS || (k.time ?? 0) > end + EPS);

	const fresh: ValueKey[] = sorted.map((k, i) => {
		const out: ValueKey = { time: rt(k.time), value: r3(k.value) };
		const next = sorted[i + 1];
		const curve = k.curve ?? (next && k.ease ? easeCurve(k.ease, k.time, k.value, next.time, next.value) : undefined);
		if (curve) out.curve = curve;
		return out;
	});
	// A kept key right before the range pointed its curve at a key that no longer exists.
	const before = kept.filter((k) => (k.time ?? 0) < start - EPS).pop();
	if (before) delete before.curve;

	const merged = [...kept, ...fresh].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
	const a = animation(ws, anim);
	a.bones![bone][property] = merged;
}

export function animDuration(ws: Workspace, anim: string): number {
	let max = 0;
	// Every timeline is an array of keys with an optional time, however deep it sits (bones, slots,
	// constraints, attachment sequences).
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const k of node) if (k && typeof k === "object" && typeof (k as { time?: unknown }).time === "number") max = Math.max(max, (k as { time: number }).time);
		} else if (node && typeof node === "object") for (const v of Object.values(node)) walk(v);
	};
	walk(animation(ws, anim));
	return max;
}

/** Puts fresh keys in place of the old ones between their first and last time, keeping keys outside. */
function mergeKeys<T extends { time?: number; curve?: unknown }>(old: T[], fresh: T[]): T[] {
	const [start, end] = [fresh[0].time ?? 0, fresh[fresh.length - 1].time ?? 0];
	const kept = old.filter((k) => (k.time ?? 0) < start - EPS || (k.time ?? 0) > end + EPS);
	// A kept key right before the range pointed its curve at a key that no longer exists.
	const before = kept.filter((k) => (k.time ?? 0) < start - EPS).pop();
	if (before) delete before.curve;
	return [...kept, ...fresh].sort((x, y) => (x.time ?? 0) - (y.time ?? 0));
}

export const SLOT_PROPERTIES = ["alpha", "rgba", "attachment"] as const;
export type SlotProperty = (typeof SLOT_PROPERTIES)[number];

export interface SlotKey {
	time: number;
	/** alpha: 0..1 */
	value?: number;
	/** rgba: RRGGBBAA */
	color?: string;
	/** attachment: name, or null to hide */
	name?: string | null;
	ease?: EaseSpec;
}

/** Slot timelines: fade (alpha), tint (rgba, linear or stepped) and attachment swaps (blink, open mouth). */
export function writeSlotKeys(ws: Workspace, anim: string, slot: string, property: SlotProperty, keys: SlotKey[]): void {
	assertUnlocked(ws, "animations", [anim]);
	assertUnlocked(ws, "slots", [slot]);
	if (!ws.doc.slots.some((s) => s.name === slot)) throw new UserError(`slot "${slot}" not found`);
	if (!keys.length) return;
	const sorted = [...keys].sort((a, b) => a.time - b.time);
	const fresh = sorted.map((k, i) => {
		const next = sorted[i + 1];
		if (property === "attachment") {
			if (k.name === undefined) throw new UserError("attachment keys need a name (or null)");
			return { time: rt(k.time), name: k.name };
		}
		if (property === "alpha") {
			if (k.value === undefined) throw new UserError("alpha keys need a value");
			const out: ValueKey = { time: rt(k.time), value: r3(k.value) };
			const curve = next && k.ease ? easeCurve(k.ease, k.time, k.value, next.time, next.value ?? k.value) : undefined;
			if (curve) out.curve = curve;
			return out;
		}
		if (!k.color || !/^[0-9a-fA-F]{8}$/.test(k.color)) throw new UserError("rgba keys need color as RRGGBBAA");
		if (k.ease && k.ease !== "linear" && k.ease !== "stepped") throw new UserError("rgba keys support linear or stepped only");
		return k.ease === "stepped" ? { time: rt(k.time), color: k.color, curve: "stepped" } : { time: rt(k.time), color: k.color };
	});
	const a = animation(ws, anim);
	a.slots ??= {};
	a.slots[slot] ??= {};
	a.slots[slot][property] = mergeKeys((a.slots[slot][property] ?? []) as { time?: number; curve?: unknown }[], fresh);
}

export const CONSTRAINT_PROPERTIES = ["mix", "position", "spacing", "time", "inertia", "strength", "damping", "mass", "wind", "gravity", "reset"] as const;
export type ConstraintProperty = (typeof CONSTRAINT_PROPERTIES)[number];

/** Timelines each constraint type has, as the Spine 4.3 runtime reads them. */
const CONSTRAINT_TIMELINES: Record<string, readonly ConstraintProperty[]> = {
	ik: ["mix"],
	transform: ["mix"],
	path: ["position", "spacing", "mix"],
	physics: ["inertia", "strength", "damping", "mass", "wind", "gravity", "mix", "reset"],
	slider: ["time", "mix"],
};

/** Channels a timeline interpolates; each has its own bezier in a curve. */
function channels(type: string, property: ConstraintProperty): string[] {
	if (property === "reset") return [];
	if (property !== "mix" || type === "physics" || type === "slider") return ["value"];
	if (type === "ik") return ["mix", "softness"];
	if (type === "transform") return ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"];
	return ["mixRotate", "mixX", "mixY"];
}

export interface ConstraintKey {
	time: number;
	/** Single-value timelines: path position/spacing, slider time/mix, physics values. */
	value?: number;
	mix?: number;
	softness?: number;
	bendPositive?: boolean;
	compress?: boolean;
	stretch?: boolean;
	mixRotate?: number;
	mixX?: number;
	mixY?: number;
	mixScaleX?: number;
	mixScaleY?: number;
	mixShearY?: number;
	ease?: EaseSpec;
}

/** The constraint's setup values, which keys fall back to for channels they leave out. */
function setupValues(ws: Workspace, name: string, type: string, property: ConstraintProperty): Record<string, number | boolean> {
	if (!name) return {};
	const data = load(ws).data.constraints.find((c) => c.name === name) as unknown as { setupPose: Record<string, number | boolean> };
	const p = data.setupPose;
	if (type === "ik") return { mix: p.mix, softness: p.softness, bendPositive: (p.bendDirection as number) > 0, compress: p.compress, stretch: p.stretch };
	if (property === "mix" && (type === "transform" || type === "path")) return p;
	if (property === "mass") return { value: 1 / (p.massInverse as number) };
	return { value: p[property] as number };
}

/**
 * Keys a constraint timeline: IK mix/softness/bend, transform and path mixes, path position and spacing,
 * physics settings and resets, slider time and mix. Channels a key leaves out keep the setup value.
 * Physics with constraint "" keys every physics constraint at once.
 */
export function writeConstraintKeys(ws: Workspace, anim: string, name: string, property: ConstraintProperty, keys: ConstraintKey[]): string {
	assertUnlocked(ws, "animations", [anim]);
	const constraint = ws.doc.constraints.find((c) => c.name === name);
	if (name && !constraint) throw new UserError(`constraint "${name}" not found`);
	const type = constraint?.type ?? "physics";
	const allowed = CONSTRAINT_TIMELINES[type];
	if (!allowed.includes(property)) throw new UserError(`${type} constraints have ${allowed.join(", ")} timelines, not ${property}`);
	if (!keys.length) return "";
	const setup = setupValues(ws, name, type, property);
	const names = channels(type, property);
	const sorted = [...keys].sort((a, b) => a.time - b.time);
	const values = sorted.map((k) =>
		names.map((c) => {
			const v = (k as unknown as Record<string, number | undefined>)[c] ?? (c === "value" ? k.mix : c === "mix" ? k.value : undefined) ?? setup[c];
			if (typeof v !== "number") throw new UserError(`keys at ${k.time}s need ${c}`);
			return v;
		}),
	);
	if (property === "mass" && values.some(([v]) => v <= 0)) throw new UserError("mass must be greater than 0");
	if (property === "time" && values.some(([v]) => v < 0)) throw new UserError("slider time must be 0 or more");
	const fresh = sorted.map((k, i) => {
		const out: Record<string, unknown> = { time: rt(k.time) };
		names.forEach((c, j) => (out[c] = r3(values[i][j])));
		if (type === "ik")
			for (const flag of ["bendPositive", "compress", "stretch"] as const) out[flag] = k[flag] ?? setup[flag];
		const next = sorted[i + 1];
		if (next && k.ease && k.ease !== "linear" && names.length) {
			if (k.ease === "stepped") out.curve = "stepped";
			else out.curve = names.flatMap((_, j) => easeCurve(k.ease!, k.time, values[i][j], next.time, values[i + 1][j]) as number[]);
		}
		return out as { time?: number; curve?: unknown };
	});
	const a = animation(ws, anim) as Record<string, Record<string, unknown>>;
	a[type] ??= {};
	if (type === "ik" || type === "transform") a[type][name] = mergeKeys((a[type][name] ?? []) as typeof fresh, fresh);
	else {
		const group = (a[type][name] ??= {}) as Record<string, typeof fresh>;
		group[property] = mergeKeys(group[property] ?? [], fresh);
	}
	return `${sorted.length} key(s) on ${name || "all physics"} ${property}${names.length > 1 ? ` (${names.join(", ")})` : ""}`;
}

export const SEQUENCE_MODES = ["hold", "once", "loop", "pingpong", "onceReverse", "loopReverse", "pingpongReverse"] as const;

export interface SequenceKey {
	time: number;
	mode?: (typeof SEQUENCE_MODES)[number];
	/** Frame to start from (0-based). */
	index?: number;
	/** Seconds per frame. */
	delay?: number;
}

/** Plays an image sequence attachment: mode, starting frame and seconds per frame from each key on. */
export function writeSequenceKeys(ws: Workspace, anim: string, slot: string, attachment: string | undefined, keys: SequenceKey[], skin = "default"): void {
	assertUnlocked(ws, "animations", [anim]);
	const s = ws.doc.slots.find((x) => x.name === slot);
	if (!s) throw new UserError(`slot "${slot}" not found`);
	const name = attachment ?? s.attachment ?? slot;
	const sk = ws.doc.skins.find((x) => x.name === skin);
	if (!sk) throw new UserError(`skin "${skin}" not found`);
	const att = sk.attachments[slot]?.[name] as { sequence?: { count: number } } | undefined;
	if (!att) throw new UserError(`attachment "${name}" not found in slot "${slot}" of skin "${skin}"`);
	if (!att.sequence) throw new UserError(`attachment "${name}" is not an image sequence (make one with sequence_import)`);
	if (!keys.length) return;
	const count = att.sequence.count;
	const sorted = [...keys].sort((a, b) => a.time - b.time);
	const fresh = sorted.map((k) => {
		if (k.index !== undefined && (k.index < 0 || k.index >= count || !Number.isInteger(k.index)))
			throw new UserError(`index ${k.index} is outside the ${count} frames (0..${count - 1})`);
		if (k.delay !== undefined && k.delay < 0) throw new UserError("delay must be 0 or more");
		const out: { time: number; mode?: string; index?: number; delay?: number } = { time: rt(k.time) };
		if (k.mode && k.mode !== "hold") out.mode = k.mode;
		if (k.index) out.index = k.index;
		if (k.delay) out.delay = r3(k.delay);
		return out;
	});
	const a = animation(ws, anim) as Record<string, unknown>;
	const bySkin = ((a.attachments ??= {}) as Record<string, Record<string, Record<string, Record<string, unknown>>>>);
	const timelines = (((bySkin[skin] ??= {})[slot] ??= {})[name] ??= {});
	timelines.sequence = mergeKeys((timelines.sequence ?? []) as typeof fresh, fresh);
}

export interface GaitSpec {
	animation: string;
	/** IK target bones of the feet, with their phase in the cycle (0..1). */
	feet: { bone: string; phase: number }[];
	/** Bone that bobs (hips / body). */
	body?: string;
	/** Seconds per full cycle (both feet). */
	period: number;
	/** Foot travel per step in px. */
	stride: number;
	/** Foot lift height in px. */
	lift: number;
	/** Fraction of the cycle each foot is on the ground: ~0.6 walk, ~0.35 run. */
	contact?: number;
	/** Body bob in px (moves twice per cycle). */
	bob?: number;
	start?: number;
	cycles?: number;
	/** Event to fire as each foot lands (string value: the foot bone), e.g. "footstep". */
	event?: string;
}

/**
 * In-place walk/run cycle. While a foot is down it slides back at exactly the body's speed, so in a
 * game that moves the character at stride / (contact * period) px/s the feet do not skate.
 */
export function gait(ws: Workspace, s: GaitSpec): string {
	const start = s.start ?? 0;
	const cycles = s.cycles ?? 1;
	const contact = s.contact ?? 0.6;
	const end = start + s.period * cycles;
	const frames = Math.round((end - start) * 30);
	const times = Array.from({ length: frames + 1 }, (_, i) => start + ((end - start) * i) / frames);
	const smooth = (u: number) => u * u * (3 - 2 * u);
	for (const foot of s.feet) {
		const at = (t: number) => {
			const u = ((((t - start) / s.period + foot.phase) % 1) + 1) % 1;
			if (u < contact) return { x: s.stride / 2 - (s.stride * u) / contact, y: 0 };
			const v = (u - contact) / (1 - contact);
			return { x: -s.stride / 2 + s.stride * smooth(v), y: s.lift * Math.sin(Math.PI * v) };
		};
		writeKeys(ws, s.animation, foot.bone, "translatex", times.map((t) => ({ time: t, value: at(t).x })), [start, end]);
		writeKeys(ws, s.animation, foot.bone, "translatey", times.map((t) => ({ time: t, value: at(t).y })), [start, end]);
	}
	if (s.body && s.bob) {
		oscillate(ws, {
			animation: s.animation,
			bones: [s.body],
			property: "translatey",
			amplitude: s.bob,
			period: s.period / 2,
			start,
			end,
			phase: 0.25,
			center: -s.bob,
		});
	}
	// A foot lands where its cycle wraps to 0: t = start + period * (k - phase).
	const lands = s.feet.map((foot) => {
		const out: number[] = [];
		for (let k = 0; k <= cycles + 1; k++) {
			const t = start + s.period * (k - foot.phase);
			if (t >= start - EPS && t < end - EPS) out.push(rt(t));
		}
		return { bone: foot.bone, times: out };
	});
	if (s.event)
		writeEventKeys(ws, s.animation, lands.flatMap((l) => l.times.map((time) => ({ time, name: s.event!, string: l.bone }))));
	const speed = s.stride / (contact * s.period);
	return [
		`ground speed ${r3(speed)} px/s (move the character at this speed so planted feet do not slide)`,
		`feet land at: ${lands.map((l) => `${l.bone} ${l.times.join(", ")}`).join("; ")}${s.event ? ` (event ${s.event} keyed)` : ""}`,
	].join("\n");
}

interface Chain {
	bones: string[];
	/** Seconds each bone lags the previous one (follow-through / overlap). */
	delayPerBone?: number;
	/** Amplitude multiplier applied per bone down the chain. */
	falloff?: number;
}

export interface OscillateSpec extends Chain {
	animation: string;
	property: Property;
	amplitude: number;
	period: number;
	start?: number;
	end?: number;
	/** Starting phase in cycles (0..1). */
	phase?: number;
	center?: number;
}

/** Smooth sine motion. In looping animations the period is adjusted so whole cycles fit the range. */
export function oscillate(ws: Workspace, s: OscillateSpec): string {
	const start = s.start ?? 0;
	const end = s.end ?? (animDuration(ws, s.animation) || s.period);
	if (end <= start) throw new UserError("end must be after start");
	let period = s.period;
	let note = "";
	if (ws.meta.loops[s.animation]) {
		const cycles = Math.max(1, Math.round((end - start) / period));
		const fitted = (end - start) / cycles;
		if (Math.abs(fitted - period) > EPS) note = `period adjusted ${period}s -> ${r3(fitted)}s to loop seamlessly`;
		period = fitted;
	}
	s.bones.forEach((bone, k) => {
		const amp = s.amplitude * (s.falloff ?? 1) ** k;
		const center = s.center ?? neutral(s.property);
		const phase = (s.phase ?? 0) - (k * (s.delayPerBone ?? 0)) / period;
		const f = (t: number) => center + amp * Math.sin(2 * Math.PI * ((t - start) / period + phase));
		const df = (t: number) => ((amp * 2 * Math.PI) / period) * Math.cos(2 * Math.PI * ((t - start) / period + phase));
		// Keys at the range ends and at every peak/trough in between.
		const times = [start, end];
		const first = Math.ceil((phase - 0.25) * 2 - EPS);
		for (let n = first; ; n++) {
			const t = start + ((0.25 + n / 2 - phase) * period);
			if (t >= end - EPS) break;
			if (t > start + EPS) times.push(t);
		}
		times.sort((a, b) => a - b);
		const keys: Key[] = times.map((t, i) => {
			const next = times[i + 1];
			return {
				time: t,
				value: f(t),
				curve: next === undefined ? undefined : hermite(t, f(t), df(t), next, f(next), df(next)),
			};
		});
		writeKeys(ws, s.animation, bone, s.property, keys, [start, end]);
	});
	return note;
}

export interface TweenSpec extends Chain {
	animation: string;
	property: Property;
	to: number;
	from?: number;
	start?: number;
	duration: number;
	ease?: EaseSpec;
	/** Fraction of the move to wind up in the opposite direction first. */
	anticipation?: number;
}

export function tween(ws: Workspace, s: TweenSpec): void {
	s.bones.forEach((bone, k) => {
		const scale = (s.falloff ?? 1) ** k;
		const base = neutral(s.property);
		const from = base + ((s.from ?? base) - base) * scale;
		const to = base + (s.to - base) * scale;
		const t0 = (s.start ?? 0) + k * (s.delayPerBone ?? 0);
		const t1 = t0 + s.duration;
		const keys: Key[] = [{ time: t0, value: from, ease: s.ease ?? "ease-in-out" }];
		if (s.anticipation) {
			const tw = t0 + s.duration * 0.3;
			keys[0].ease = "ease-out";
			keys.push({ time: tw, value: from - (to - from) * s.anticipation, ease: s.ease ?? "ease-in-out" });
		}
		keys.push({ time: t1, value: to });
		writeKeys(ws, s.animation, bone, s.property, keys, [t0, t1]);
	});
}

export interface BounceSpec extends Chain {
	animation: string;
	property: Property;
	from: number;
	to: number;
	start?: number;
	duration: number;
	bounces?: number;
	/** First rebound as a fraction of |to - from|. */
	height?: number;
	/** Each rebound's height relative to the previous one. */
	decay?: number;
	/** spring: overshoots past the target and settles; drop: lands, rebounds back toward from. */
	style?: "spring" | "drop";
}

export function bounce(ws: Workspace, s: BounceSpec): void {
	const bounces = s.bounces ?? 2;
	const height = s.height ?? 0.3;
	const decay = s.decay ?? 0.45;
	s.bones.forEach((bone, k) => {
		const scale = (s.falloff ?? 1) ** k;
		const base = neutral(s.property);
		const from = base + (s.from - base) * scale;
		const to = base + (s.to - base) * scale;
		const delta = to - from;
		const t0 = (s.start ?? 0) + k * (s.delayPerBone ?? 0);
		const values = [from];
		const eases: Ease[] = [];
		const weights: number[] = [];
		if (s.style === "drop") {
			values.push(to);
			eases.push("ease-in");
			weights.push(1);
			for (let b = 0; b < bounces; b++) {
				const h = height * decay ** b;
				values.push(to - delta * h, to);
				eases.push("ease-out", "ease-in");
				weights.push(Math.sqrt(h), Math.sqrt(h));
			}
		} else {
			for (let b = 0; b < bounces; b++) {
				values.push(to + delta * height * decay ** b * (b % 2 === 0 ? 1 : -1));
				eases.push(b === 0 ? "ease-out" : "ease-in-out");
				weights.push(b === 0 ? 1 : 0.6 * decay ** (b / 2));
			}
			values.push(to);
			eases.push(bounces ? "ease-in-out" : "ease-out");
			weights.push(bounces ? 0.6 * decay ** (bounces / 2) : 1);
		}
		const total = weights.reduce((a, b) => a + b, 0);
		let t = t0;
		const keys: Key[] = [];
		values.forEach((value, i) => {
			keys.push({ time: t, value, ease: eases[i] });
			if (i < weights.length) t += (s.duration * weights[i]) / total;
		});
		writeKeys(ws, s.animation, bone, s.property, keys, [t0, t0 + s.duration]);
	});
}

export interface EventDef extends EventJson {
	name: string;
}

/** Defines an event (footstep, hit, sound cue) or changes its setup values; keys inherit those values. */
export function defineEvent(ws: Workspace, d: EventDef): string {
	checkName("event", d.name);
	if (d.volume !== undefined && (d.volume < 0 || d.volume > 1)) throw new UserError("volume must be within 0..1");
	if (d.balance !== undefined && (d.balance < -1 || d.balance > 1)) throw new UserError("balance must be within -1..1");
	if ((d.volume !== undefined || d.balance !== undefined) && !d.audio && !ws.doc.events?.[d.name]?.audio)
		throw new UserError("volume and balance apply to audio events; give audio too");
	const events = eventsOf(ws);
	const existed = d.name in events;
	const e: EventJson = (events[d.name] ??= {});
	if (d.int !== undefined) setOrDrop(e, "int", Math.round(d.int), 0);
	if (d.float !== undefined) setOrDrop(e, "float", r3(d.float), 0);
	if (d.string !== undefined) setOrDrop(e, "string", d.string, "");
	if (d.audio !== undefined) setOrDrop(e, "audio", d.audio, "");
	if (d.volume !== undefined) setOrDrop(e, "volume", r3(d.volume), 1);
	if (d.balance !== undefined) setOrDrop(e, "balance", r3(d.balance), 0);
	if (!e.audio) {
		delete e.volume;
		delete e.balance;
	}
	return `${existed ? "updated" : "defined"} event ${d.name}`;
}

function setOrDrop<K extends keyof EventJson>(o: EventJson, k: K, v: EventJson[K], fallback: EventJson[K]): void {
	if (v === fallback) delete o[k];
	else o[k] = v;
}

/** Spine JSON lists events before animations; keep that order when adding the first one. */
function eventsOf(ws: Workspace): Record<string, EventJson> {
	if (ws.doc.events) return ws.doc.events;
	const { animations, ...rest } = ws.doc;
	for (const k of Object.keys(ws.doc)) delete (ws.doc as Record<string, unknown>)[k];
	Object.assign(ws.doc, rest, { events: {}, animations });
	return ws.doc.events!;
}

export interface EventKey {
	time: number;
	name: string;
	int?: number;
	float?: number;
	string?: string;
	volume?: number;
	balance?: number;
}

/**
 * Fires events during an animation. A key replaces an event with the same name at the same time;
 * `replace` clears the animation's events first. Events not defined yet are defined with no values.
 */
export function writeEventKeys(ws: Workspace, anim: string, keys: EventKey[], replace = false): string {
	assertUnlocked(ws, "animations", [anim]);
	const a = animation(ws, anim);
	const defined: string[] = [];
	for (const k of keys)
		if (!ws.doc.events?.[k.name]) {
			defineEvent(ws, { name: k.name });
			defined.push(k.name);
		}
	const fresh = keys.map((k) => {
		const def = ws.doc.events![k.name];
		const out: Record<string, unknown> = { time: rt(k.time), name: k.name };
		if (k.int !== undefined && Math.round(k.int) !== (def.int ?? 0)) out.int = Math.round(k.int);
		if (k.float !== undefined && r3(k.float) !== (def.float ?? 0)) out.float = r3(k.float);
		if (k.string !== undefined && k.string !== (def.string ?? "")) out.string = k.string;
		if ((k.volume !== undefined || k.balance !== undefined) && !def.audio) throw new UserError(`event "${k.name}" has no audio; volume and balance need one`);
		if (k.volume !== undefined && r3(k.volume) !== (def.volume ?? 1)) out.volume = r3(k.volume);
		if (k.balance !== undefined && r3(k.balance) !== (def.balance ?? 0)) out.balance = r3(k.balance);
		return out as { time: number; name: string };
	});
	const old = replace ? [] : ((a.events ?? []) as { time?: number; name: string }[]);
	const kept = old.filter((o) => !fresh.some((f) => f.name === o.name && Math.abs((o.time ?? 0) - f.time) < EPS));
	// Stable sort: events at the same time fire in the order given.
	a.events = [...kept, ...fresh].sort((x, y) => (x.time ?? 0) - (y.time ?? 0));
	return `${fresh.length} event key(s) on ${anim}${defined.length ? `; defined ${defined.join(", ")}` : ""}`;
}

export interface DrawOrderKey {
	time: number;
	/**
	 * Slot names back to front. All slots, or some of them: listed slots trade the places they hold in
	 * setup among themselves. Omitted or empty: back to the setup order.
	 */
	order?: string[];
}

/** Changes the draw order during an animation (an arm swinging behind the body, a card flipping). */
export function writeDrawOrderKeys(ws: Workspace, anim: string, keys: DrawOrderKey[]): string {
	assertUnlocked(ws, "animations", [anim]);
	if (!keys.length) return "";
	const setup = ws.doc.slots.map((s) => s.name);
	const sorted = [...keys].sort((a, b) => a.time - b.time);
	const fresh = sorted.map((k) => {
		const out: DrawOrderJson = { time: rt(k.time) };
		const order = k.order ?? [];
		for (const n of order) if (!setup.includes(n)) throw new UserError(`slot "${n}" not found`);
		if (new Set(order).size !== order.length) throw new UserError(`draw order at ${k.time}s lists a slot twice`);
		const names = [...setup];
		const places = order.map((n) => setup.indexOf(n)).sort((x, y) => x - y);
		places.forEach((p, i) => (names[p] = order[i]));
		const offsets = orderToOffsets(setup, names.map((n) => setup.indexOf(n)));
		if (offsets) out.offsets = offsets;
		return out;
	});
	const a = animation(ws, anim);
	a.drawOrder = mergeKeys((a.drawOrder ?? []) as DrawOrderJson[], fresh);
	const moved = fresh.map((k) => k.offsets?.length ?? 0);
	return `${fresh.length} draw order key(s) on ${anim} (slots moved: ${moved.join(", ")})`;
}

/** Deletes an event and every key that fires it. */
export function removeEvent(ws: Workspace, name: string): string {
	if (!ws.doc.events?.[name]) throw new UserError(`event "${name}" not found`);
	const locked = Object.entries(ws.doc.animations).filter(([n, a]) => ws.meta.locks.animations.includes(n) && (a.events as { name: string }[] | undefined)?.some((e) => e.name === name));
	if (locked.length) throw new UserError(`event "${name}" is keyed in locked animation ${locked.map(([n]) => n).join(", ")}`);
	delete ws.doc.events[name];
	if (!Object.keys(ws.doc.events).length) delete ws.doc.events;
	let removed = 0;
	for (const a of Object.values(ws.doc.animations)) {
		const keys = a.events as { name: string }[] | undefined;
		if (!keys) continue;
		const left = keys.filter((e) => e.name !== name);
		removed += keys.length - left.length;
		if (left.length) a.events = left;
		else delete a.events;
	}
	return `removed event ${name} and ${removed} key(s)`;
}
