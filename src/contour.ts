// Builds a mesh that follows an image's opaque outline: trace the alpha mask, simplify the outline,
// sprinkle interior points, then run a constrained Delaunay triangulation inside the outline.
import ConstrainautorImport from "@kninnug/constrainautor";
import Delaunator from "delaunator";
import type { PNG } from "pngjs";
import { UserError } from "./workspace.js";

export interface ContourOptions {
	/** Max distance (px) the simplified outline may stray from the traced one. */
	detail?: number;
	/** Interior vertex spacing (px). */
	spacing?: number;
	/** Grow the outline by this many px so soft edges stay inside the mesh. */
	padding?: number;
	alphaThreshold?: number;
}

export interface ContourMesh {
	/** Vertex positions in image pixels (y down), hull first. */
	points: [number, number][];
	hull: number;
	triangles: number[];
	warnings: string[];
}

type Pt = [number, number];

// The package's types resolve as CommonJS under NodeNext while Node loads its ES module; accept both shapes.
type ConstrainautorCtor = new (del: Delaunator<ArrayLike<number>>) => { constrainAll(edges: [number, number][]): void };
const Constrainautor = ((ConstrainautorImport as unknown as { default?: ConstrainautorCtor }).default ??
	ConstrainautorImport) as unknown as ConstrainautorCtor;

export function contourMesh(png: PNG, opts: ContourOptions = {}): ContourMesh {
	const { width: w, height: h } = png;
	const size = Math.max(w, h);
	const detail = opts.detail ?? Math.max(1, size / 40);
	const spacing = opts.spacing ?? Math.max(4, size / 6);
	const padding = Math.round(opts.padding ?? 2);
	const threshold = opts.alphaThreshold ?? 8;
	const warnings: string[] = [];

	let mask: Uint8Array = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) mask[i] = png.data[i * 4 + 3] > threshold ? 1 : 0;
	for (let p = 0; p < padding; p++) mask = dilate(mask, w, h);

	const { labels, largest, sizes } = components(mask, w, h);
	if (largest < 0) throw new UserError("image is fully transparent");
	const total = sizes.reduce((a, b) => a + b, 0);
	if (sizes[largest] < total * 0.95)
		warnings.push("image has separate opaque pieces; only the largest is meshed (use the grid shape to cover all)");

	const traced = trace(labels, largest, w, h);
	let outline = simplifyClosed(traced, detail);
	if (outline.length < 3) throw new UserError("outline too small to mesh");
	if (signedArea(outline) > 0) outline = outline.reverse();
	outline = outline.map(([x, y]) => [clamp(x, 0, w), clamp(y, 0, h)] as Pt);

	const interior: Pt[] = [];
	for (let y = spacing / 2; y < h; y += spacing) {
		for (let x = spacing / 2; x < w; x += spacing) {
			if (inside([x, y], outline) && distanceToOutline([x, y], outline) > spacing * 0.4) interior.push([x, y]);
		}
	}

	const points = [...outline, ...interior];
	const del = new Delaunator(points.flat());
	const edges = outline.map((_, i) => [i, (i + 1) % outline.length] as [number, number]);
	try {
		new Constrainautor(del).constrainAll(edges);
	} catch (e) {
		throw new UserError(`could not triangulate the outline (${(e as Error).message}); try a larger detail value`);
	}
	const triangles: number[] = [];
	for (let t = 0; t < del.triangles.length; t += 3) {
		const [a, b, c] = [del.triangles[t], del.triangles[t + 1], del.triangles[t + 2]];
		const cx = (points[a][0] + points[b][0] + points[c][0]) / 3;
		const cy = (points[a][1] + points[b][1] + points[c][1]) / 3;
		if (inside([cx, cy], outline)) triangles.push(a, b, c);
	}
	return { points, hull: outline.length, triangles, warnings };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
	const out: Uint8Array = new Uint8Array(mask);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (mask[y * w + x]) continue;
			if ((x > 0 && mask[y * w + x - 1]) || (x < w - 1 && mask[y * w + x + 1]) || (y > 0 && mask[(y - 1) * w + x]) || (y < h - 1 && mask[(y + 1) * w + x]))
				out[y * w + x] = 1;
		}
	}
	return out;
}

function components(mask: Uint8Array, w: number, h: number) {
	const labels = new Int32Array(w * h).fill(-1);
	const sizes: number[] = [];
	const stack: number[] = [];
	for (let start = 0; start < w * h; start++) {
		if (!mask[start] || labels[start] >= 0) continue;
		const id = sizes.length;
		let size = 0;
		labels[start] = id;
		stack.push(start);
		while (stack.length) {
			const i = stack.pop()!;
			size++;
			const x = i % w;
			const y = (i - x) / w;
			for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
				if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
				const n = ny * w + nx;
				if (mask[n] && labels[n] < 0) {
					labels[n] = id;
					stack.push(n);
				}
			}
		}
		sizes.push(size);
	}
	let largest = -1;
	sizes.forEach((s, i) => {
		if (largest < 0 || s > sizes[largest]) largest = i;
	});
	return { labels, largest, sizes };
}

/** Walks the outer boundary of one component along pixel edges (corners in image coordinates). */
function trace(labels: Int32Array, id: number, w: number, h: number): Pt[] {
	const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
	let start = 0;
	while (labels[start] !== id) start++;
	const sx = start % w;
	const sy = (start - sx) / w;
	// Edge-following with the filled pixel on the right; directions: 0 right, 1 down, 2 left, 3 up.
	const dx = [1, 0, -1, 0];
	const dy = [0, 1, 0, -1];
	let x = sx;
	let y = sy;
	let dir = 0;
	const out: Pt[] = [];
	const limit = 4 * (w + 1) * (h + 1);
	for (let steps = 0; steps < limit; steps++) {
		out.push([x, y]);
		// Pixels ahead-left and ahead-right of the current corner, relative to dir.
		const right = pixelRight(x, y, dir);
		const left = pixelLeft(x, y, dir);
		if (on(left[0], left[1])) dir = (dir + 3) % 4;
		else if (!on(right[0], right[1])) dir = (dir + 1) % 4;
		x += dx[dir];
		y += dy[dir];
		if (x === sx && y === sy) return out;
	}
	throw new UserError("outline tracing did not close");
}

// For a corner (x, y) moving in dir, the pixel ahead on the right / left of the edge.
function pixelRight(x: number, y: number, dir: number): Pt {
	return [
		[x, y],
		[x - 1, y],
		[x - 1, y - 1],
		[x, y - 1],
	][dir] as Pt;
}
function pixelLeft(x: number, y: number, dir: number): Pt {
	return [
		[x, y - 1],
		[x, y],
		[x - 1, y],
		[x - 1, y - 1],
	][dir] as Pt;
}

function simplifyClosed(pts: Pt[], tolerance: number): Pt[] {
	// Split at the two mutually farthest-ish points so each half is an open polyline.
	let far = 0;
	let best = -1;
	for (let i = 0; i < pts.length; i++) {
		const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
		if (d > best) {
			best = d;
			far = i;
		}
	}
	const a = douglasPeucker(pts.slice(0, far + 1), tolerance);
	const b = douglasPeucker([...pts.slice(far), pts[0]], tolerance);
	return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function douglasPeucker(pts: Pt[], tolerance: number): Pt[] {
	if (pts.length < 3) return pts;
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [s, e] = stack.pop()!;
		let index = -1;
		let max = tolerance;
		for (let i = s + 1; i < e; i++) {
			const d = segmentDistance(pts[i], pts[s], pts[e]);
			if (d > max) {
				max = d;
				index = i;
			}
		}
		if (index >= 0) {
			keep[index] = 1;
			stack.push([s, index], [index, e]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
	return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function distanceToOutline(p: Pt, poly: Pt[]): number {
	let d = Infinity;
	for (let i = 0; i < poly.length; i++) d = Math.min(d, segmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
	return d;
}

function inside(p: Pt, poly: Pt[]): boolean {
	let c = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
	}
	return c;
}

function signedArea(poly: Pt[]): number {
	let a = 0;
	for (let i = 0; i < poly.length; i++) {
		const [x1, y1] = poly[i];
		const [x2, y2] = poly[(i + 1) % poly.length];
		a += x1 * y2 - x2 * y1;
	}
	return a / 2;
}
