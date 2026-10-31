// Point, bounding box and clipping attachments and paths weighted to control bones, checked with the Spine runtime.
import { join } from "node:path";
import { Physics, PointAttachment, SkeletonBounds, Vector2 } from "@esotericsoftware/spine-core";
import { expect, it } from "vitest";
import { renderSvg } from "../src/preview.js";
import { boneByName, load, poseAt } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

it("adds a point that follows its bone and a hit box traced from the art", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "gunner" });
	await h.ok("bone_add", { project: "gunner", bones: [{ name: "gun", x: 100, y: 50, rotation: 30, length: 60, space: "world" }] });
	const dir = join(h.root, "src");
	await h.ok("image_import", { project: "gunner", images: [{ path: shape(dir, "ball", 40, 40, [200, 40, 40], true), x: 0, y: 100 }] });

	const r = await h.ok("shape_add", { project: "gunner", type: "point", name: "muzzle", bone: "gun", x: 150, y: 80, rotation: 30 });
	expect(r.text).toMatch(/point muzzle/);
	const bad = await h.call("shape_add", { project: "gunner", type: "point", name: "m2", around: "ball" });
	expect(bad.text).toMatch(/x, y and rotation only/);

	const box = await h.ok("shape_add", { project: "gunner", type: "boundingbox", name: "hit", around: "ball" });
	expect(box.text).toMatch(/boundingbox hit: \d+ vertices/);
	const ws = Workspace.open("gunner");
	expect(ws.doc.slots.find((s) => s.name === "hit")!.bone).toBe("root");
	expect(ws.doc.skins[0].attachments.hit.hit).toMatchObject({ type: "boundingbox", vertexCount: expect.any(Number) });

	const loaded = load(ws);
	const { skeleton } = loaded;
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	const muzzle = skeleton.findSlot("muzzle")!;
	const point = muzzle.appliedPose.getAttachment() as PointAttachment;
	const at = point.computeWorldPosition(muzzle.bone.appliedPose, new Vector2());
	expect(at.x).toBeCloseTo(150, 1);
	expect(at.y).toBeCloseTo(80, 1);
	expect(point.computeWorldRotation(muzzle.bone.appliedPose)).toBeCloseTo(30, 1);

	// The traced box holds the ball (a circle of radius 20 at (0, 100)) and little else.
	const bounds = new SkeletonBounds();
	bounds.update(skeleton, true);
	expect(bounds.containsPoint(0, 100)).not.toBeNull();
	expect(bounds.containsPoint(0, 118)).not.toBeNull();
	expect(bounds.containsPoint(19, 119)).toBeNull();
	expect(bounds.containsPoint(0, 130)).toBeNull();

	// Rotating the gun carries the muzzle along.
	await h.ok("anim_create", { project: "gunner", name: "aim", loop: false });
	await h.ok("anim_set_keys", { project: "gunner", animation: "aim", bone: "gun", property: "rotate", keys: [{ time: 0, value: 60 }] });
	const aimed = load(Workspace.open("gunner"));
	poseAt(aimed, "aim", 0);
	const slot = aimed.skeleton.findSlot("muzzle")!;
	const moved = (slot.appliedPose.getAttachment() as PointAttachment).computeWorldPosition(slot.bone.appliedPose, new Vector2());
	expect(Math.hypot(moved.x - 100, moved.y - 50)).toBeCloseTo(Math.hypot(50, 30), 1);
	expect(moved.y).toBeGreaterThan(80);

	const svg = renderSvg(Workspace.open("gunner"), {});
	expect(svg).toMatch(/<polygon [^>]*class="box"/);
	expect(svg).toMatch(/<circle cx="150" cy="-80" [^>]*class="mark"/);
});

it("puts a clipping right below the first slot it masks and keeps draw order keys", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "window" });
	const dir = join(h.root, "src");
	const images = (["wall", "sky", "bird", "frame"] as const).map((n, i) => ({ path: shape(dir, n, 40, 40, [i * 60, 80, 0]), x: 0, y: 0 }));
	await h.ok("image_import", { project: "window", images });
	await h.ok("anim_create", { project: "window", name: "fly", loop: true });
	await h.ok("anim_draw_order_keys", { project: "window", animation: "fly", keys: [{ time: 0.5, order: ["frame", "wall"] }] });

	const upside = await h.call("shape_add", { project: "window", type: "clipping", name: "pane", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], from: "bird", end: "sky" });
	expect(upside.text).toMatch(/from must not be above end/);
	expect((await h.call("shape_add", { project: "window", type: "clipping", name: "pane", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })).text).toMatch(/needs end/);

	const square = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
	await h.ok("shape_add", { project: "window", type: "clipping", name: "pane", points: square, from: "sky", end: "bird" });
	const ws = Workspace.open("window");
	expect(ws.doc.slots.map((s) => s.name)).toEqual(["wall", "pane", "sky", "bird", "frame"]);
	expect(ws.doc.skins[0].attachments.pane.pane).toMatchObject({ type: "clipping", end: "bird", vertexCount: 4 });

	const loaded = load(ws);
	poseAt(loaded, "fly", 0.6);
	// The key still swaps frame and wall; the new pane stays right below sky.
	expect(loaded.skeleton.drawOrder.appliedPose.map((s) => s.data.name)).toEqual(["frame", "pane", "sky", "bird", "wall"]);

	// Sky and bird are drawn inside the mask's clip group, frame outside it.
	const svg = renderSvg(ws, {});
	const group = svg.slice(svg.indexOf("<clipPath"), svg.indexOf("</g>", svg.indexOf("<clipPath")));
	const id = (n: string) => `href="#img${ws.imageNames().indexOf(n)}"`;
	expect(group).toContain(id("sky"));
	expect(group).toContain(id("bird"));
	expect(group).not.toContain(id("frame"));
	expect((await h.ok("validate", { project: "window" })).text).not.toMatch(/error/i);
});

it("bends a path with control bones the points are weighted to", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "vine" });
	await h.ok("rig_template", { project: "vine", template: { kind: "chain", name: "seg", points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], segments: 4 } });
	await h.ok("bone_add", {
		project: "vine",
		bones: [
			{ name: "ctrl1", x: 0, y: -40, space: "world" },
			{ name: "ctrl2", x: 150, y: -40, space: "world" },
			{ name: "ctrl3", x: 300, y: -40, space: "world" },
		],
	});
	const points = [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 300, y: 0 }];
	const constraint = { type: "path", name: "vine", bones: ["seg1", "seg2", "seg3", "seg4"], points, spacingMode: "percent", spacing: 0.25, rotateMode: "chainScale" };
	const loop = await h.call("constraint_add", { project: "vine", constraint: { ...constraint, pathBones: ["ctrl1", "seg2"] } });
	expect(loop.text).toMatch(/seg2 are moved by the constraint itself/);
	await h.ok("constraint_add", { project: "vine", constraint: { ...constraint, pathBones: ["ctrl1", "ctrl2", "ctrl3"], maxInfluences: 1 } });

	const ws = Workspace.open("vine");
	const path = ws.doc.skins[0].attachments["vine-path"]["vine-path"] as unknown as { vertexCount: number; vertices: number[] };
	expect(path.vertexCount).toBe(9);
	// Weighted: each of the 9 vertices is [1 bone, index, x, y, weight]; the middle point sits on ctrl2.
	expect(path.vertices).toHaveLength(9 * 5);
	const ctrl2 = ws.doc.bones.findIndex((b) => b.name === "ctrl2");
	expect(path.vertices.slice(4 * 5, 5 * 5)).toEqual([1, ctrl2, 0, 40, 1]);
	expect((await h.ok("validate", { project: "vine" })).text).not.toMatch(/error/i);

	// Lifting the middle control bone lifts the middle of the chain.
	await h.ok("anim_create", { project: "vine", name: "lift", loop: false });
	await h.ok("anim_set_keys", { project: "vine", animation: "lift", bone: "ctrl2", property: "translatey", keys: [{ time: 0, value: 60 }] });
	const loaded = load(Workspace.open("vine"));
	poseAt(loaded, "lift", 0);
	expect(boneByName(loaded.skeleton, "seg3").appliedPose.worldY).toBeGreaterThan(40);
	expect(boneByName(loaded.skeleton, "seg1").appliedPose.worldY).toBeCloseTo(0, 3);
});
