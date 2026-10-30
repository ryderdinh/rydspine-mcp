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

export function importProject(spec: ImportSpec): { ws: Workspace; notes: string[] } {
	const notes: string[] = [];
	if (!existsSync(spec.skeleton)) throw new UserError(`skeleton file not found: ${spec.skeleton}`);
	if (!spec.skeleton.toLowerCase().endsWith(".json"))
		throw new UserError("only skeleton JSON is supported; export JSON (not binary .skel) from Spine");
	let doc: SkeletonDoc;
	try {
		doc = JSON.parse(readFileSync(spec.skeleton, "utf8"));
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
	doc.bones ??= [{ name: "root" }];
	doc.slots ??= [];
	doc.constraints ??= [];
	doc.skins ??= [];
	if (!doc.skins.some((s) => s.name === "default")) doc.skins.unshift({ name: "default", attachments: {} });
	doc.animations ??= {};
	doc.skeleton.images = "./images/";

	const ws = Workspace.create(spec.name, doc);
	if (spec.images) {
		const added = ws.addImageDir(spec.images);
		notes.push(`copied ${added.length} images`);
	} else if (spec.atlas) {
		const added = unpackAtlas(spec.atlas, ws.imagesDir);
		notes.push(`unpacked ${added.length} images from the atlas`);
	} else {
		throw new UserError("give `images` (folder of PNGs) or `atlas` (.atlas next to its .png pages)");
	}

	for (const name of spec.loops ?? []) {
		if (!doc.animations[name]) throw new UserError(`animation "${name}" not found in the skeleton`);
		ws.meta.loops[name] = true;
	}
	load(ws);
	ws.commit(`import ${spec.skeleton}`);
	return { ws, notes };
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
