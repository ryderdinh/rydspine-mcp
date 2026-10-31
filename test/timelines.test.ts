// Constraint and image sequence timelines through the MCP tools, checked with the Spine runtime.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { renderSvg } from "../src/preview.js";
import { boneByName, load, poseAt } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

it("slides bones along a path and fades a transform constraint with keys", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "rope" });
	await h.ok("rig_template", { project: "rope", template: { kind: "chain", name: "seg", points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], segments: 3 } });
	const points = [{ x: 0, y: 0 }, { x: 150, y: 100 }, { x: 300, y: 0 }];
	await h.ok("constraint_add", {
		project: "rope",
		constraint: { type: "path", name: "rope", bones: ["seg1", "seg2", "seg3"], points, spacingMode: "percent", spacing: 0.2, rotateMode: "chainScale" },
	});
	await h.ok("bone_add", { project: "rope", bones: [{ name: "driver", x: 0, y: 200 }, { name: "follower", x: 100, y: 200 }] });
	await h.ok("constraint_add", {
		project: "rope",
		constraint: { type: "transform", name: "follow", bones: ["follower"], source: "driver", properties: { rotate: { to: { rotate: {} } }, x: { to: { x: {} } } }, mixRotate: 0.8, mixX: 1 },
	});
	await h.ok("anim_create", { project: "rope", name: "slide", loop: false });
	await h.ok("anim_set_keys", { project: "rope", animation: "slide", bone: "driver", property: "translatex", keys: [{ time: 0, value: 0 }, { time: 1, value: 50 }] });

	const wrong = await h.call("anim_constraint_keys", { project: "rope", animation: "slide", constraint: "rope", property: "time", keys: [{ time: 0, value: 1 }] });
	expect(wrong.text).toMatch(/path constraints have position, spacing, mix timelines/);

	await h.ok("anim_constraint_keys", {
		project: "rope",
		animation: "slide",
		constraint: "rope",
		property: "position",
		keys: [{ time: 0, value: 0, ease: "ease-in-out" }, { time: 1, value: 0.5 }],
	});
	// Only mixX is keyed; mixRotate keeps the setup 0.8.
	const r = await h.ok("anim_constraint_keys", {
		project: "rope",
		animation: "slide",
		constraint: "follow",
		property: "mix",
		keys: [{ time: 0, mixX: 1, ease: "linear" }, { time: 1, mixX: 0 }],
	});
	expect(r.text).toMatch(/2 key\(s\) on follow mix \(mixRotate, mixX/);

	const ws = Workspace.open("rope");
	const anim = ws.doc.animations.slide as Record<string, Record<string, unknown>>;
	expect((anim.transform.follow as { mixRotate: number }[]).map((k) => k.mixRotate)).toEqual([0.8, 0.8]);
	// One bezier per channel of a multi-channel key; one for a single value.
	expect(((anim.path.rope as { position: { curve?: number[] }[] }).position[0].curve ?? []).length).toBe(4);

	const loaded = load(ws);
	poseAt(loaded, "slide", 0);
	const start = boneByName(loaded.skeleton, "seg1").appliedPose.worldX;
	expect(boneByName(loaded.skeleton, "follower").appliedPose.worldX).toBeCloseTo(0, 3);
	poseAt(loaded, "slide", 1);
	expect(boneByName(loaded.skeleton, "seg1").appliedPose.worldX).toBeGreaterThan(start + 100);
	// mixX 0 at the end: the follower is back at its own setup x.
	expect(boneByName(loaded.skeleton, "follower").appliedPose.worldX).toBeCloseTo(100, 3);

	// Removing a constraint takes its timelines along, or the runtime would reject the skeleton.
	await h.ok("constraint_remove", { project: "rope", name: "rope" });
	expect(Workspace.open("rope").doc.animations.slide.path).toBeUndefined();
});

it("keys slider time, IK bend and physics settings", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "dial" });
	await h.ok("bone_add", { project: "dial", bones: [{ name: "needle", length: 60 }, { name: "hair", y: 100, length: 40 }] });
	await h.ok("anim_create", { project: "dial", name: "sweep", loop: false });
	await h.ok("anim_set_keys", { project: "dial", animation: "sweep", bone: "needle", property: "rotate", keys: [{ time: 0, value: 0 }, { time: 1, value: -90 }] });
	await h.ok("constraint_add", { project: "dial", constraint: { type: "slider", name: "gauge", animation: "sweep" } });
	await h.ok("constraint_add", { project: "dial", constraint: { type: "physics", name: "sway", bone: "hair", rotate: 1 } });
	await h.ok("anim_create", { project: "dial", name: "show", loop: false });

	await h.ok("anim_constraint_keys", { project: "dial", animation: "show", constraint: "gauge", property: "time", keys: [{ time: 0, value: 0 }, { time: 1, value: 0.5 }] });
	const loaded = load(Workspace.open("dial"));
	poseAt(loaded, "show", 1);
	expect(boneByName(loaded.skeleton, "needle").appliedPose.getWorldRotationX()).toBeCloseTo(-45, 1);

	await h.ok("anim_constraint_keys", { project: "dial", animation: "show", constraint: "sway", property: "mass", keys: [{ time: 0, value: 2 }] });
	await h.ok("anim_constraint_keys", { project: "dial", animation: "show", constraint: "", property: "reset", keys: [{ time: 0.5 }] });
	const bad = await h.call("anim_constraint_keys", { project: "dial", animation: "show", constraint: "sway", property: "mass", keys: [{ time: 0, value: 0 }] });
	expect(bad.text).toMatch(/mass must be greater than 0/);
	const physics = Workspace.open("dial").doc.animations.show.physics as Record<string, Record<string, unknown>>;
	expect(physics.sway.mass).toEqual([{ time: 0, value: 2 }]);
	expect(physics[""].reset).toEqual([{ time: 0.5 }]);
	expect((await h.ok("validate", { project: "dial" })).text).not.toMatch(/error/i);
});

it("imports frames as an image sequence and plays it", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "fx" });
	const frames = [[255, 0, 0], [0, 255, 0], [0, 0, 255]].map((c, i) => shape(join(h.root, "src"), `f${i}`, 20, 30, c as [number, number, number]));
	const r = await h.ok("sequence_import", { project: "fx", name: "fire", images: frames, x: 10, y: 20, setup: 1 });
	expect(r.text).toMatch(/fire: 3 frames, 20x30/);
	const ws = Workspace.open("fx");
	expect(ws.doc.skins[0].attachments.fire.fire).toMatchObject({ path: "fire/fire", sequence: { count: 3, start: 1, digits: 2, setup: 1 } });
	for (const n of ["01", "02", "03"]) expect(existsSync(ws.imagePath(`fire/fire${n}`))).toBe(true);
	expect((await h.ok("validate", { project: "fx" })).text).not.toMatch(/error/i);

	await h.ok("anim_create", { project: "fx", name: "burn", loop: true });
	const out = await h.call("anim_sequence_keys", { project: "fx", animation: "burn", slot: "fire", keys: [{ time: 0, index: 3 }] });
	expect(out.text).toMatch(/outside the 3 frames/);
	await h.ok("anim_sequence_keys", { project: "fx", animation: "burn", slot: "fire", keys: [{ time: 0, mode: "loop", delay: 0.1 }, { time: 1, mode: "hold", index: 2 }] });
	await h.ok("anim_set_keys", { project: "fx", animation: "burn", bone: "root", property: "rotate", keys: [{ time: 0, value: 0 }, { time: 1.2, value: 0 }] });
	const played = Workspace.open("fx");
	expect(played.doc.animations.burn.attachments).toEqual({
		default: { fire: { fire: { sequence: [{ time: 0, mode: "loop", delay: 0.1 }, { time: 1, index: 2 }] } } },
	});

	const loaded = load(played);
	const frame = (t: number) => {
		poseAt(loaded, "burn", t);
		const slot = loaded.skeleton.findSlot("fire")!;
		return slot.appliedPose.sequenceIndex;
	};
	expect([frame(0.05), frame(0.15), frame(0.25), frame(0.35), frame(1.1)]).toEqual([0, 1, 2, 0, 2]);
	// The preview draws the frame the slot shows: green (frame 1) in the setup pose.
	expect(renderSvg(played, {})).toMatch(/href="#img1"/);
	const svg = renderSvg(played, { animation: "burn", times: [0.25] });
	expect(svg).toMatch(/href="#img2"/);
});
