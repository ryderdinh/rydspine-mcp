// Animation keys and motion primitives. Bone timeline values are offsets from the setup pose
// (scale timelines are multipliers), so motions compose without knowing the rig's absolute pose.
import type { AnimationJson, Curve, ValueKey } from "./types.js";
import { UserError, type Workspace } from "./workspace.js";
import { assertUnlocked, findBone } from "./rig.js";

export const PROPERTIES = ["rotate", "translatex", "translatey", "scalex", "scaley", "shearx", "sheary"] as const;
export type Property = (typeof PROPERTIES)[number];

export const EASES = ["linear", "stepped", "ease-in", "ease-out", "ease-in-out", "back-in", "back-out"] as const;
export type Ease = (typeof EASES)[number];

const BEZIER: Record<Exclude<Ease, "linear" | "stepped">, [number, number, number, number]> = {
	"ease-in": [0.42, 0, 1, 1],
	"ease-out": [0, 0, 0.58, 1],
	"ease-in-out": [0.42, 0, 0.58, 1],
	"back-in": [0.36, 0, 0.66, -0.56],
	"back-out": [0.34, 1.56, 0.64, 1],
};

const EPS = 1e-4;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const neutral = (p: Property) => (p === "scalex" || p === "scaley" ? 1 : 0);

/** Spine stores a segment's curve as bezier control points in (time, value) space. */
function easeCurve(ease: Ease, t0: number, v0: number, t1: number, v1: number): Curve | undefined {
	if (ease === "linear") return undefined;
	if (ease === "stepped") return "stepped";
	const [x1, y1, x2, y2] = BEZIER[ease];
	const dt = t1 - t0;
	const dv = v1 - v0;
	return [t0 + x1 * dt, v0 + y1 * dv, t0 + x2 * dt, v0 + y2 * dv].map(r3);
}

/** Cubic Hermite segment (values and slopes at both ends) as a Spine bezier. */
function hermite(t0: number, v0: number, d0: number, t1: number, v1: number, d1: number): Curve {
	const h = (t1 - t0) / 3;
	return [t0 + h, v0 + d0 * h, t1 - h, v1 - d1 * h].map(r3);
}

export interface Key {
	time: number;
	value: number;
	ease?: Ease;
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
		const out: ValueKey = { time: r3(k.time), value: r3(k.value) };
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
	for (const tls of Object.values(animation(ws, anim).bones ?? {}))
		for (const keys of Object.values(tls)) for (const k of keys) max = Math.max(max, k.time ?? 0);
	return max;
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
	ease?: Ease;
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
