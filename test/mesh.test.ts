// Rebuilding a mesh in place and smooth automatic weights.
import { join } from "node:path";
import type { MeshAttachment } from "@esotericsoftware/spine-core";
import { expect, it } from "vitest";
import { load } from "../src/runtime.js";
import type { MeshJson } from "../src/types.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

function hullWorld(name: string): number[][] {
	const { skeleton } = load(Workspace.open("strip"));
	const slot = skeleton.findSlot(name)!;
	const mesh = slot.appliedPose.getAttachment() as MeshAttachment;
	const v = new Array<number>(mesh.worldVerticesLength);
	mesh.computeWorldVertices(skeleton, slot, 0, mesh.worldVerticesLength, v, 0, 2);
	return Array.from({ length: mesh.hullLength / 2 }, (_, i) => [v[2 * i], v[2 * i + 1]]);
}

it("rebuilds a weighted mesh where it was and blends weights with smooth", async () => {
	const { root, ok, call } = await connect();
	await ok("project_create", { name: "strip" });
	// A 400x40 strip centered at (100, 30) on a rotated parent, with four bones along it.
	await ok("bone_add", {
		project: "strip",
		bones: [
			{ name: "base", x: 10, y: 5, rotation: 20 },
			...[0, 1, 2, 3].map((i) => ({ name: `s${i}`, parent: "base", space: "world", x: -100 + i * 100, y: 30, length: 100 })),
		],
	});
	const file = shape(join(root, "art"), "strip", 400, 40, [200, 40, 40]);
	await ok("image_import", { project: "strip", images: [{ path: file, bone: "s1", x: 100, y: 30 }] });
	const bones = ["s0", "s1", "s2", "s3"];
	await ok("mesh_generate", { project: "strip", slot: "strip", shape: "grid", cols: 4, rows: 1, bones });
	const corners = (h: number[][]) => [h[0], h.find(([x]) => x > 290 && x < 310)!];
	const before = corners(hullWorld("strip"));
	expect(before[0][0]).toBeCloseTo(-100, 1);
	expect(before[0][1]).toBeCloseTo(50, 1);

	// Rebuilding keeps the art in place and takes new settings.
	const again = await ok("mesh_generate", { project: "strip", slot: "strip", shape: "grid", cols: 8, rows: 2, bones, smooth: 100 });
	expect(again.text).toMatch(/27 vertices/);
	const after = corners(hullWorld("strip"));
	after.forEach((p, i) => p.forEach((n, k) => expect(n).toBeCloseTo(before[i][k], 1)));

	// Without smooth a vertex on a bone follows that bone alone; with it, neighbors share the vertex.
	const counts = (m: MeshJson) => {
		const out: number[] = [];
		for (let i = 0; i < m.vertices.length; i += 1 + m.vertices[i] * 4) out.push(m.vertices[i]);
		return out;
	};
	const smooth = Workspace.open("strip").doc.skins[0].attachments.strip.strip as MeshJson;
	expect(Math.min(...counts(smooth))).toBeGreaterThanOrEqual(2);
	await ok("mesh_generate", { project: "strip", slot: "strip", shape: "grid", cols: 8, rows: 2, bones, maxInfluences: 2 });
	const sharp = Workspace.open("strip").doc.skins[0].attachments.strip.strip as MeshJson;
	const firstWeights = (m: MeshJson) => m.vertices.slice(1, 1 + m.vertices[0] * 4).filter((_, k) => k % 4 === 3);
	expect(Math.max(...firstWeights(sharp))).toBeGreaterThan(0.95);
	expect(Math.max(...firstWeights(smooth))).toBeLessThan(0.8);

	const bad = await call("mesh_generate", { project: "strip", slot: "nope" });
	expect(bad.isError).toBe(true);

	// Turning the strip over like a page (mirrored bones) folds it on purpose: reported, not an error.
	await ok("mesh_generate", { project: "strip", slot: "strip", shape: "grid", cols: 8, rows: 2, bones, smooth: 100 });
	await ok("anim_create", { project: "strip", name: "turn", loop: false });
	await ok("anim_tween", { project: "strip", animation: "turn", bones: ["s2", "s3"], property: "scalex", from: 1, to: -1, duration: 0.5 });
	const v = await ok("validate", { project: "strip" });
	expect(v.text).toMatch(/turn: mesh strip in slot strip turns over/);
});
