// Packs workspace images into a single atlas page (shelf packing) in Spine's atlas text format.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const PAD = 2;
const MAX_WIDTH = 2048;

export interface PackedRegion {
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Packed {
	pageName: string;
	width: number;
	height: number;
	regions: PackedRegion[];
	text: string;
}

export function readPng(path: string): PNG {
	return PNG.sync.read(readFileSync(path));
}

export function imageSize(path: string): { width: number; height: number } {
	const png = readPng(path);
	return { width: png.width, height: png.height };
}

export function pack(imagesDir: string, names: string[], pageName: string): Packed {
	const sized = names
		.map((name) => ({ name, ...imageSize(join(imagesDir, `${name}.png`)) }))
		.sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
	const widest = Math.max(0, ...sized.map((s) => s.width));
	const total = sized.reduce((sum, s) => sum + (s.width + PAD) * (s.height + PAD), 0);
	const rowWidth = Math.min(MAX_WIDTH, Math.max(widest + 2 * PAD, Math.ceil(Math.sqrt(total) * 1.2)));

	const regions: PackedRegion[] = [];
	let x = PAD;
	let y = PAD;
	let shelf = 0;
	let width = 0;
	for (const s of sized) {
		if (x + s.width + PAD > rowWidth && x > PAD) {
			x = PAD;
			y += shelf + PAD;
			shelf = 0;
		}
		regions.push({ name: s.name, x, y, width: s.width, height: s.height });
		x += s.width + PAD;
		width = Math.max(width, x);
		shelf = Math.max(shelf, s.height);
	}
	const height = y + shelf + PAD;
	width = Math.max(width, 1);

	const lines = [pageName, `size:${width},${height}`, "filter:Linear,Linear"];
	for (const r of [...regions].sort((a, b) => a.name.localeCompare(b.name)))
		lines.push(r.name, `bounds:${r.x},${r.y},${r.width},${r.height}`);
	return { pageName, width, height, regions, text: `${lines.join("\n")}\n` };
}

export function composePage(imagesDir: string, packed: Packed): Buffer {
	const page = new PNG({ width: packed.width, height: packed.height });
	for (const r of packed.regions) {
		const src = readPng(join(imagesDir, `${r.name}.png`));
		PNG.bitblt(src, page, 0, 0, r.width, r.height, r.x, r.y);
	}
	return PNG.sync.write(page);
}
