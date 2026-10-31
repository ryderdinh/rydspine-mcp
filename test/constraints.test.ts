// Path and slider constraints through the MCP tools, checked with the Spine runtime.
import { Physics } from "@esotericsoftware/spine-core";
import { expect, it } from "vitest";
import { pathLengths } from "../src/rig.js";
import { boneByName, load, poseAt } from "../src/runtime.js";
import { spineOrder, Workspace } from "../src/workspace.js";
import { connect } from "./helpers.js";

it("lays a chain along a path made from world points and slides it", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "rope" });
	await h.ok("rig_template", { project: "rope", template: { kind: "chain", name: "seg", points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], segments: 4 } });
	const points = [{ x: 0, y: 0 }, { x: 100, y: 80 }, { x: 200, y: 80 }, { x: 300, y: 0 }];
	const r = await h.ok("constraint_add", {
		project: "rope",
		constraint: { type: "path", name: "rope", bones: ["seg1", "seg2", "seg3", "seg4"], points, spacingMode: "percent", spacing: 0.25, rotateMode: "chainScale" },
	});
	expect(r.isError).toBeFalsy();
	expect((await h.ok("validate", { project: "rope" })).text).not.toMatch(/error/i);

	const ws = Workspace.open("rope");
	expect(ws.doc.slots.map((s) => s.name)).toContain("rope-path");
	const path = ws.doc.skins[0].attachments["rope-path"]["rope-path"] as unknown as { vertexCount: number; vertices: number[] };
	expect(path.vertexCount).toBe(12);
	// The curve passes through every point (the middle vertex of each [in, point, out] triple).
	points.forEach(({ x, y }, i) => expect([path.vertices[i * 6 + 2], path.vertices[i * 6 + 3]]).toEqual([x, y]));

	const { skeleton } = load(ws);
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	const first = boneByName(skeleton, "seg1").appliedPose;
	expect(first.worldX).toBeCloseTo(0, 3);
	expect(first.worldY).toBeCloseTo(0, 3);
	// Bones bend up to follow the arch instead of staying on the straight line.
	expect(boneByName(skeleton, "seg2").appliedPose.worldY).toBeGreaterThan(40);

	await h.ok("anim_create", { project: "rope", name: "slide", loop: false });
	const slide = Workspace.open("rope");
	slide.doc.animations.slide.path = { rope: { position: [{ value: 0 }, { time: 1, value: 0.5 }] } };
	slide.commit("slide along the path");
	const later = load(Workspace.open("rope"));
	poseAt(later, "slide", 1);
	expect(boneByName(later.skeleton, "seg1").appliedPose.worldX).toBeGreaterThan(100);

	const bad = await h.call("constraint_add", { project: "rope", constraint: { type: "path", name: "other", bones: ["seg1"], slot: "nope" } });
	expect(bad.isError).toBe(true);
	expect(bad.text).toMatch(/path slot "nope" not found/);
});

it("drives an animation from a control bone with a slider", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "dial" });
	await h.ok("bone_add", { project: "dial", bones: [{ name: "knob", length: 40 }, { name: "needle", length: 60 }] });
	await h.ok("anim_create", { project: "dial", name: "sweep", loop: false });
	await h.ok("anim_set_keys", { project: "dial", animation: "sweep", bone: "needle", property: "rotate", keys: [{ time: 0, value: 0 }, { time: 1, value: -90 }] });

	const missing = await h.call("constraint_add", { project: "dial", constraint: { type: "slider", name: "s", animation: "nope" } });
	expect(missing.text).toMatch(/needs an existing animation/);
	// One full turn of the knob plays one second of the animation.
	await h.ok("constraint_add", {
		project: "dial",
		constraint: { type: "slider", name: "dial", animation: "sweep", bone: "knob", property: "rotate", scale: 1 / 360 },
	});
	await h.ok("bone_update", { project: "dial", name: "knob", rotation: 180 });
	const { skeleton } = load(Workspace.open("dial"));
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	expect(boneByName(skeleton, "needle").appliedPose.getWorldRotationX()).toBeCloseTo(-45, 1);

	const blocked = await h.call("anim_remove", { project: "dial", name: "sweep" });
	expect(blocked.text).toMatch(/played by slider dial/);
});

it("measures path segments like Spine, closing segment included", () => {
	const straight = pathLengths([-10, 0, 0, 0, 10, 0, 90, 0, 100, 0, 110, 0]);
	expect(straight[0]).toBeCloseTo(100, 3);
	expect(straight).toHaveLength(2);
});

it("orders animations like Spine Editor 4.3.26 does on import", () => {
	// Observed by importing these names into Spine and exporting again.
	const names = ["walk", "B1", "b2", "a10", "a9", "_x", "Zed", "idle/loop", "idle-2", "émote"];
	expect(spineOrder(names)).toEqual(["a9", "a10", "B1", "b2", "idle-2", "walk", "Zed", "_x", "émote", "idle/loop"]);
});
