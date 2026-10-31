import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { foreground, splitImage } from "../src/split.js";
import { connect } from "./helpers.js";

type Rgba = [number, number, number, number];

/** A flat picture: background, then rectangles painted in order (later ones on top). */
function picture(width: number, height: number, bg: Rgba, rects: [number, number, number, number, Rgba][]): PNG {
	const png = new PNG({ width, height });
	for (let i = 0; i < width * height; i++) png.data.set(bg, i * 4);
	for (const [x0, y0, x1, y1, c] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) png.data.set(c, (y * width + x) * 4);
	return png;
}

const RED: Rgba = [220, 30, 30, 255];
const BLUE: Rgba = [30, 60, 220, 255];
const WHITE: Rgba = [255, 255, 255, 255];
const CLEAR: Rgba = [0, 0, 0, 0];
const pixel = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];

describe("image split", () => {
	it("finds a plain white background and keeps enclosed white areas", () => {
		const png = picture(60, 60, WHITE, [
			[10, 10, 50, 50, RED],
			[20, 20, 30, 30, WHITE],
		]);
		const { mask, background } = foreground(png);
		expect(background).toBe("#ffffff");
		expect(mask[0]).toBe(0);
		expect(mask[25 * 60 + 25]).toBe(1);
		expect(mask[15 * 60 + 15]).toBe(1);
	});

	it("splits separate blobs largest first and joins specks to the nearest blob", () => {
		const png = picture(100, 50, CLEAR, [
			[5, 5, 45, 45, RED],
			[60, 10, 80, 30, BLUE],
			[83, 12, 85, 14, BLUE],
		]);
		const s = splitImage(png, {});
		expect(s.pieces.map((p) => [p.name, p.png.width, p.png.height])).toEqual([
			["part-1", 40, 40],
			["part-2", 25, 20],
		]);
		expect(s.merged).toBe(1);
	});

	it("gives overlapping pixels to the part in front and paints in the hidden area behind it", () => {
		// Body (red) behind, arm (blue) painted over its right edge.
		const png = picture(100, 80, WHITE, [
			[10, 10, 60, 70, RED],
			[50, 30, 90, 40, BLUE],
		]);
		const parts = [
			{ name: "body", polygon: [[10, 10], [60, 10], [60, 70], [10, 70]] as [number, number][], overlap: 6 },
			{ name: "arm", polygon: [[50, 30], [90, 30], [90, 40], [50, 40]] as [number, number][] },
		];
		const s = splitImage(png, { parts });
		const [body, arm] = s.pieces;
		expect(s.unassigned).toBe(0);
		// The arm is a clean 40x10 bar; the body keeps its 50x60 box and the hole under the arm is filled in red.
		expect([arm.png.width, arm.png.height, arm.left, arm.top]).toEqual([40, 10, 50, 30]);
		expect([body.png.width, body.png.height, body.left, body.top]).toEqual([50, 60, 10, 10]);
		expect(body.filled).toBe(100);
		expect(pixel(body.png, 45, 25)).toEqual(RED);
		expect(pixel(body.png, 40, 25)).toEqual(RED);
		// Without overlap the covered pixels stay empty.
		const bare = splitImage(png, { parts: parts.map((p) => ({ ...p, overlap: 0 })) }).pieces[0];
		expect(pixel(bare.png, 45, 25)[3]).toBe(0);
	});

	it("snaps stray pixels to a nearby outline and reports the rest", () => {
		const png = picture(60, 60, CLEAR, [[10, 10, 40, 40, RED]]);
		const s = splitImage(png, { parts: [{ name: "a", polygon: [[12, 12], [38, 12], [38, 38], [12, 38]] }], snap: 1 });
		expect(s.unassigned).toBeGreaterThan(0);
		expect(splitImage(png, { parts: [{ name: "a", polygon: [[12, 12], [38, 12], [38, 38], [12, 38]] }] }).unassigned).toBe(0);
	});

	it("imports the parts through the tools at their place in the picture", async () => {
		const dir = mkdtempSync(join(tmpdir(), "split-"));
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "flat.png");
		writeFileSync(
			file,
			PNG.sync.write(
				picture(100, 80, WHITE, [
					[10, 10, 60, 70, RED],
					[50, 30, 90, 40, BLUE],
				]),
			),
		);
		const { ok, call, root } = await connect();
		const view = await ok("image_inspect", { image: file });
		expect(view.text).toContain("size 100x80");
		expect(view.text).toContain("background #ffffff");
		expect(view.content.some((c) => c.type === "image")).toBe(true);

		await ok("project_create", { name: "flat" });
		const parts = [
			{ name: "body", polygon: [[10, 10], [60, 10], [60, 70], [10, 70]], overlap: 6 },
			{ name: "arm", polygon: [[50, 30], [90, 30], [90, 40], [50, 40]] },
		];
		const dry = await ok("image_split", { project: "flat", image: file, parts, dryRun: true });
		expect(dry.text).toContain("dry run");
		expect((await ok("project_status", { project: "flat" })).text).not.toContain("arm");

		const r = await ok("image_split", { project: "flat", image: file, parts });
		expect(r.text).toContain("body [red]: 50x60 at (-15, 40)");
		expect(r.text).toContain("arm [blue]: 40x10 at (20, 45)");
		expect(r.text).toContain("saved as version");
		const status = (await ok("project_status", { project: "flat" })).text;
		expect(status.indexOf("body")).toBeLessThan(status.indexOf("arm"));
		const saved = PNG.sync.read(readFileSync(join(root, "flat", "images", "body.png")));
		expect(pixel(saved, 45, 25)).toEqual(RED);

		const again = await call("image_split", { project: "flat", image: file, parts });
		expect(again.isError).toBe(true);
		expect(again.text).toContain("already exists");
	});
});
