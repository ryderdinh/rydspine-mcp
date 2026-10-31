// bone_update compensate: aiming or moving a bone leaves its child bones and attachments where they are.
import { join } from "node:path";
import { RegionAttachment } from "@esotericsoftware/spine-core";
import { beforeAll, expect, it } from "vitest";
import { load } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

let h: Awaited<ReturnType<typeof connect>>;

beforeAll(async () => {
	h = await connect();
});

/** World corners of every region, and world origin and rotation of every bone. */
function snapshot(project: string) {
	const { skeleton } = load(Workspace.open(project));
	const out: Record<string, number[]> = {};
	for (const slot of skeleton.slots) {
		const att = slot.appliedPose.attachment;
		if (!(att instanceof RegionAttachment)) continue;
		const v = new Array<number>(8);
		att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
		out[`slot ${slot.data.name}`] = v;
	}
	for (const b of skeleton.bones) out[`bone ${b.data.name}`] = [b.appliedPose.worldX, b.appliedPose.worldY, b.appliedPose.getWorldRotationX()];
	return out;
}

it("keeps children and attachments in place when a bone is aimed or moved", async () => {
	const p = "aim";
	const art = join(h.root, "art");
	await h.ok("project_create", { name: p });
	await h.ok("image_import", {
		project: p,
		images: [
			{ path: shape(art, "upper", 20, 60, [200, 80, 80]), x: 30, y: 100 },
			{ path: shape(art, "lower", 16, 50, [80, 80, 200]), x: 30, y: 45 },
		],
	});
	await h.ok("bone_add", { project: p, bones: [{ name: "upper", x: 30, y: 130, space: "world" }, { name: "lower", parent: "upper", x: 30, y: 70, space: "world" }] });
	await h.ok("slot_update", { project: p, name: "upper", bone: "upper" });
	await h.ok("slot_update", { project: p, name: "lower", bone: "lower" });
	const before = snapshot(p);

	await h.ok("bone_update", { project: p, name: "upper", rotation: -90, length: 60, space: "world", compensate: true });
	await h.ok("bone_update", { project: p, name: "upper", x: 5, y: 7, compensate: true });
	const scaled = await h.call("bone_update", { project: p, name: "upper", scaleX: 1.5, compensate: true });
	expect(scaled.text).toMatch(/not scale changes/);
	const after = snapshot(p);
	for (const [k, v] of Object.entries(before))
		if (k !== "bone upper") v.forEach((n, i) => expect(after[k][i], `${k}[${i}]`).toBeCloseTo(n, 1));
	expect(after["bone upper"][2]).toBeCloseTo(-90, 3);

	// Without compensate the children follow the bone, as before.
	await h.ok("bone_update", { project: p, name: "upper", rotation: 0 });
	expect(snapshot(p)["bone lower"][0]).not.toBeCloseTo(before["bone lower"][0], 0);
});
