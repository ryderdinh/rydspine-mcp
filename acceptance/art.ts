// Tiny procedural painter for acceptance art: filled shapes with a darker outline and soft shading,
// anti-aliased by 4x4 supersampling. Stand-in art until real assets are available.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

export type RGB = [number, number, number];
type Inside = (x: number, y: number) => boolean;

export interface ShapeOptions {
	outline?: number;
	/** 0..1: how much darker the bottom edge is than the top. */
	shade?: number;
}

function paint(width: number, height: number, inside: Inside, color: RGB, opts: ShapeOptions = {}): PNG {
	const outline = opts.outline ?? 2;
	const shade = opts.shade ?? 0.25;
	const png = new PNG({ width, height });
	const S = 4;
	const near = (x: number, y: number) => {
		for (const [dx, dy] of [[outline, 0], [-outline, 0], [0, outline], [0, -outline]])
			if (!inside(x + dx, y + dy)) return true;
		return false;
	};
	for (let py = 0; py < height; py++) {
		for (let px = 0; px < width; px++) {
			let cover = 0;
			let edge = 0;
			for (let sy = 0; sy < S; sy++) {
				for (let sx = 0; sx < S; sx++) {
					const x = px + (sx + 0.5) / S;
					const y = py + (sy + 0.5) / S;
					if (!inside(x, y)) continue;
					cover++;
					if (outline > 0 && near(x, y)) edge++;
				}
			}
			const i = (py * width + px) * 4;
			if (!cover) continue;
			const k = 1 - shade * (py / height);
			const e = edge / cover;
			for (let c = 0; c < 3; c++) png.data[i + c] = Math.round(color[c] * k * (1 - e) + color[c] * 0.35 * e);
			png.data[i + 3] = Math.round((255 * cover) / (S * S));
		}
	}
	return png;
}

export class Painter {
	constructor(readonly dir: string) {
		mkdirSync(dir, { recursive: true });
	}

	private save(name: string, png: PNG): string {
		const file = join(this.dir, `${name}.png`);
		writeFileSync(file, PNG.sync.write(png));
		return file;
	}

	rect(name: string, w: number, h: number, color: RGB, radius = 0, opts?: ShapeOptions): string {
		const r = Math.min(radius, w / 2, h / 2);
		return this.save(
			name,
			paint(
				w,
				h,
				(x, y) => {
					if (x < 0 || y < 0 || x > w || y > h) return false;
					const cx = Math.max(r, Math.min(w - r, x));
					const cy = Math.max(r, Math.min(h - r, y));
					return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
				},
				color,
				opts,
			),
		);
	}

	ellipse(name: string, w: number, h: number, color: RGB, opts?: ShapeOptions): string {
		return this.save(name, paint(w, h, (x, y) => ((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2 <= 1, color, opts));
	}

	/** Polygon in image pixels (y down). */
	polygon(name: string, w: number, h: number, points: [number, number][], color: RGB, opts?: ShapeOptions): string {
		const inside: Inside = (x, y) => {
			let c = false;
			for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
				const [xi, yi] = points[i];
				const [xj, yj] = points[j];
				if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
			}
			return c;
		};
		return this.save(name, paint(w, h, inside, color, opts));
	}

	/** Regular star / badge outline. */
	star(name: string, size: number, points: number, inner: number, color: RGB, opts?: ShapeOptions): string {
		const pts: [number, number][] = [];
		for (let i = 0; i < points * 2; i++) {
			const r = ((i % 2 ? inner : 1) * size) / 2 - 1;
			const a = (Math.PI * i) / points - Math.PI / 2;
			pts.push([size / 2 + r * Math.cos(a), size / 2 + r * Math.sin(a)]);
		}
		return this.polygon(name, size, size, pts, color, opts);
	}
}
