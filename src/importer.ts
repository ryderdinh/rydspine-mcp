// Imports an existing Spine 4.3 export (skeleton JSON plus loose images or a packed atlas) as a project.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TextureAtlas } from "@esotericsoftware/spine-core";
import { PNG } from "pngjs";
import { readPng } from "./atlas.js";
import { load } from "./runtime.js";
import { SPINE_VERSION, type SkeletonDoc } from "./types.js";
import { UserError, Workspace } from "./workspace.js";

const LEGACY_CONSTRAINT_KEYS = ["ik", "transform", "path", "physics"];

export interface ImportSpec {
	name: string;
	skeleton: string;
	images?: string;
	atlas?: string;
	loops?: string[];
}

/** Reads and normalizes an exported Spine 4.3 skeleton JSON. */
function readSkeleton(path: string, notes: string[]): SkeletonDoc {
	if (!existsSync(path)) throw new UserError(`skeleton file not found: ${path}`);
	if (!path.toLowerCase().endsWith(".json"))
		throw new UserError("only skeleton JSON is supported; export JSON (not binary .skel) from Spine");
	let doc: SkeletonDoc;
	try {
		doc = JSON.parse(readFileSync(path, "utf8"));
	} catch (e) {
		throw new UserError(`not valid JSON: ${(e as Error).message}`);
	}
	const legacy = LEGACY_CONSTRAINT_KEYS.filter((k) => Array.isArray(doc[k]));
	if (legacy.length)
		throw new UserError(
			`this JSON uses pre-4.3 constraint lists (${legacy.join(", ")}); open it in Spine 4.3 and export again`,
		);
	const version = String(doc.skeleton?.spine ?? "unknown");
	if (!version.startsWith("4.3")) notes.push(`exported by Spine ${version}; rydspine targets 4.3 (${SPINE_VERSION})`);
	doc.skeleton ??= { spine: version };
	doc.bones ??= [{ name: "root" }];
	doc.slots ??= [];
	doc.constraints ??= [];
	doc.skins ??= [];
	if (!doc.skins.some((s) => s.name === "default")) doc.skins.unshift({ name: "default", attachments: {} });
	doc.animations ??= {};
	doc.skeleton.images = "./images/";
	return doc;
}

function addImages(ws: Workspace, spec: { images?: string; atlas?: string }, notes: string[], required: boolean): void {
	if (spec.images) notes.push(`copied ${ws.addImageDir(spec.images).length} images`);
	else if (spec.atlas) notes.push(`unpacked ${unpackAtlas(spec.atlas, ws.imagesDir).length} images from the atlas`);
	else if (required) throw new UserError("give `images` (folder of PNGs) or `atlas` (.atlas next to its .png pages)");
}

export function importProject(spec: ImportSpec): { ws: Workspace; notes: string[] } {
	const notes: string[] = [];
	const doc = readSkeleton(spec.skeleton, notes);
	const ws = Workspace.create(spec.name, doc);
	addImages(ws, spec, notes, true);
	for (const name of spec.loops ?? []) {
		if (!doc.animations[name]) throw new UserError(`animation "${name}" not found in the skeleton`);
		ws.meta.loops[name] = true;
	}
	load(ws);
	ws.commit(`import ${spec.skeleton}`);
	return { ws, notes };
}

export interface SyncSpec {
	skeleton: string;
	images?: string;
	atlas?: string;
}

/**
 * Brings back a skeleton that was edited in Spine Editor and exported again: it replaces the project's
 * skeleton as a new version (so it can be diffed and reverted), adds changed images, keeps loop flags
 * for animations that still exist, and reports locked items the edit touched.
 */
export function syncProject(ws: Workspace, spec: SyncSpec): string[] {
	const notes: string[] = [];
	const before = ws.doc;
	const doc = readSkeleton(spec.skeleton, notes);
	addImages(ws, spec, notes, false);
	ws.doc = doc;
	for (const name of Object.keys(ws.meta.loops)) if (!doc.animations[name]) delete ws.meta.loops[name];
	const touched = lockedChanges(before, doc, ws.meta.locks);
	if (touched.length) notes.push(`note: the Spine edit changed locked items: ${touched.join(", ")}`);
	return notes;
}

function lockedChanges(a: SkeletonDoc, b: SkeletonDoc, locks: { bones: string[]; slots: string[]; animations: string[] }): string[] {
	const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
	const out: string[] = [];
	for (const n of locks.bones) if (!same(a.bones.find((x) => x.name === n), b.bones.find((x) => x.name === n))) out.push(`bone ${n}`);
	for (const n of locks.slots) if (!same(a.slots.find((x) => x.name === n), b.slots.find((x) => x.name === n))) out.push(`slot ${n}`);
	for (const n of locks.animations) if (!same(a.animations[n], b.animations[n])) out.push(`animation ${n}`);
	return out;
}

/** Writes every atlas region back out as a PNG at its original (untrimmed, unrotated) size. */
export function unpackAtlas(atlasPath: string, outDir: string): string[] {
	if (!existsSync(atlasPath)) throw new UserError(`atlas not found: ${atlasPath}`);
	const atlas = new TextureAtlas(readFileSync(atlasPath, "utf8"));
	const names: string[] = [];
	for (const page of atlas.pages) {
		const pagePath = join(dirname(atlasPath), page.name);
		if (!existsSync(pagePath)) throw new UserError(`atlas page not found: ${pagePath}`);
		const src = readPng(pagePath);
		for (const r of page.regions) {
			if (page.regions.filter((o) => o.name === r.name).length > 1)
				throw new UserError(`region "${r.name}" is an image sequence, which is not supported yet`);
			if (r.degrees !== 0 && r.degrees !== 90) throw new UserError(`region "${r.name}" uses unsupported rotation ${r.degrees}`);
			const out = new PNG({ width: r.originalWidth, height: r.originalHeight });
			// Atlas offsets are measured from the bottom-left of the original image.
			const left = r.offsetX;
			const top = r.originalHeight - r.offsetY - r.height;
			for (let iy = 0; iy < r.height; iy++) {
				for (let ix = 0; ix < r.width; ix++) {
					const px = r.degrees === 90 ? r.x + iy : r.x + ix;
					const py = r.degrees === 90 ? r.y + (r.width - 1 - ix) : r.y + iy;
					const s = (py * src.width + px) * 4;
					const d = ((top + iy) * out.width + left + ix) * 4;
					const a = src.data[s + 3];
					// Premultiplied pages store color * alpha; images on disk must be straight alpha.
					const k = page.pma && a > 0 ? 255 / a : 1;
					out.data[d] = Math.min(255, Math.round(src.data[s] * k));
					out.data[d + 1] = Math.min(255, Math.round(src.data[s + 1] * k));
					out.data[d + 2] = Math.min(255, Math.round(src.data[s + 2] * k));
					out.data[d + 3] = a;
				}
			}
			const file = join(outDir, `${r.name}.png`);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, PNG.sync.write(out));
			names.push(r.name);
		}
	}
	return names;
}
