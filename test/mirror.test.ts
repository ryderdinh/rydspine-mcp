// Mirroring a rig side and animations between sides, checked with the Spine runtime.
import { join } from "node:path";
import { type Attachment, type Skeleton, Physics, RegionAttachment, VertexAttachment } from "@esotericsoftware/spine-core";
import { expect, it } from "vitest";
import { otherSide } from "../src/mirror.js";
import { boneByName, load, poseAt } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

function world(skeleton: Skeleton, slotName: string): number[] {
	const slot = skeleton.findSlot(slotName)!;
	const att = slot.appliedPose.getAttachment() as Attachment;
	if (att instanceof RegionAttachment) {
		const v = new Array<number>(8);
		att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
		return v;
	}
	const mesh = att as VertexAttachment;
	const v = new Array<number>(mesh.worldVerticesLength);
	mesh.computeWorldVertices(skeleton, slot, 0, mesh.worldVerticesLength, v, 0, 2);
	return v;
}

const pairs = (v: number[]) => Array.from({ length: v.length / 2 }, (_, i) => [v[2 * i], v[2 * i + 1]]);
const near = (a: number[][], b: number[][]) => a.every(([x, y], i) => Math.abs(x - b[i][0]) < 0.05 && Math.abs(y - b[i][1]) < 0.05);

it("names the other side", () => {
	expect(otherSide("left-arm")).toBe("right-arm");
	expect(otherSide("armL")).toBe("armR");
	expect(otherSide("eye_l")).toBe("eye_r");
	expect(otherSide("LeftHand")).toBe("RightHand");
	expect(otherSide("LEFT_FOOT")).toBe("RIGHT_FOOT");
	expect(otherSide("R-leg")).toBe("L-leg");
	expect(otherSide("hilt")).toBe("hilt");
	expect(otherSide("front-leg", ["front", "back"])).toBe("back-leg");
});

async function frontArm() {
	const h = await connect();
	await h.ok("project_create", { name: "front" });
	await h.ok("bone_add", {
		project: "front",
		bones: [
			{ name: "chest", x: 0, y: 100, rotation: 90, length: 60, space: "world" },
			{ name: "left-upper", parent: "chest", x: 40, y: 100, rotation: -30, length: 50, space: "world" },
			{ name: "left-lower", parent: "left-upper", x: 83.3, y: 75, rotation: -60, length: 40, space: "world" },
			{ name: "left-target", x: 110, y: 40, space: "world" },
		],
	});
	const dir = join(h.root, "src");
	await h.ok("image_import", {
		project: "front",
		images: [
			{ path: shape(dir, "body", 60, 90, [90, 90, 200]), x: 0, y: 120 },
			{ path: shape(dir, "left-arm", 48, 12, [200, 120, 60]), x: 62, y: 88 },
			{ path: shape(dir, "left-hand", 20, 20, [220, 160, 120], true), x: 100, y: 52 },
		],
	});
	await h.ok("slot_update", { project: "front", name: "body", bone: "chest", keepWorld: true });
	await h.ok("slot_update", { project: "front", name: "left-arm", bone: "left-upper", keepWorld: true });
	await h.ok("slot_update", { project: "front", name: "left-hand", bone: "left-lower", keepWorld: true });
	await h.ok("mesh_generate", { project: "front", slot: "left-hand", bones: ["left-upper", "left-lower"] });
	await h.ok("constraint_add", { project: "front", constraint: { type: "ik", name: "left-ik", bones: ["left-upper", "left-lower"], target: "left-target" } });
	return h;
}

it("copies a side of the rig across the mirror line", async () => {
	const h = await frontArm();
	const bad = await h.call("mirror_bones", { project: "front", bones: ["chest"] });
	expect(bad.text).toMatch(/no side in its name/);
	const r = await h.ok("mirror_bones", { project: "front", bones: ["left-upper", "left-target"] });
	expect(r.text).toMatch(/bones: right-upper, right-lower, right-target/);
	expect(r.text).toMatch(/constraints: right-ik/);

	const ws = Workspace.open("front");
	expect(ws.doc.slots.map((s) => s.name)).toEqual(["body", "left-arm", "right-arm", "left-hand", "right-hand"]);
	const ik = ws.doc.constraints.find((c) => c.name === "right-ik")!;
	expect(ik).toMatchObject({ bones: ["right-upper", "right-lower"], target: "right-target", bendPositive: false });
	expect(ws.doc.skins[0].attachments["right-arm"]["right-arm"]).toMatchObject({ path: "left-arm", scaleY: -1 });
	expect((await h.ok("validate", { project: "front" })).text).not.toMatch(/error/i);

	const { skeleton } = load(ws);
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	for (const n of ["upper", "lower", "target"]) {
		const l = boneByName(skeleton, `left-${n}`).appliedPose;
		const rt = boneByName(skeleton, `right-${n}`).appliedPose;
		expect(rt.worldX).toBeCloseTo(-l.worldX, 1);
		expect(rt.worldY).toBeCloseTo(l.worldY, 1);
	}
	// The arm region is the same rectangle reflected; the weighted hand mesh is reflected vertex by vertex.
	const sorted = (v: number[][]) => [...v].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const arm = pairs(world(skeleton, "left-arm")).map(([x, y]) => [-x, y]);
	expect(near(sorted(pairs(world(skeleton, "right-arm"))), sorted(arm))).toBe(true);
	const hand = pairs(world(skeleton, "left-hand")).map(([x, y]) => [-x, y]);
	expect(near(pairs(world(skeleton, "right-hand")), hand)).toBe(true);
});

it("mirrors an animation so the other side moves as the reflection", async () => {
	const h = await frontArm();
	await h.ok("mirror_bones", { project: "front", bones: ["left-upper", "left-target"] });
	await h.ok("anim_create", { project: "front", name: "wave", loop: true });
	const keys = (bone: string, property: string, values: number[]) =>
		h.ok("anim_set_keys", { project: "front", animation: "wave", bone, property, keys: values.map((value, i) => ({ time: i / 2, value, ease: "ease-in-out" })) });
	await keys("left-target", "translatey", [0, 30, 0]);
	await keys("left-target", "translatex", [0, -15, 0]);
	await keys("chest", "translatex", [0, 10, 0]);
	await keys("chest", "rotate", [0, 8, 0]);
	await h.ok("anim_slot_keys", { project: "front", animation: "wave", slot: "left-hand", property: "alpha", keys: [{ time: 0, value: 1 }, { time: 1, value: 0.5 }] });
	await h.ok("anim_constraint_keys", { project: "front", animation: "wave", constraint: "left-ik", property: "mix", keys: [{ time: 0, mix: 1 }] });

	const r = await h.ok("mirror_animation", { project: "front", animation: "wave", mode: "mirror" });
	expect(r.text).toMatch(/mirrored wave into wave-mirrored/);
	const ws = Workspace.open("front");
	const out = ws.doc.animations["wave-mirrored"];
	expect(Object.keys(out.slots!)).toEqual(["right-hand"]);
	expect((out.ik as Record<string, { bendPositive: boolean }[]>)["right-ik"][0].bendPositive).toBe(false);
	expect(ws.meta.loops["wave-mirrored"]).toBe(true);

	const src = load(ws);
	const dst = load(ws);
	for (const t of [0.2, 0.5, 0.8]) {
		poseAt(src, "wave", t);
		poseAt(dst, "wave-mirrored", t);
		for (const bone of src.skeleton.bones) {
			const name = otherSide(bone.data.name);
			const a = bone.appliedPose;
			const b = boneByName(dst.skeleton, name).appliedPose;
			expect([b.worldX, b.worldY].map((v) => Math.round(v * 10) / 10)).toEqual([-a.worldX, a.worldY].map((v) => Math.round(v * 10) / 10 || 0));
		}
		expect(near(pairs(world(dst.skeleton, "right-hand")), pairs(world(src.skeleton, "left-hand")).map(([x, y]) => [-x, y]))).toBe(true);
	}
});

it("swaps left and right timelines, draw order and events as they are", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "side" });
	await h.ok("bone_add", {
		project: "side",
		bones: [
			{ name: "hip", x: 0, y: 100, space: "world" },
			{ name: "leg-l", parent: "hip", x: 0, y: 100, rotation: -90, length: 90, space: "world" },
			{ name: "leg-r", parent: "hip", x: 0, y: 100, rotation: -90, length: 90, space: "world" },
		],
	});
	const dir = join(h.root, "src");
	await h.ok("image_import", { project: "side", images: ["leg-l", "body", "leg-r"].map((n, i) => ({ path: shape(dir, n, 12, 90, [i * 80, 60, 60]), x: 0, y: 55 })) });
	await h.ok("anim_create", { project: "side", name: "walk", loop: true });
	await h.ok("anim_set_keys", { project: "side", animation: "walk", bone: "leg-l", property: "rotate", keys: [{ time: 0, value: 20 }, { time: 0.5, value: -20 }] });
	await h.ok("anim_draw_order_keys", { project: "side", animation: "walk", keys: [{ time: 0.25, order: ["body", "leg-l"] }] });
	await h.ok("event_define", { project: "side", name: "step-l" });
	await h.ok("event_define", { project: "side", name: "step-r" });
	await h.ok("anim_event_keys", { project: "side", animation: "walk", keys: [{ time: 0, name: "step-l" }] });

	await h.ok("mirror_animation", { project: "side", animation: "walk", to: "walk-other" });
	const ws = Workspace.open("side");
	const out = ws.doc.animations["walk-other"];
	expect(out.bones).toEqual({ "leg-r": ws.doc.animations.walk.bones!["leg-l"] });
	expect((out.events as { name: string }[]).map((e) => e.name)).toEqual(["step-r"]);
	const loaded = load(ws);
	poseAt(loaded, "walk-other", 0.3);
	expect(loaded.skeleton.drawOrder.appliedPose.map((s) => s.data.name)).toEqual(["body", "leg-r", "leg-l"]);
	expect((await h.call("mirror_animation", { project: "side", animation: "walk", to: "walk-other" })).text).toMatch(/already exists/);
});
