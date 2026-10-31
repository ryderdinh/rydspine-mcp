// Acceptance on real art: the dragon from Esoteric's official examples (artist-drawn parts, frame-by-frame wings).
// There is no PSD in the examples, so one is made the way an artist delivers it: every part drawn in place
// (turned as in the original setup pose), flat layers in draw order, and a hidden "<part>[pivot]" dot on each joint.
// The rig and the animation are then built only through the MCP tools, and checked:
//   - the setup pose after psd_import looks the same as the original (both drawn to pixels and compared);
//   - bones sit on the original joints; validate passes; Spine Editor imports and exports it unchanged.
// The art is fetched into ~/.cache/rydspine/spine-art and its results stay in acceptance/out (git-ignored):
// examples/dragon/license.txt allows demonstration only, no redistribution and no derivative work, so never
// commit or publish anything this script writes.
//
// Usage: npx tsx acceptance/real-art.ts [outDir]   (default acceptance/out/real-art)
//        SPINE_CLI as for spine-check.ts adds the Spine Editor round trip.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { RegionAttachment, Skeleton, SkeletonJson, Physics } from "@esotericsoftware/spine-core";
import { writePsdBuffer } from "ag-psd";
import { PNG } from "pngjs";
import { shownPath } from "../src/runtime.js";
import { connect } from "../test/helpers.js";
import { PlaceholderLoader } from "./compare.js";
import { launcher, roundTrip, type SpineCheck } from "./spine-check.js";

const BRANCH = process.env.RYDSPINE_RUNTIMES_BRANCH ?? "4.3";
const CACHE = join(homedir(), ".cache", "rydspine", "spine-art");

function fetchArt(): string {
	const run = (args: string[], cwd?: string) => {
		const r = spawnSync("git", args, { cwd, encoding: "utf8" });
		if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	};
	if (!existsSync(CACHE)) {
		run(["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "-b", BRANCH, "https://github.com/EsotericSoftware/spine-runtimes", CACHE]);
		run(["sparse-checkout", "set", "--no-cone", "/examples/dragon/images/", "/examples/dragon/export/dragon-ess.json", "/examples/dragon/license.txt"], CACHE);
	}
	return join(CACHE, "examples", "dragon");
}

// ---- A small software renderer: premultiplied float canvas, bilinear sampling. ----

interface Canvas {
	width: number;
	height: number;
	/** Premultiplied RGBA, 0..1. */
	data: Float32Array;
}

const canvas = (width: number, height: number): Canvas => ({ width, height, data: new Float32Array(width * height * 4) });
type Pt = [number, number];

const images = new Map<string, PNG>();
function image(file: string): PNG {
	let png = images.get(file);
	if (!png) images.set(file, (png = PNG.sync.read(readFileSync(file))));
	return png;
}

/** Draws an image so its top-left, top-right and bottom-left corners land on ul, ur, bl (canvas pixels). */
function drawQuad(dst: Canvas, src: PNG, ul: Pt, ur: Pt, bl: Pt, alpha = 1): void {
	const ax = ur[0] - ul[0], ay = ur[1] - ul[1];
	const bx = bl[0] - ul[0], by = bl[1] - ul[1];
	const det = ax * by - ay * bx;
	const xs = [ul[0], ur[0], bl[0], ur[0] + bx];
	const ys = [ul[1], ur[1], bl[1], ur[1] + by];
	const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(dst.width - 1, Math.ceil(Math.max(...xs)));
	const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(dst.height - 1, Math.ceil(Math.max(...ys)));
	const texel = (x: number, y: number, c: number) => {
		if (x < 0 || y < 0 || x >= src.width || y >= src.height) return 0;
		const i = (y * src.width + x) * 4;
		const a = src.data[i + 3] / 255;
		return c === 3 ? a : (src.data[i + c] / 255) * a;
	};
	for (let py = y0; py <= y1; py++)
		for (let px = x0; px <= x1; px++) {
			const dx = px + 0.5 - ul[0], dy = py + 0.5 - ul[1];
			const u = (dx * by - dy * bx) / det;
			const v = (ax * dy - ay * dx) / det;
			if (u < -0.01 || v < -0.01 || u > 1.01 || v > 1.01) continue;
			const sx = u * src.width - 0.5, sy = v * src.height - 0.5;
			const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
			const s = [0, 0, 0, 0];
			for (let c = 0; c < 4; c++)
				s[c] =
					(texel(ix, iy, c) * (1 - fx) + texel(ix + 1, iy, c) * fx) * (1 - fy) +
					(texel(ix, iy + 1, c) * (1 - fx) + texel(ix + 1, iy + 1, c) * fx) * fy;
			const k = (py * dst.width + px) * 4;
			const a = s[3] * alpha;
			for (let c = 0; c < 4; c++) dst.data[k + c] = s[c] * alpha + dst.data[k + c] * (1 - a);
		}
}

function toPng(c: Canvas, background?: number): PNG {
	const png = new PNG({ width: c.width, height: c.height });
	for (let i = 0; i < c.data.length; i += 4) {
		const a = c.data[i + 3];
		for (let k = 0; k < 3; k++) {
			const straight = a > 0 ? c.data[i + k] / a : 0;
			png.data[i + k] = Math.round(255 * (background === undefined ? straight : c.data[i + k] + background * (1 - a)));
		}
		png.data[i + 3] = background === undefined ? Math.round(255 * a) : 255;
	}
	return png;
}

/** The opaque bounding box of a canvas, or null when it is empty. */
function opaqueBounds(c: Canvas): { left: number; top: number; right: number; bottom: number } | null {
	let left = c.width, top = c.height, right = -1, bottom = -1;
	for (let y = 0; y < c.height; y++)
		for (let x = 0; x < c.width; x++)
			if (c.data[(y * c.width + x) * 4 + 3] > 1 / 512) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
	return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

function crop(c: Canvas, b: { left: number; top: number; right: number; bottom: number }): PNG {
	const out = canvas(b.right - b.left, b.bottom - b.top);
	for (let y = 0; y < out.height; y++)
		out.data.set(c.data.subarray(((b.top + y) * c.width + b.left) * 4, ((b.top + y) * c.width + b.right) * 4), y * out.width * 4);
	return toPng(out);
}

// ---- Skeletons ----

/** Canvas whose centre is world (0, 0), y up. */
interface Frame {
	width: number;
	height: number;
}
const toCanvas = (f: Frame, x: number, y: number): Pt => [x + f.width / 2, f.height / 2 - y];

function loadSkeleton(json: string): Skeleton {
	const data = new SkeletonJson(new PlaceholderLoader()).readSkeletonData(JSON.parse(readFileSync(json, "utf8")));
	const skeleton = new Skeleton(data);
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	return skeleton;
}

/** World corners (ul, ur, bl) of a slot's region as shown in the current pose. */
function corners(skeleton: Skeleton, slotName: string): { ul: Pt; ur: Pt; bl: Pt; path: string; alpha: number } | null {
	const slot = skeleton.findSlot(slotName)!;
	const att = slot.appliedPose.attachment;
	if (!(att instanceof RegionAttachment)) return null;
	const v = new Array<number>(8);
	att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
	// spine-core order: bottom-left, top-left, top-right, bottom-right.
	return { bl: [v[0], v[1]], ul: [v[2], v[3]], ur: [v[4], v[5]], path: shownPath(att, slot.appliedPose), alpha: slot.appliedPose.color.a * att.color.a };
}

function drawSlot(dst: Canvas, f: Frame, skeleton: Skeleton, slot: string, imagesDir: string): void {
	const c = corners(skeleton, slot);
	if (!c) return;
	drawQuad(dst, image(join(imagesDir, `${c.path}.png`)), toCanvas(f, ...c.ul), toCanvas(f, ...c.ur), toCanvas(f, ...c.bl), c.alpha);
}

function renderSetup(json: string, imagesDir: string, f: Frame): Canvas {
	const skeleton = loadSkeleton(json);
	const out = canvas(f.width, f.height);
	for (const slot of skeleton.drawOrder.appliedPose) drawSlot(out, f, skeleton, slot.data.name, imagesDir);
	return out;
}

/** Overlap of the opaque areas and mean colour difference (0..255) where either is opaque. */
function compareRenders(a: Canvas, b: Canvas): { iou: number; colour: number; diff: PNG } {
	let both = 0, either = 0, sum = 0;
	const diff = new PNG({ width: a.width, height: a.height });
	for (let i = 0; i < a.data.length; i += 4) {
		const oa = a.data[i + 3] >= 0.5, ob = b.data[i + 3] >= 0.5;
		let d = 0;
		for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
		if (oa || ob) {
			either++;
			if (oa && ob) both++;
			sum += d * 255;
		}
		const shade = Math.round(255 * (1 - Math.min(1, d * 4)));
		diff.data.set(oa || ob ? [255, shade, shade, 255] : [255, 255, 255, 255], i);
	}
	return { iou: both / either, colour: sum / either, diff };
}

// ---- The run ----

interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

export async function realArt(outDir: string): Promise<{ checks: Check[]; spine: SpineCheck | null }> {
	const dragon = fetchArt();
	const originalJson = join(dragon, "export", "dragon-ess.json");
	const originalImages = join(dragon, "images");
	mkdirSync(outDir, { recursive: true });
	const checks: Check[] = [];
	const original = loadSkeleton(originalJson);

	// The canvas: centred on world (0, 0) and big enough for every frame of every part.
	let extent = [0, 0];
	for (const slot of original.drawOrder.appliedPose) {
		const c = corners(original, slot.data.name);
		if (!c) continue;
		const br: Pt = [c.ur[0] + c.bl[0] - c.ul[0], c.ur[1] + c.bl[1] - c.ul[1]];
		for (const [x, y] of [c.ul, c.ur, c.bl, br]) extent = [Math.max(extent[0], Math.abs(x)), Math.max(extent[1], Math.abs(y))];
	}
	const f: Frame = { width: 2 * Math.ceil(extent[0] + 8), height: 2 * Math.ceil(extent[1] + 8) };

	// ---- The artist's PSD ----
	const layers: object[] = [];
	const sequences: { slot: string; frames: string[]; x: number; y: number }[] = [];
	const art = join(outDir, "art");
	mkdirSync(art, { recursive: true });
	for (const slot of original.drawOrder.appliedPose) {
		const name = slot.data.name;
		const att = slot.appliedPose.attachment;
		if (!(att instanceof RegionAttachment)) continue;
		const layer = canvas(f.width, f.height);
		drawSlot(layer, f, original, name, originalImages);
		const b = opaqueBounds(layer);
		if (!b) continue;
		const png = crop(layer, b);
		layers.push({ name, left: b.left, top: b.top, right: b.right, bottom: b.bottom, imageData: { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) } });
		const bone = slot.bone.appliedPose;
		const [px, py] = toCanvas(f, bone.worldX, bone.worldY).map(Math.round);
		layers.push({ name: `${name}[pivot]`, left: px - 2, top: py - 2, right: px + 2, bottom: py + 2, hidden: true, imageData: { width: 4, height: 4, data: new Uint8ClampedArray(64).fill(255) } });

		// Frame-by-frame parts: every frame drawn in place too, cut to one shared box.
		const count = att.sequence?.regions.length ?? 0;
		if (count > 1) {
			const frames = Array.from({ length: count }, (_, i) => {
				slot.appliedPose.sequenceIndex = i;
				const c = canvas(f.width, f.height);
				drawSlot(c, f, original, name, originalImages);
				return c;
			});
			slot.appliedPose.sequenceIndex = -1;
			const boxes = frames.map(opaqueBounds).filter((x) => x !== null);
			const box = {
				left: Math.min(...boxes.map((x) => x.left)),
				top: Math.min(...boxes.map((x) => x.top)),
				right: Math.max(...boxes.map((x) => x.right)),
				bottom: Math.max(...boxes.map((x) => x.bottom)),
			};
			const files = frames.map((c, i) => {
				const file = join(art, `${name}-${String(i + 1).padStart(2, "0")}.png`);
				writeFileSync(file, PNG.sync.write(crop(c, box)));
				return file;
			});
			sequences.push({ slot: name, frames: files, x: (box.left + box.right) / 2 - f.width / 2, y: f.height / 2 - (box.top + box.bottom) / 2 });
		}
	}
	const psdFile = join(outDir, "dragon.psd");
	writeFileSync(psdFile, writePsdBuffer({ width: f.width, height: f.height, children: layers } as never));

	// ---- Rig and animate through the MCP tools ----
	const { ok, call } = await connect();
	const project = "dragon";
	await ok("project_create", { name: project });
	const imported = await ok("psd_import", { project, psd: psdFile, origin: "center" });
	checks.push({ name: "psd_import", ok: true, detail: imported.text.split("\n")[0] });

	// Joints without a part of their own, then the hierarchy, then each bone aimed along its limb.
	// Positions, directions and lengths are read off the art; here they come from the original rig.
	const bones = original.bones.filter((b) => b.data.name !== "root");
	const made = new Set(imported.text.match(/^ {2}(\S+) \(parent/gm)?.map((l) => l.trim().split(" ")[0]));
	const missing = bones.filter((b) => !made.has(b.data.name));
	if (missing.length)
		await ok("bone_add", { project, bones: missing.map((b) => ({ name: b.data.name, x: b.appliedPose.worldX, y: b.appliedPose.worldY, space: "world" })) });
	for (const b of bones) if (b.parent && b.parent.data.name !== "root") await ok("bone_update", { project, name: b.data.name, parent: b.parent.data.name });
	for (const b of bones)
		if (b.data.length > 0)
			await ok("bone_update", { project, name: b.data.name, rotation: b.appliedPose.getWorldRotationX(), length: b.data.length, space: "world", compensate: true });

	// Wings flap frame by frame.
	for (const s of sequences) {
		await ok("sequence_import", { project, name: `${s.slot}-flap`, slot: s.slot, images: s.frames, x: s.x, y: s.y });
		await ok("slot_update", { project, name: s.slot, attachment: `${s.slot}-flap` });
	}
	// The tail trails behind the body.
	for (const n of [2, 3, 4, 5, 6])
		await ok("constraint_add", { project, constraint: { type: "physics", name: `tail${n}-drag`, bone: `tail${n}`, rotate: 1, inertia: 0.5, strength: 100, damping: 0.85, mass: 2.8 } });

	const T = 0.9;
	await ok("anim_create", { project, name: "fly", loop: true });
	for (const s of sequences)
		await ok("anim_sequence_keys", { project, animation: "fly", slot: s.slot, keys: [{ time: 0, mode: "loop", delay: T / s.frames.length }] });
	const sway = (bones: string[], property: string, amplitude: number, phase = 0, period = T) =>
		ok("anim_oscillate", { project, animation: "fly", bones, property, amplitude, period, end: T, phase });
	await sway(["center"], "translatey", 22, 0.25);
	await sway(["center"], "rotate", 4, 0.5);
	await sway(["neck"], "rotate", 5, 0.62);
	await sway(["head"], "rotate", 4, 0.75);
	await sway(["chin"], "rotate", 5, 0, T / 2);
	await sway(["tail1"], "rotate", 8, 0.65);
	await sway(["left-front-thigh", "right-front-thigh"], "rotate", 9, 0.4);
	await sway(["left-front-leg", "right-front-leg"], "rotate", 12, 0.55);
	await sway(["right-rear-thigh"], "rotate", 6, 0.45);
	await sway(["left-rear-leg", "right-rear-leg"], "rotate", 10, 0.6);

	const v = await call("validate", { project });
	checks.push({ name: "validate", ok: !v.isError, detail: v.text });
	const shot = await call("preview", { project, animation: "fly", frames: 8, showBones: false });
	checks.push({ name: "preview", ok: !shot.isError, detail: shot.text });
	const exportDir = join(outDir, "export");
	const e = await call("export", { project, outDir: exportDir });
	checks.push({ name: "export", ok: !e.isError, detail: e.text.split("\n")[0] });

	// ---- Checks against the original ----
	const ours = loadSkeleton(join(exportDir, `${project}.json`));
	let worstJoint = 0, worstTurn = 0, where = "";
	for (const b of bones) {
		const o = ours.findBone(b.data.name)!.appliedPose;
		const d = Math.hypot(o.worldX - b.appliedPose.worldX, o.worldY - b.appliedPose.worldY);
		if (d > worstJoint) [worstJoint, where] = [d, b.data.name];
		if (b.data.length > 0) {
			const turn = Math.abs(((o.getWorldRotationX() - b.appliedPose.getWorldRotationX() + 540) % 360) - 180);
			worstTurn = Math.max(worstTurn, turn);
		}
	}
	checks.push({
		name: "joints",
		ok: worstJoint <= 1 && worstTurn <= 0.05,
		detail: `${bones.length} bones on the original joints within ${worstJoint.toFixed(2)} px (${where}; [pivot] dots are whole pixels), directions within ${worstTurn.toFixed(3)}°`,
	});
	const a = renderSetup(originalJson, originalImages, f);
	const b = renderSetup(join(exportDir, `${project}.json`), join(exportDir, "images"), f);
	const cmp = compareRenders(a, b);
	writeFileSync(join(outDir, "setup-original.png"), PNG.sync.write(toPng(a, 1)));
	writeFileSync(join(outDir, "setup-rydspine.png"), PNG.sync.write(toPng(b, 1)));
	writeFileSync(join(outDir, "setup-diff.png"), PNG.sync.write(cmp.diff));
	checks.push({
		name: "setup pose vs original",
		ok: cmp.iou >= 0.98 && cmp.colour <= 8,
		detail: `opaque area overlap ${(cmp.iou * 100).toFixed(2)}%, mean colour difference ${cmp.colour.toFixed(2)}/255 (resampling only)`,
	});

	const base = launcher();
	const spine = base ? roundTrip(base, join(exportDir, `${project}.json`), project, ["fly"], join(outDir, "spine")) : null;
	writeFileSync(join(outDir, "report.json"), `${JSON.stringify({ checks, spine: spine && { ...spine, log: undefined } }, null, 2)}\n`);
	return { checks, spine };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const out = resolve(process.argv[2] ?? "acceptance/out/real-art");
	const { checks, spine } = await realArt(out);
	for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail.split("\n").join(" | ")}`);
	if (!spine) console.log("skip Spine Editor round trip: set SPINE_CLI (or SPINE_ACTIVATION_CODE on Linux)");
	else {
		console.log(`${spine.ok ? "ok  " : "FAIL"} Spine Editor round trip`);
		for (const c of spine.animations) console.log(`       ${c.animation}: ${c.frames} frames, max difference ${c.worst.toFixed(4)}${c.where ? ` (${c.where})` : ""}`);
		for (const p of spine.problems) console.log(`       ! ${p}`);
		for (const s of spine.sheets) console.log(`       sheet ${s}`);
	}
	console.log(`\nwritten to ${out}`);
	process.exit(checks.every((c) => c.ok) && (spine?.ok ?? true) ? 0 : 1);
}
