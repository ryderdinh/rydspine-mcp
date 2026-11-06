// The binary coin export must convert to JSON that plays exactly like the JSON export of the same project.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COIN } from "./coin.js";
import {
	AtlasAttachmentLoader,
	MixFrom,
	Physics,
	Skeleton,
	SkeletonBinary,
	type SkeletonData,
	SkeletonJson,
	TextureAtlas,
} from "@esotericsoftware/spine-core";
import { expect, it } from "vitest";
import { compareAnimation, compareStructure, PlaceholderLoader } from "../acceptance/compare.js";
import { skelToJson } from "../src/skel.js";
import { connect } from "./helpers.js";

const atlas = () => new TextureAtlas(readFileSync(join(COIN, "coin.atlas"), "utf8"));
const read = (json: unknown) => new SkeletonJson(new AtlasAttachmentLoader(atlas())).readSkeletonData(json as object);

function sample(data: SkeletonData, animation: string, t: number) {
	const s = new Skeleton(data);
	s.setupPose();
	data.findAnimation(animation)!.apply(s, t, t, false, null, 1, MixFrom.current, false, false, false);
	s.updateWorldTransform(Physics.none);
	return {
		bones: s.bones.map((b) => [b.appliedPose.worldX, b.appliedPose.worldY, b.appliedPose.a, b.appliedPose.d]),
		slots: s.drawOrder.appliedPose.map((sl) => [sl.data.name, sl.appliedPose.getAttachment()?.name ?? null, sl.appliedPose.color.a]),
	};
}

it("converts coin-pro.skel to JSON that matches the JSON export pose for pose", () => {
	const original = read(JSON.parse(readFileSync(join(COIN, "coin-pro.json"), "utf8")));
	const doc = skelToJson(readFileSync(join(COIN, "coin-pro.skel")));
	const converted = read(doc);
	expect(converted.bones.map((b) => b.name)).toEqual(original.bones.map((b) => b.name));
	expect(converted.slots.map((s) => s.name)).toEqual(original.slots.map((s) => s.name));
	expect(converted.animations[0].duration).toBeCloseTo(original.animations[0].duration, 4);
	let worst = 0;
	for (let i = 0; i <= 80; i++) {
		const t = (original.animations[0].duration * i) / 80;
		const a = sample(original, "animation", t);
		const b = sample(converted, "animation", t);
		expect(b.slots.map((s) => s.slice(0, 2))).toEqual(a.slots.map((s) => s.slice(0, 2)));
		a.bones.forEach((v, k) => v.forEach((x, j) => (worst = Math.max(worst, Math.abs(x - b.bones[k][j])))));
		a.slots.forEach((v, k) => (worst = Math.max(worst, Math.abs((v[2] as number) - (b.slots[k][2] as number)))));
	}
	expect(worst).toBeLessThan(0.01);
});

it("imports a .skel project through the MCP tool", async () => {
	const h = await connect();
	const r = await h.ok("project_import", { name: "coin-bin", skeleton: join(COIN, "coin-pro.skel"), atlas: join(COIN, "coin.atlas"), loops: ["animation"] });
	expect(r.text).toContain("converted from binary");
	expect((await h.ok("validate", { project: "coin-bin" })).text).toMatch(/animation: 2\.667s, loop seam 0\.000px/);
});

// features.skel and features.json were written by Spine 4.3.26 (acceptance/skel-fixture.ts): transform, path and
// slider constraints, image sequences on regions and meshes, a linked mesh in another slot, and their timelines.
const FEATURES = resolve("test/fixtures/features");

it("converts transform, path and slider constraints and image sequences exactly", () => {
	const bytes = readFileSync(join(FEATURES, "features.skel"));
	const doc = skelToJson(bytes) as unknown as Record<string, any>;
	expect(doc.constraints.map((c: { type: string }) => c.type)).toEqual(["transform", "transform", "path", "slider", "slider"]);
	expect(doc.skins[0].attachments.lamp.lamp.sequence).toEqual({ count: 4, digits: 2, setup: 1 });
	expect(doc.skins[0].attachments["flame-copy"].flame).toMatchObject({ type: "linkedmesh", slot: "flame", source: "flame" });
	const move = doc.animations.move;
	expect(Object.keys(move)).toEqual(expect.arrayContaining(["transform", "path", "slider", "attachments"]));

	const binary = new SkeletonBinary(new PlaceholderLoader()).readSkeletonData(new Uint8Array(bytes));
	const converted = new SkeletonJson(new PlaceholderLoader()).readSkeletonData(JSON.parse(JSON.stringify(doc)));
	const exported = new SkeletonJson(new PlaceholderLoader()).readSkeletonData(JSON.parse(readFileSync(join(FEATURES, "features.json"), "utf8")));
	expect(compareStructure(binary, converted)).toEqual([]);
	for (const a of binary.animations) {
		// Every key value must survive as the same float32: the JSON numbers are the shortest that round-trip.
		const frames = (anim: typeof a) => anim.timelines.map((t) => [t.constructor.name, Array.from(t.frames, Math.fround)]);
		expect(frames(converted.findAnimation(a.name)!), a.name).toEqual(frames(a));
		// Samples sit between frames: the JS runtime keeps JSON numbers as doubles but .skel values as float32,
		// so a sample exactly on a key or sequence step can fall on either side of it.
		for (const other of [converted, exported]) {
			const c = compareAnimation("features", binary, other, a.name, 0.001, 0.5);
			expect(c.problems, `${a.name}: ${c.where}`).toEqual([]);
		}
	}
});
