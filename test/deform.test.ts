// Deform keys from world-space moves, and keying both scale axes at once.
import { join } from "node:path";
import type { MeshAttachment } from "@esotericsoftware/spine-core";
import { expect, it } from "vitest";
import { load, poseAt } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

function worldAt(project: string, slotName: string, anim: string, t: number): number[][] {
	const loaded = load(Workspace.open(project));
	poseAt(loaded, anim, t);
	const slot = loaded.skeleton.findSlot(slotName)!;
	const mesh = slot.appliedPose.getAttachment() as MeshAttachment;
	const v = new Array<number>(mesh.worldVerticesLength);
	mesh.computeWorldVertices(loaded.skeleton, slot, 0, mesh.worldVerticesLength, v, 0, 2);
	return Array.from({ length: v.length / 2 }, (_, i) => [v[2 * i], v[2 * i + 1]]);
}

const span = (pts: number[][], k: number) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));

it("stretches plain and weighted meshes with world-space moves", async () => {
	const { root, ok, call } = await connect();
	await ok("project_create", { name: "glow" });
	await ok("bone_add", {
		project: "glow",
		bones: [
			{ name: "base", x: 10, y: 5, rotation: 30, scaleX: 1.5 },
			...[0, 1, 2].map((i) => ({ name: `s${i}`, parent: "base", space: "world", x: -100 + i * 100, y: 0, length: 100 })),
		],
	});
	const art = join(root, "art");
	await ok("image_import", {
		project: "glow",
		images: [
			{ path: shape(art, "blob", 200, 40, [250, 230, 0]), bone: "base", x: 0, y: 0 },
			{ path: shape(art, "strip", 200, 40, [200, 40, 40]), bone: "s1", x: 0, y: 100 },
		],
	});
	const region = await call("anim_deform_keys", { project: "glow", animation: "x", slot: "blob", keys: [{ time: 0 }] });
	expect(region.isError).toBe(true);
	await ok("mesh_generate", { project: "glow", slot: "blob", shape: "grid", cols: 4, rows: 2 });
	await ok("mesh_generate", { project: "glow", slot: "strip", shape: "grid", cols: 4, rows: 1, bones: ["s0", "s1", "s2"], smooth: 80 });
	await ok("anim_create", { project: "glow", name: "streak", loop: false });
	const notMesh = await call("anim_deform_keys", { project: "glow", animation: "streak", slot: "nope", keys: [{ time: 0 }] });
	expect(notMesh.isError).toBe(true);

	// Stretch both meshes from their left end in world space, whatever the bones do: 3x along, half across.
	for (const slot of ["blob", "strip"]) {
		const setup = worldAt("glow", slot, "streak", 0);
		const left = setup.reduce((a, b) => (b[0] < a[0] ? b : a));
		const r = await ok("anim_deform_keys", {
			project: "glow",
			animation: "streak",
			slot,
			keys: [
				{ time: 0, ease: "ease-out" },
				{ time: 0.5, moves: [{ pivot: { x: left[0], y: left[1] }, scaleX: 3, scaleY: 0.5 }] },
			],
		});
		expect(r.text).toMatch(/0s: vertices move up to 0\.0px\n0\.5s: vertices move up to \d+/);
		const end = worldAt("glow", slot, "streak", 0.5);
		end.forEach((p, i) => {
			expect(p[0]).toBeCloseTo(left[0] + 3 * (setup[i][0] - left[0]), 1);
			expect(p[1]).toBeCloseTo(left[1] + 0.5 * (setup[i][1] - left[1]), 1);
		});
		// Eased out: more than halfway at a quarter of the time.
		const mid = worldAt("glow", slot, "streak", 0.25);
		expect(span(mid, 0) - span(setup, 0)).toBeGreaterThan((span(end, 0) - span(setup, 0)) / 2);
	}

	// A radius limits the move to the vertices near the pivot.
	await ok("anim_deform_keys", { project: "glow", animation: "streak", slot: "blob", keys: [{ time: 1, moves: [{ pivot: { x: 100, y: 0 }, y: 50, radius: 120 }] }] });
	const bent = worldAt("glow", "blob", "streak", 1);
	const setup = worldAt("glow", "blob", "streak", 0);
	expect(bent.some((p, i) => p[1] > setup[i][1] + 10)).toBe(true);
	bent.forEach((p, i) => {
		const near = Math.hypot(setup[i][0] - 100, setup[i][1]) < 120;
		if (near) expect(p[1]).toBeGreaterThan(setup[i][1]);
		else expect(p[1]).toBeCloseTo(setup[i][1], 3);
	});
	const v = await ok("validate", { project: "glow" });
	expect(v.text).not.toMatch(/error/i);

	// Rebuilding a mesh with deform keys is refused.
	const rebuild = await call("mesh_generate", { project: "glow", slot: "blob", shape: "grid", cols: 2, rows: 2 });
	expect(rebuild.isError).toBe(true);
});

it("keys scalex and scaley together with property scale", async () => {
	const { ok } = await connect();
	await ok("project_create", { name: "pop" });
	await ok("bone_add", { project: "pop", bones: [{ name: "logo", x: 0, y: 0 }] });
	await ok("anim_create", { project: "pop", name: "pop", loop: false });
	await ok("anim_tween", { project: "pop", animation: "pop", bones: ["logo"], property: "scale", from: 0, to: 1.2, duration: 0.4 });
	const keys = Workspace.open("pop").doc.animations.pop.bones!.logo;
	expect(Object.keys(keys).sort()).toEqual(["scalex", "scaley"]);
	expect(keys.scalex).toEqual(keys.scaley);
	expect(keys.scalex.at(-1)!.value).toBe(1.2);
});
