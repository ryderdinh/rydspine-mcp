// Readable differences between two versions of a skeleton: what was added, removed or changed,
// down to the field or timeline, so a reviewer can see exactly what an edit touched.
import type { ProjectMeta, SkeletonDoc } from "./types.js";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (v: unknown) => (v === undefined ? "unset" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v));

function byName<T extends { name: string }>(items: T[]): Map<string, T> {
	return new Map(items.map((i) => [i.name, i]));
}

function fields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "name");
	return keys.filter((k) => !same(a[k], b[k])).map((k) => `${k} ${fmt(a[k])} -> ${fmt(b[k])}`);
}

function named<T extends { name: string }>(kind: string, a: T[], b: T[], out: string[]): void {
	const ma = byName(a);
	const mb = byName(b);
	for (const [n, x] of mb) {
		const old = ma.get(n);
		if (!old) out.push(`+ ${kind} ${n}`);
		else if (!same(old, x)) out.push(`~ ${kind} ${n}: ${fields(old as never, x as never).join(", ")}`);
	}
	for (const n of ma.keys()) if (!mb.has(n)) out.push(`- ${kind} ${n}`);
	const orderA = a.map((x) => x.name).filter((n) => mb.has(n));
	const orderB = b.map((x) => x.name).filter((n) => ma.has(n));
	if (kind === "slot" && !same(orderA, orderB)) out.push("~ draw order changed");
}

function attachments(a: SkeletonDoc, b: SkeletonDoc, out: string[]): void {
	const flat = (doc: SkeletonDoc) => {
		const m = new Map<string, unknown>();
		for (const skin of doc.skins)
			for (const [slot, atts] of Object.entries(skin.attachments))
				for (const [name, att] of Object.entries(atts)) m.set(`${skin.name}/${slot}/${name}`, att);
		return m;
	};
	const fa = flat(a);
	const fb = flat(b);
	for (const [k, v] of fb) {
		const old = fa.get(k) as { type?: string } | undefined;
		const now = v as { type?: string };
		if (!old) out.push(`+ attachment ${k} (${now.type ?? "region"})`);
		else if (!same(old, v))
			out.push(
				(old.type ?? "region") !== (now.type ?? "region")
					? `~ attachment ${k}: ${old.type ?? "region"} -> ${now.type ?? "region"}`
					: `~ attachment ${k}: ${fields(old as never, now as never)
							.map((f) => f.split(" ")[0])
							.join(", ")} changed`,
			);
	}
	for (const k of fa.keys()) if (!fb.has(k)) out.push(`- attachment ${k}`);
}

function timelines(anim: Record<string, unknown> | undefined): Map<string, unknown> {
	const m = new Map<string, unknown>();
	if (!anim) return m;
	for (const group of ["bones", "slots"] as const) {
		const tls = (anim[group] ?? {}) as Record<string, Record<string, unknown>>;
		for (const [owner, props] of Object.entries(tls)) for (const [prop, keys] of Object.entries(props)) m.set(`${owner}.${prop}`, keys);
	}
	for (const [k, v] of Object.entries(anim)) if (k !== "bones" && k !== "slots") m.set(k, v);
	return m;
}

function animations(a: SkeletonDoc, b: SkeletonDoc, out: string[]): void {
	for (const [n, anim] of Object.entries(b.animations)) {
		const old = a.animations[n];
		if (!old) {
			out.push(`+ animation ${n} (${timelines(anim).size} timelines)`);
			continue;
		}
		if (same(old, anim)) continue;
		const ta = timelines(old);
		const tb = timelines(anim);
		const parts: string[] = [];
		for (const [k, v] of tb) {
			if (!ta.has(k)) parts.push(`+${k}`);
			else if (!same(ta.get(k), v)) parts.push(`~${k} (${(ta.get(k) as unknown[]).length} -> ${(v as unknown[]).length} keys)`);
		}
		for (const k of ta.keys()) if (!tb.has(k)) parts.push(`-${k}`);
		out.push(`~ animation ${n}: ${parts.join(", ")}`);
	}
	for (const n of Object.keys(a.animations)) if (!b.animations[n]) out.push(`- animation ${n}`);
}

export function diffVersions(a: { doc: SkeletonDoc; meta: ProjectMeta }, b: { doc: SkeletonDoc; meta: ProjectMeta }): string[] {
	const out: string[] = [];
	named("bone", a.doc.bones, b.doc.bones, out);
	named("slot", a.doc.slots, b.doc.slots, out);
	named("constraint", a.doc.constraints, b.doc.constraints, out);
	attachments(a.doc, b.doc, out);
	animations(a.doc, b.doc, out);
	for (const n of new Set([...Object.keys(a.meta.loops), ...Object.keys(b.meta.loops)]))
		if (!!a.meta.loops[n] !== !!b.meta.loops[n] && a.doc.animations[n] && b.doc.animations[n])
			out.push(`~ animation ${n}: ${b.meta.loops[n] ? "now loops" : "no longer loops"}`);
	for (const kind of ["bones", "slots", "animations"] as const)
		if (!same(a.meta.locks[kind], b.meta.locks[kind])) out.push(`~ locked ${kind}: ${a.meta.locks[kind].join(", ") || "none"} -> ${b.meta.locks[kind].join(", ") || "none"}`);
	return out;
}
