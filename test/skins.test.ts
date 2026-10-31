// Skins: swap a region image and a meshed, weighted part per outfit on one rig.
import { join } from "node:path";
import { MeshAttachment } from "@esotericsoftware/spine-core";
import { beforeAll, expect, it } from "vitest";
import { load, poseAt } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

let h: Awaited<ReturnType<typeof connect>>;
let art: string;
beforeAll(async () => {
	h = await connect();
	art = join(h.root, "art");
});

it("builds outfits with region and linked-mesh variants", async () => {
	const p = "knight";
	await h.ok("project_create", { name: p });
	await h.ok("image_import", {
		project: p,
		images: [
			{ path: shape(art, "cape", 30, 120, [60, 60, 160]), x: -10, y: 90 },
			{ path: shape(art, "body", 40, 80, [150, 150, 160]), x: 0, y: 70 },
			{ path: shape(art, "helmet", 36, 30, [150, 150, 160], true), x: 0, y: 125 },
		],
	});
	await h.ok("rig_template", { project: p, template: { kind: "chain", name: "cape", points: [{ x: -10, y: 150 }, { x: -10, y: 30 }], segments: 3, slots: ["cape"] } });
	await h.ok("skin_create", { project: p, name: "red" });
	await h.ok("skin_variant", { project: p, skin: "red", slot: "helmet", image: shape(art, "helmet-red", 40, 34, [200, 40, 40], true) });
	const mesh = await h.ok("skin_variant", { project: p, skin: "red", slot: "cape", image: shape(art, "cape-red", 30, 120, [200, 40, 40]) });
	expect(mesh.text).toContain("(linkedmesh)");
	await h.ok("skin_create", { project: p, name: "red-gold", copyFrom: "red" });
	await h.ok("skin_variant", { project: p, skin: "red-gold", slot: "helmet", image: shape(art, "helmet-gold", 40, 34, [230, 190, 60], true) });

	const wrongShape = await h.call("skin_variant", { project: p, skin: "red", slot: "cape", image: shape(art, "cape-wide", 90, 60, [0, 0, 0]) });
	expect(wrongShape.isError).toBe(true);
	expect(wrongShape.text).toMatch(/same proportions/);

	await h.ok("anim_create", { project: p, name: "wave", loop: true });
	await h.ok("anim_oscillate", { project: p, animation: "wave", bones: ["cape1", "cape2", "cape3"], property: "rotate", amplitude: 8, period: 1, end: 1, delayPerBone: 0.1 });
	expect((await h.ok("validate", { project: p })).text).toMatch(/^OK/);
	expect((await h.ok("project_status", { project: p })).text).toMatch(/red-gold: .*helmet\/helmet/);

	// In the red skin the cape is the red image but bends exactly like the default cape.
	const loaded = load(Workspace.open(p));
	const cape = (skin: string) => {
		loaded.skeleton.setSkin(skin);
		loaded.skeleton.setupPoseSlots();
		poseAt(loaded, "wave", 0.3);
		const slot = loaded.skeleton.findSlot("cape")!;
		const att = slot.appliedPose.getAttachment() as MeshAttachment;
		const v = new Array<number>(att.worldVerticesLength);
		att.computeWorldVertices(loaded.skeleton, slot, 0, v.length, v, 0, 2);
		return { path: att.path, v };
	};
	const plain = cape("default");
	const red = cape("red");
	expect(red.path).toBe("cape-red");
	red.v.forEach((x, i) => expect(x).toBeCloseTo(plain.v[i], 3));
	const shot = await h.ok("preview", { project: p, skin: "red-gold", animation: "wave", frames: 3 });
	expect(shot.text).toMatch(/@red-gold\.png/);
	await h.ok("export", { project: p });
});
