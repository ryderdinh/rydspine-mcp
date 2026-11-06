import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COIN } from "./coin.js";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { contourMesh } from "../src/contour.js";

const image = (name: string) => PNG.sync.read(readFileSync(join(COIN, "images", `${name}.png`)));

function pointInTriangles(x: number, y: number, pts: [number, number][], tris: number[]): boolean {
	for (let t = 0; t < tris.length; t += 3) {
		const [a, b, c] = [pts[tris[t]], pts[tris[t + 1]], pts[tris[t + 2]]];
		const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
		const d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]);
		const d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
		const neg = d1 < 0 || d2 < 0 || d3 < 0;
		const pos = d1 > 0 || d2 > 0 || d3 > 0;
		if (!(neg && pos)) return true;
	}
	return false;
}

function triangleArea(pts: [number, number][], tris: number[]): number {
	let area = 0;
	for (let t = 0; t < tris.length; t += 3) {
		const [a, b, c] = [pts[tris[t]], pts[tris[t + 1]], pts[tris[t + 2]]];
		area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
	}
	return area;
}

describe("contour mesh", () => {
	for (const name of ["coin-side-round", "coin-front-logo", "shine"]) {
		it(`covers the opaque pixels of ${name} tightly`, () => {
			const png = image(name);
			const m = contourMesh(png);
			let opaque = 0;
			let covered = 0;
			for (let y = 0; y < png.height; y++) {
				for (let x = 0; x < png.width; x++) {
					if (png.data[(y * png.width + x) * 4 + 3] <= 8) continue;
					opaque++;
					if (pointInTriangles(x + 0.5, y + 0.5, m.points, m.triangles)) covered++;
				}
			}
			expect(covered / opaque).toBeGreaterThan(0.995);
			// Tighter than the bounding rectangle, and not much bigger than the art itself.
			const area = triangleArea(m.points, m.triangles);
			expect(area).toBeLessThan(opaque * 1.35);
			expect(m.hull).toBeGreaterThanOrEqual(3);
			for (const [x, y] of m.points) {
				expect(x).toBeGreaterThanOrEqual(0);
				expect(y).toBeGreaterThanOrEqual(0);
				expect(x).toBeLessThanOrEqual(png.width);
				expect(y).toBeLessThanOrEqual(png.height);
			}
		});
	}

	it("warns when the image has separate pieces", () => {
		const png = new PNG({ width: 40, height: 20 });
		for (let y = 2; y < 18; y++) {
			for (const x0 of [2, 24]) for (let x = x0; x < x0 + 14; x++) png.data[(y * 40 + x) * 4 + 3] = 255;
		}
		expect(contourMesh(png).warnings[0]).toMatch(/separate opaque pieces/);
	});
});
