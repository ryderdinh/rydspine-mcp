// Splits a flat picture (one image, no layers) into parts. Either every separate blob on a transparent or plain
// background becomes a part, or the caller outlines each part with a polygon (back to front; where outlines
// overlap, the part in front owns the pixels). "overlap" paints in the pixels a part in front hides, by
// smearing the part's own edge colors inward, so a joint shows no gap when the front part turns.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PNG } from "pngjs";
import type { Origin } from "./psd.js";
import { addPart } from "./rig.js";
import { checkImagePath, checkName, UserError, type Workspace } from "./workspace.js";

const MAX_SIDE = 8192;
const MAX_AUTO_PARTS = 64;
const VIEW_SIDE = 1024;
const BG = -1;
const FREE = -2;

export interface SplitPart {
	name: string;
	/** Outline in image pixels: x right, y down from the top-left corner. */
	polygon: [number, number][];
	/** Pixels to paint in under parts drawn in front of this one (overrides the spec's overlap). */
	overlap?: number;
}

export interface SplitSpec {
	image: string;
	parts?: SplitPart[];
	/** "auto" (default), "transparent", or a color like "#ffffff". */
	background?: string;
	/** Largest per-channel difference still counted as background color (default 24). */
	tolerance?: number;
	overlap?: number;
	/** Auto mode: blobs smaller than this many pixels join the nearest bigger blob (default 64). */
	minArea?: number;
	/** Plain-color background: width in pixels of the anti-aliased rim to unmix from it (default 2, 0 = off). */
	matte?: number;
	/** Polygon mode: stray pixels within this distance of a part join it (default 4). */
	snap?: number;
	/** Auto mode: names are <prefix>-1, <prefix>-2... (default "part"). */
	prefix?: string;
	origin?: Origin;
}

export interface Piece {
	name: string;
	png: PNG;
	left: number;
	top: number;
	pixels: number;
	filled: number;
	color: string;
}

export interface Split {
	pieces: Piece[];
	width: number;
	height: number;
	background: string;
	unassigned: number;
	merged: number;
	/** Rim pixels made partly transparent to remove the background's halo. */
	softened: number;
	overlay: PNG;
}

const PALETTE: [string, [number, number, number]][] = [
	["red", [230, 40, 40]],
	["blue", [40, 90, 230]],
	["green", [30, 180, 60]],
	["orange", [245, 140, 20]],
	["purple", [150, 60, 210]],
	["cyan", [20, 190, 210]],
	["yellow", [230, 210, 20]],
	["pink", [240, 90, 170]],
	["brown", [140, 90, 40]],
	["lime", [150, 220, 40]],
	["navy", [20, 30, 120]],
	["teal", [20, 120, 110]],
];

export function readImage(path: string): PNG {
	let png: PNG;
	try {
		png = PNG.sync.read(readFileSync(path));
	} catch (e) {
		throw new UserError(`cannot read PNG ${path}: ${(e as Error).message}`);
	}
	if (png.width > MAX_SIDE || png.height > MAX_SIDE) throw new UserError(`image is ${png.width}x${png.height}; max ${MAX_SIDE}px per side`);
	return png;
}

function parseColor(s: string): [number, number, number] {
	const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
	if (!m) throw new UserError(`background "${s}" must be "auto", "transparent" or a color like #ffffff`);
	const n = Number.parseInt(m[1], 16);
	return [n >> 16, (n >> 8) & 255, n & 255];
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Marks foreground pixels (1) and names the background it found. */
export function foreground(
	png: PNG,
	background = "auto",
	tolerance = 24,
): { mask: Uint8Array; background: string; key?: [number, number, number] } {
	const { width: w, height: h, data } = png;
	const mask = new Uint8Array(w * h);
	const border: number[] = [];
	for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
	for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
	let mode = background.trim().toLowerCase();
	let key: [number, number, number] | undefined;
	if (mode === "auto") {
		const clear = border.filter((i) => data[i * 4 + 3] <= 8).length;
		if (clear * 2 >= border.length) mode = "transparent";
		else {
			// The most common border color (4 bits per channel), averaged over the pixels that share it.
			const buckets = new Map<number, number[]>();
			for (const i of border) {
				if (data[i * 4 + 3] <= 8) continue;
				const b = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
				const sum = buckets.get(b) ?? [0, 0, 0, 0];
				for (let c = 0; c < 3; c++) sum[c] += data[i * 4 + c];
				sum[3]++;
				buckets.set(b, sum);
			}
			const best = [...buckets.values()].sort((a, b) => b[3] - a[3])[0];
			key = [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
		}
	} else if (mode !== "transparent") key = parseColor(mode);

	if (!key) {
		for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 8 ? 1 : 0;
		return { mask, background: "transparent" };
	}
	// Background is what the key color floods to from the border; enclosed areas of the same color stay.
	mask.fill(1);
	const isBg = (i: number) =>
		data[i * 4 + 3] <= 8 ||
		(Math.abs(data[i * 4] - key[0]) <= tolerance &&
			Math.abs(data[i * 4 + 1] - key[1]) <= tolerance &&
			Math.abs(data[i * 4 + 2] - key[2]) <= tolerance);
	const queue: number[] = [];
	for (const i of border) if (mask[i] && isBg(i)) (mask[i] = 0), queue.push(i);
	for (let q = 0; q < queue.length; q++) {
		const i = queue[q];
		const x = i % w;
		for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
			if (n < 0 || n >= w * h || !mask[n] || !isBg(n)) continue;
			mask[n] = 0;
			queue.push(n);
		}
	}
	return { mask, background: hex(key), key };
}

/**
 * Removes the background's halo from the anti-aliased rim. A rim pixel is read as a blend of the background
 * and a nearby foreground color F: it gets the blend's alpha and the color F. F is the nearby pixel least like
 * the background that still explains the rim color within `tolerance`; pixels nothing explains, and pixels of a
 * flat area that just touches the background, stay as they are.
 */
export function matte(png: PNG, mask: Uint8Array, key: [number, number, number], width: number, tolerance: number): { png: PNG; softened: number } {
	const { width: w, height: h, data } = png;
	const out = new PNG({ width: w, height: h });
	data.copy(out.data);
	if (width <= 0) return { png: out, softened: 0 };
	// Rim: foreground pixels within `width` steps of the background.
	const depth = new Uint8Array(w * h);
	let ring: number[] = [];
	for (let i = 0; i < w * h; i++) if (!mask[i]) ring.push(i);
	for (let step = 1; step <= width && ring.length; step++) {
		const next: number[] = [];
		for (const i of ring) for (const n of neighbors(i, w, h)) if (mask[n] && !depth[n]) (depth[n] = step), next.push(n);
		ring = next;
	}
	const off = (i: number, c: number) => data[i * 4 + c] - key[c];
	const far = (i: number) => Math.hypot(off(i, 0), off(i, 1), off(i, 2));
	const limit = Math.max(12, tolerance);
	let softened = 0;
	for (let i = 0; i < w * h; i++) {
		if (!depth[i]) continue;
		const x = i % w;
		const y = (i - x) / w;
		// A rim blend is a thin ramp: the pixel next to it further in has a different color. One that matches is
		// part of a flat area of its own color that merely touches the background (skin next to a white page).
		const same = (j: number) => Math.hypot(data[i * 4] - data[j * 4], data[i * 4 + 1] - data[j * 4 + 1], data[i * 4 + 2] - data[j * 4 + 2]) <= limit / 2;
		if (neighbors(i, w, h).some((n) => mask[n] && (!depth[n] || depth[n] > depth[i]) && same(n))) continue;
		const own = far(i);
		let best = -1;
		let bestFar = own;
		let bestAlpha = 1;
		for (let dy = -width; dy <= width; dy++)
			for (let dx = -width; dx <= width; dx++) {
				if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
				const j = i + dy * w + dx;
				if (!mask[j] || data[j * 4 + 3] < 250) continue;
				const f = far(j);
				if (f <= bestFar || f < 2 * limit) continue;
				// Project the rim color onto the line from the background to F; the distance off that line is the error.
				const a = Math.min(1, Math.max(0, (off(i, 0) * off(j, 0) + off(i, 1) * off(j, 1) + off(i, 2) * off(j, 2)) / (f * f)));
				const miss = Math.hypot(off(i, 0) - a * off(j, 0), off(i, 1) - a * off(j, 1), off(i, 2) - a * off(j, 2));
				if (miss > limit) continue;
				best = j;
				bestFar = f;
				bestAlpha = a;
			}
		if (best < 0 || bestAlpha > 0.98) continue;
		for (let c = 0; c < 3; c++) out.data[i * 4 + c] = data[best * 4 + c];
		out.data[i * 4 + 3] = Math.round(data[i * 4 + 3] * bestAlpha);
		softened++;
	}
	return { png: out, softened };
}

function insidePolygon(poly: [number, number][], x: number, y: number): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** 8-neighbors of pixel i inside a w x h image. */
function neighbors(i: number, w: number, h: number): number[] {
	const x = i % w;
	const y = (i - x) / w;
	const out: number[] = [];
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++) {
			if ((dx || dy) && x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) out.push(i + dy * w + dx);
		}
	return out;
}

/** Assigns each foreground pixel to a part index; returns the part count and how many tiny blobs were merged. */
function components(mask: Uint8Array, w: number, h: number, minArea: number): { owner: Int32Array; count: number; merged: number } {
	const label = new Int32Array(w * h).fill(BG);
	const blobs: { pixels: number[]; cx: number; cy: number }[] = [];
	for (let s = 0; s < w * h; s++) {
		if (!mask[s] || label[s] !== BG) continue;
		const id = blobs.length;
		const pixels = [s];
		label[s] = id;
		for (let q = 0; q < pixels.length; q++)
			for (const n of neighbors(pixels[q], w, h)) if (mask[n] && label[n] === BG) (label[n] = id), pixels.push(n);
		let cx = 0;
		let cy = 0;
		for (const p of pixels) (cx += p % w), (cy += Math.floor(p / w));
		blobs.push({ pixels, cx: cx / pixels.length, cy: cy / pixels.length });
	}
	if (!blobs.length) throw new UserError("the image has no foreground pixels (is the background setting right?)");
	const big = blobs.filter((b) => b.pixels.length >= minArea).sort((a, b) => b.pixels.length - a.pixels.length);
	if (!big.length) big.push(blobs.sort((a, b) => b.pixels.length - a.pixels.length)[0]);
	if (big.length > MAX_AUTO_PARTS)
		throw new UserError(`found ${big.length} separate blobs; raise minArea or outline the parts with polygons`);
	const owner = new Int32Array(w * h).fill(BG);
	big.forEach((b, id) => b.pixels.forEach((p) => (owner[p] = id)));
	let merged = 0;
	for (const b of blobs) {
		if (big.includes(b)) continue;
		const near = big.reduce((best, c, id) => {
			const d = (c.cx - b.cx) ** 2 + (c.cy - b.cy) ** 2;
			return d < best.d ? { id, d } : best;
		}, { id: 0, d: Infinity });
		for (const p of b.pixels) owner[p] = near.id;
		merged++;
	}
	return { owner, count: big.length, merged };
}

/** Polygon mode: later parts own the pixels where outlines overlap; strays within `snap` join the nearest part. */
function outline(mask: Uint8Array, w: number, h: number, parts: SplitPart[], snap: number): { owner: Int32Array; unassigned: number } {
	const owner = new Int32Array(w * h);
	for (let i = 0; i < w * h; i++) owner[i] = mask[i] ? FREE : BG;
	parts.forEach((part, id) => {
		const xs = part.polygon.map((p) => p[0]);
		const ys = part.polygon.map((p) => p[1]);
		const x0 = Math.max(0, Math.floor(Math.min(...xs)));
		const x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
		const y0 = Math.max(0, Math.floor(Math.min(...ys)));
		const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const i = y * w + x;
				if (owner[i] !== BG && insidePolygon(part.polygon, x + 0.5, y + 0.5)) owner[i] = id;
			}
	});
	let ring: number[] = [];
	for (let i = 0; i < w * h; i++) if (owner[i] >= 0) ring.push(i);
	for (let step = 0; step < snap && ring.length; step++) {
		const next: number[] = [];
		for (const i of ring)
			for (const n of neighbors(i, w, h)) if (owner[n] === FREE) (owner[n] = owner[i]), next.push(n);
		ring = next;
	}
	let unassigned = 0;
	for (let i = 0; i < w * h; i++) if (owner[i] === FREE) unassigned++;
	return { owner, unassigned };
}

/**
 * Cuts part `id` out of the image, painting in up to `overlap` pixels of the parts drawn in front of it,
 * inside the part's own outline when it has one (the outline is also the shape of the hidden piece).
 */
function cut(png: PNG, owner: Int32Array, id: number, overlap: number, polygon?: [number, number][]): { png: PNG; left: number; top: number; pixels: number; filled: number } {
	const { width: w, height: h, data } = png;
	const rgba = new Float32Array(w * h * 4);
	const has = new Uint8Array(w * h);
	let ring: number[] = [];
	for (let i = 0; i < w * h; i++) {
		if (owner[i] !== id) continue;
		has[i] = 1;
		for (let c = 0; c < 4; c++) rgba[i * 4 + c] = data[i * 4 + c];
		ring.push(i);
	}
	const pixels = ring.length;
	let filled = 0;
	for (let step = 0; step < overlap && ring.length; step++) {
		const next = new Set<number>();
		for (const i of ring)
			for (const n of neighbors(i, w, h)) {
				if (has[n] || owner[n] <= id || next.has(n)) continue;
				if (!polygon || insidePolygon(polygon, (n % w) + 0.5, Math.floor(n / w) + 0.5)) next.add(n);
			}
		ring = [...next];
		// Each new pixel takes the alpha-weighted average color of the pixels already in the part around it.
		const values = ring.map((i) => {
			const sum = [0, 0, 0, 0];
			let weight = 0;
			for (const n of neighbors(i, w, h)) {
				if (!has[n]) continue;
				const a = rgba[n * 4 + 3];
				for (let c = 0; c < 3; c++) sum[c] += rgba[n * 4 + c] * a;
				sum[3] = Math.max(sum[3], a);
				weight += a;
			}
			return weight ? [sum[0] / weight, sum[1] / weight, sum[2] / weight, sum[3]] : [0, 0, 0, 0];
		});
		ring.forEach((i, k) => {
			has[i] = 1;
			for (let c = 0; c < 4; c++) rgba[i * 4 + c] = values[k][c];
		});
		filled += ring.length;
	}
	let [x0, y0, x1, y1] = [w, h, -1, -1];
	for (let i = 0; i < w * h; i++) {
		if (!has[i]) continue;
		const x = i % w;
		const y = (i - x) / w;
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
	}
	const out = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 });
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			const s = (y * w + x) * 4;
			const d = ((y - y0) * out.width + x - x0) * 4;
			for (let c = 0; c < 4; c++) out.data[d + c] = has[s / 4] ? Math.round(rgba[s + c]) : 0;
		}
	return { png: out, left: x0, top: y0, pixels, filled };
}

export function splitImage(source: PNG, spec: Omit<SplitSpec, "image" | "origin">): Split {
	const { width: w, height: h } = source;
	const tolerance = spec.tolerance ?? 24;
	const { mask, background, key } = foreground(source, spec.background, tolerance);
	const { png, softened } = key ? matte(source, mask, key, Math.round(spec.matte ?? 2), tolerance) : { png: source, softened: 0 };
	let owner: Int32Array;
	let names: string[];
	let unassigned = 0;
	let merged = 0;
	if (spec.parts?.length) {
		for (const p of spec.parts) if (p.polygon.length < 3) throw new UserError(`part "${p.name}" needs at least 3 polygon points`);
		({ owner, unassigned } = outline(mask, w, h, spec.parts, spec.snap ?? 4));
		names = spec.parts.map((p) => p.name);
	} else {
		const r = components(mask, w, h, spec.minArea ?? 64);
		owner = r.owner;
		merged = r.merged;
		names = Array.from({ length: r.count }, (_, i) => `${spec.prefix ?? "part"}-${i + 1}`);
	}
	if (new Set(names).size !== names.length) throw new UserError("part names must be unique");
	const pieces: Piece[] = [];
	names.forEach((name, id) => {
		if (!owner.includes(id)) throw new UserError(`part "${name}" covers no foreground pixels; check its polygon (image pixels, y down)`);
		const overlap = spec.parts?.[id].overlap ?? spec.overlap ?? 0;
		const c = cut(png, owner, id, Math.max(0, Math.round(overlap)), spec.parts?.[id].polygon);
		pieces.push({ name, ...c, color: PALETTE[id % PALETTE.length][0] });
	});
	return { pieces, width: w, height: h, background, unassigned, merged, softened, overlay: overlay(png, owner, spec.parts) };
}

/** The picture dimmed, each part tinted in its palette color, outlines drawn, unassigned pixels magenta. */
function overlay(png: PNG, owner: Int32Array, parts?: SplitPart[]): PNG {
	const { width: w, height: h, data } = png;
	const out = new PNG({ width: w, height: h });
	for (let i = 0; i < w * h; i++) {
		const a = data[i * 4 + 3] / 255;
		const o = owner[i];
		const tint = o >= 0 ? PALETTE[o % PALETTE.length][1] : o === FREE ? [255, 0, 255] : undefined;
		for (let c = 0; c < 3; c++) {
			const base = 255 * (1 - a) + data[i * 4 + c] * a;
			const gray = 0.5 * base + 0.5 * 200;
			out.data[i * 4 + c] = Math.round(tint ? 0.4 * gray + 0.6 * tint[c] : gray);
		}
		out.data[i * 4 + 3] = 255;
	}
	parts?.forEach((p, id) => {
		const color = PALETTE[id % PALETTE.length][1];
		for (let k = 0; k < p.polygon.length; k++) line(out, p.polygon[k], p.polygon[(k + 1) % p.polygon.length], color);
	});
	return out;
}

function line(png: PNG, [ax, ay]: [number, number], [bx, by]: [number, number], color: number[]): void {
	const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
	for (let s = 0; s <= steps; s++) {
		const x = Math.round(ax + ((bx - ax) * s) / steps);
		const y = Math.round(ay + ((by - ay) * s) / steps);
		if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
		const i = (y * png.width + x) * 4;
		for (let c = 0; c < 3; c++) png.data[i + c] = color[c];
	}
}

/** Shrinks an image so its longer side is at most `side` (nearest neighbor; returns the scale used). */
export function fit(png: PNG, side = VIEW_SIDE): { png: PNG; scale: number } {
	const scale = Math.min(1, side / Math.max(png.width, png.height));
	if (scale === 1) return { png, scale };
	const out = new PNG({ width: Math.max(1, Math.round(png.width * scale)), height: Math.max(1, Math.round(png.height * scale)) });
	for (let y = 0; y < out.height; y++)
		for (let x = 0; x < out.width; x++) {
			const s = (Math.min(png.height - 1, Math.floor(y / scale)) * png.width + Math.min(png.width - 1, Math.floor(x / scale))) * 4;
			png.data.copy(out.data, (y * out.width + x) * 4, s, s + 4);
		}
	return { png: out, scale };
}

export interface SplitImportResult {
	parts: { slot: string; width: number; height: number; x: number; y: number; pixels: number; filled: number; color: string }[];
	split: Split;
	canvas: string;
}

/** Splits the picture and, unless dryRun, imports the pieces back to front as parts (like psd_import). */
export function importSplit(ws: Workspace, spec: SplitSpec, dryRun = false): SplitImportResult {
	const png = readImage(spec.image);
	const split = splitImage(png, spec);
	const origin = spec.origin ?? "bottom-center";
	const ox = origin === "top-left" ? 0 : png.width / 2;
	const oy = origin === "bottom-center" ? png.height : origin === "center" ? png.height / 2 : 0;
	const used = new Set([...ws.imageNames(), ...ws.doc.slots.map((s) => s.name)]);
	const parts = split.pieces.map((p) => {
		checkName("slot", p.name);
		checkImagePath(p.name);
		if (used.has(p.name)) throw new UserError(`"${p.name}" already exists in the project; pick another name or prefix`);
		used.add(p.name);
		const x = p.left + p.png.width / 2 - ox;
		const y = oy - (p.top + p.png.height / 2);
		return { slot: p.name, width: p.png.width, height: p.png.height, x, y, pixels: p.pixels, filled: p.filled, color: p.color };
	});
	if (!dryRun)
		split.pieces.forEach((p, k) => {
			const file = ws.imagePath(p.name);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, PNG.sync.write(p.png));
			addPart(ws, { image: p.name, x: parts[k].x, y: parts[k].y });
		});
	return { parts, split, canvas: `${png.width}x${png.height}, origin ${origin}` };
}

// 3x5 digit glyphs, one row of 3 bits per entry, top to bottom.
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

function text(png: PNG, s: string, x: number, y: number, size: number): void {
	[...s].forEach((ch, k) => {
		const glyph = DIGITS[Number(ch)];
		if (!glyph) return;
		for (let r = 0; r < 5; r++)
			for (let c = 0; c < 3; c++) {
				if (glyph[r * 3 + c] !== "1") continue;
				for (let dy = 0; dy < size; dy++)
					for (let dx = 0; dx < size; dx++) {
						const px = x + (k * 4 + c) * size + dx;
						const py = y + r * size + dy;
						if (px >= 0 && py >= 0 && px < png.width && py < png.height) png.data.fill(0, (py * png.width + px) * 4, (py * png.width + px) * 4 + 3);
					}
			}
	});
}

/** The picture (scaled to fit) on white, with grid lines every `step` image pixels labeled in image pixels. */
export function gridImage(png: PNG, step?: number): { png: PNG; step: number; scale: number } {
	const { png: small, scale } = fit(png);
	const raw = Math.max(png.width, png.height) / 10;
	const nice = step ?? [10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s >= raw) ?? 1000;
	const size = 2;
	const left = 4 * size * String(Math.max(png.width, png.height)).length + 6;
	const top = 5 * size + 6;
	const out = new PNG({ width: small.width + left, height: small.height + top });
	out.data.fill(255);
	for (let y = 0; y < small.height; y++)
		for (let x = 0; x < small.width; x++) {
			const s = (y * small.width + x) * 4;
			const d = ((y + top) * out.width + x + left) * 4;
			// Checkerboard behind transparent pixels so they read as empty.
			const bg = ((x >> 3) + (y >> 3)) % 2 ? 235 : 255;
			const a = small.data[s + 3] / 255;
			for (let c = 0; c < 3; c++) out.data[d + c] = Math.round(bg * (1 - a) + small.data[s + c] * a);
		}
	for (let v = 0; v <= Math.max(png.width, png.height); v += nice) {
		const p = Math.round(v * scale);
		const mark = (x: number, y: number, k: number) => {
			const i = (y * out.width + x) * 4;
			const shade = k % 4 < 2 ? 0 : 255;
			out.data.fill(shade, i, i + 3);
		};
		if (v <= png.width) {
			for (let y = top; y < out.height; y++) if (left + p < out.width) mark(left + p, y, y);
			text(out, String(v), left + p - 2 * size * String(v).length, 2, size);
		}
		if (v <= png.height) {
			for (let x = left; x < out.width; x++) if (top + p < out.height) mark(x, top + p, x);
			text(out, String(v), 2, top + p - Math.floor((5 * size) / 2), size);
		}
	}
	return { png: out, step: nice, scale };
}

/** Facts that help outline parts: size, detected background, foreground box and the separate blobs. */
export function inspect(png: PNG, background?: string, tolerance?: number): string[] {
	const { mask, background: bg } = foreground(png, background, tolerance);
	const { width: w, height: h } = png;
	const lines = [`size ${w}x${h} (image pixels, x right, y down from top-left)`, `background ${bg}`];
	const label = new Int32Array(w * h).fill(-1);
	const boxes: { area: number; box: number[] }[] = [];
	for (let s = 0; s < w * h; s++) {
		if (!mask[s] || label[s] >= 0) continue;
		const stack = [s];
		label[s] = boxes.length;
		const box = [w, h, 0, 0];
		let area = 0;
		while (stack.length) {
			const i = stack.pop() as number;
			area++;
			const x = i % w;
			const y = (i - x) / w;
			box[0] = Math.min(box[0], x);
			box[1] = Math.min(box[1], y);
			box[2] = Math.max(box[2], x);
			box[3] = Math.max(box[3], y);
			for (const n of neighbors(i, w, h)) if (mask[n] && label[n] < 0) (label[n] = boxes.length), stack.push(n);
		}
		boxes.push({ area, box });
	}
	if (!boxes.length) return [...lines, "no foreground pixels"];
	const all = boxes.reduce((a, b) => [Math.min(a[0], b.box[0]), Math.min(a[1], b.box[1]), Math.max(a[2], b.box[2]), Math.max(a[3], b.box[3])], [w, h, 0, 0]);
	lines.push(`foreground box x ${all[0]}..${all[2]}, y ${all[1]}..${all[3]}`);
	const big = boxes.sort((a, b) => b.area - a.area);
	lines.push(`${boxes.length} separate blob(s)${boxes.length > 12 ? ", largest 12" : ""}:`);
	for (const b of big.slice(0, 12)) lines.push(`  ${b.area} px, x ${b.box[0]}..${b.box[2]}, y ${b.box[1]}..${b.box[3]}`);
	return lines;
}
