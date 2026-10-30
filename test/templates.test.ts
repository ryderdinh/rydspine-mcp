// Rig templates on simple generated art: a biped, a dragon-like tail chain, a chest lid hinge and a wheel.
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { load, poseAt } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

let h: Awaited<ReturnType<typeof connect>>;
let art: string;

beforeAll(async () => {
	h = await connect();
	art = join(h.root, "art");
});

const world = (project: string, bone: string) => {
	const p = load(Workspace.open(project)).skeleton.findBone(bone)!.appliedPose;
	return { x: p.worldX, y: p.worldY };
};

describe("rig_template", () => {
	it("builds a biped whose IK keeps knees and elbows where they are drawn", async () => {
		const p = "walker";
		await h.ok("project_create", { name: p });
		await h.ok("image_import", {
			project: p,
			images: [
				{ path: shape(art, "leg-back", 14, 50, [60, 60, 140]), name: "right-thigh", x: 10, y: 75 },
				{ path: shape(art, "shin-back", 12, 50, [60, 60, 140]), name: "right-shin", x: 12, y: 27 },
				{ path: shape(art, "torso", 40, 60, [200, 70, 70]), x: 0, y: 130 },
				{ path: shape(art, "head", 36, 36, [240, 200, 160], true), x: 0, y: 185 },
				{ path: shape(art, "leg", 14, 50, [80, 80, 180]), name: "left-thigh", x: -10, y: 75 },
				{ path: shape(art, "shin", 12, 50, [80, 80, 180]), name: "left-shin", x: -8, y: 27 },
			],
		});
		const joints = {
			hips: { x: 0, y: 100 },
			chest: { x: 0, y: 155 },
			neck: { x: 0, y: 165 },
			head: { x: 0, y: 200 },
			leftShoulder: { x: -20, y: 150 },
			leftElbow: { x: -30, y: 125 },
			leftHand: { x: -25, y: 100 },
			rightShoulder: { x: 20, y: 150 },
			rightElbow: { x: 30, y: 125 },
			rightHand: { x: 25, y: 100 },
			// Knees bent forward (+x), as drawn.
			leftHip: { x: -10, y: 100 },
			leftKnee: { x: -6, y: 52 },
			leftFoot: { x: -10, y: 2 },
			rightHip: { x: 10, y: 100 },
			rightKnee: { x: 14, y: 52 },
			rightFoot: { x: 10, y: 2 },
		};
		const r = await h.ok("rig_template", {
			project: p,
			template: {
				kind: "biped",
				...joints,
				parts: {
					torso: "torso",
					head: "head",
					"left-thigh": "left-leg-upper",
					"left-shin": "left-leg-lower",
					"right-thigh": "right-leg-upper",
					"right-shin": "right-leg-lower",
				},
			},
		});
		expect(r.text).toContain("left-leg-target");
		expect((await h.ok("validate", { project: p })).text).toMatch(/^OK/);
		for (const [bone, joint] of [
			["left-leg-lower", joints.leftKnee],
			["right-leg-lower", joints.rightKnee],
			["left-arm-lower", joints.leftElbow],
			["right-arm-lower", joints.rightElbow],
		] as const) {
			const at = world(p, bone);
			expect(Math.hypot(at.x - joint.x, at.y - joint.y)).toBeLessThan(0.5);
		}

		// Crouch: lower the hips; feet stay planted on their root-owned targets and knees bend further forward.
		await h.ok("anim_create", { project: p, name: "crouch", loop: false });
		await h.ok("anim_tween", { project: p, animation: "crouch", bones: ["hips"], property: "translatey", to: -25, duration: 0.5 });
		const loaded = load(Workspace.open(p));
		poseAt(loaded, "crouch", 0.5);
		const knee = loaded.skeleton.findBone("left-leg-lower")!.appliedPose;
		const shin = loaded.skeleton.findBone("left-leg-lower")!;
		const foot = { x: knee.worldX + knee.a * shin.data.length, y: knee.worldY + knee.c * shin.data.length };
		expect(Math.hypot(foot.x - joints.leftFoot.x, foot.y - joints.leftFoot.y)).toBeLessThan(0.5);
		expect(knee.worldX).toBeGreaterThan(joints.leftKnee.x);
		await h.ok("preview", { project: p, animation: "crouch", frames: 3 });
	});

	it("builds a tail chain with a bending mesh and physics", async () => {
		const p = "dragon";
		await h.ok("project_create", { name: p });
		await h.ok("image_import", { project: p, images: [{ path: shape(art, "tail", 160, 30, [70, 160, 90], true), x: -80, y: 50 }] });
		const r = await h.ok("rig_template", {
			project: p,
			template: { kind: "chain", name: "tail", points: [{ x: 0, y: 50 }, { x: -160, y: 50 }], segments: 4, slots: ["tail"], physics: true },
		});
		expect(r.text).toContain("tail1, tail2, tail3, tail4");
		const ws = Workspace.open(p);
		expect(ws.doc.skins[0].attachments.tail.tail.type).toBe("mesh");
		expect(ws.doc.constraints.filter((c) => c.type === "physics")).toHaveLength(4);
		await h.ok("anim_create", { project: p, name: "wag", loop: true });
		await h.ok("anim_oscillate", {
			project: p,
			animation: "wag",
			bones: ["tail1", "tail2", "tail3", "tail4"],
			property: "rotate",
			amplitude: 10,
			period: 1,
			end: 1,
			delayPerBone: 0.1,
		});
		expect((await h.ok("validate", { project: p })).text).toMatch(/^OK/);
		await h.ok("preview", { project: p, animation: "wag", frames: 4 });
	});

	it("opens a chest lid around its hinge", async () => {
		const p = "chest";
		await h.ok("project_create", { name: p });
		await h.ok("image_import", {
			project: p,
			images: [
				{ path: shape(art, "box", 100, 50, [140, 90, 40]), x: 0, y: 25 },
				{ path: shape(art, "lid", 100, 20, [170, 110, 50]), x: 0, y: 60 },
			],
		});
		await h.ok("rig_template", { project: p, template: { kind: "hinge", name: "lid", pivot: { x: -50, y: 50 }, tip: { x: 50, y: 50 }, slots: ["lid"] } });
		await h.ok("anim_create", { project: p, name: "open", loop: false });
		await h.ok("anim_tween", { project: p, animation: "open", bones: ["lid"], property: "rotate", to: 70, duration: 0.4, ease: "ease-out" });
		await h.ok("anim_bounce", { project: p, animation: "open", bones: ["lid"], property: "rotate", from: 70, to: 60, start: 0.4, duration: 0.4, style: "spring" });
		expect((await h.ok("validate", { project: p })).text).toMatch(/^OK/);
		const loaded = load(Workspace.open(p));
		poseAt(loaded, "open", 0.4);
		const lid = loaded.skeleton.findBone("lid")!.appliedPose;
		expect(lid.worldX).toBeCloseTo(-50, 3);
		expect(lid.getWorldRotationX()).toBeCloseTo(70, 1);
	});

	it("rolls a wheel", async () => {
		const p = "cart";
		await h.ok("project_create", { name: p });
		await h.ok("image_import", { project: p, images: [{ path: shape(art, "wheel", 40, 40, [50, 50, 50], true), x: 0, y: 20 }] });
		await h.ok("rig_template", { project: p, template: { kind: "wheel", name: "wheel", center: { x: 0, y: 20 }, radius: 20, slots: ["wheel"] } });
		await h.ok("anim_create", { project: p, name: "roll", loop: true });
		await h.ok("anim_tween", { project: p, animation: "roll", bones: ["wheel"], property: "rotate", from: 0, to: -360, duration: 1, ease: "linear" });
		expect((await h.ok("validate", { project: p })).text).toMatch(/roll: 1\.000s, loop seam 0\.0/);
	});

	it("walks in place without foot sliding, and catches a skating foot", async () => {
		const p = "walker";
		await h.ok("anim_create", { project: p, name: "walk", loop: true });
		const r = await h.ok("anim_gait", {
			project: p,
			animation: "walk",
			feet: [
				{ bone: "left-leg-target", phase: 0 },
				{ bone: "right-leg-target", phase: 0.5 },
			],
			body: "hips",
			period: 1,
			stride: 40,
			lift: 12,
			bob: 3,
		});
		expect(r.text).toMatch(/ground speed 66\.667 px\/s/);
		expect((await h.ok("validate", { project: p })).text).toMatch(/walk: 1\.000s, loop seam 0\.0/);
		const check = await h.ok("motion_check", { project: p, animation: "walk", feet: ["left-leg-target", "right-leg-target"] });
		expect(check.text).toMatch(/^OK/);
		expect(check.text).toMatch(/speed -66\.\d px\/s/);

		// A foot that eases to a stop while still on the ground skates.
		await h.ok("anim_create", { project: p, name: "skate", loop: false });
		await h.ok("anim_tween", { project: p, animation: "skate", bones: ["left-leg-target"], property: "translatex", from: 0, to: 30, duration: 1, ease: "ease-in-out" });
		const bad = await h.call("motion_check", { project: p, animation: "skate", feet: ["left-leg-target"] });
		expect(bad.isError).toBe(true);
		expect(bad.text).toMatch(/^SLIDING/);
		await h.ok("preview", { project: p, animation: "walk", frames: 6 });
	});

	it("fades and swaps slot attachments", async () => {
		const p = "cart";
		await h.ok("anim_create", { project: p, name: "appear", loop: false });
		await h.ok("anim_slot_keys", {
			project: p,
			animation: "appear",
			slot: "wheel",
			property: "alpha",
			keys: [{ time: 0, value: 0, ease: "ease-out" }, { time: 0.5, value: 1 }],
		});
		await h.ok("anim_slot_keys", { project: p, animation: "appear", slot: "wheel", property: "attachment", keys: [{ time: 0.6, name: null }, { time: 0.8, name: "wheel" }] });
		expect((await h.ok("validate", { project: p })).text).toMatch(/appear: 0\.800s/);
		const loaded = load(Workspace.open(p));
		poseAt(loaded, "appear", 0.25);
		const slot = loaded.skeleton.findSlot("wheel")!;
		expect(slot.appliedPose.color.a).toBeGreaterThan(0.5);
		expect(slot.appliedPose.color.a).toBeLessThan(1);
		poseAt(loaded, "appear", 0.7);
		expect(loaded.skeleton.findSlot("wheel")!.appliedPose.getAttachment()).toBeNull();
	});
});
