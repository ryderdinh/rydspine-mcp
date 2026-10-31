// Event and draw order keys and custom bezier eases through the MCP tools, checked with the Spine runtime.
import { join } from "node:path";
import { type Event, MixFrom } from "@esotericsoftware/spine-core";
import { expect, it } from "vitest";
import { renderSvg } from "../src/preview.js";
import { load, poseAt } from "../src/runtime.js";
import { Workspace } from "../src/workspace.js";
import { connect, shape } from "./helpers.js";

it("fires events with values inherited from their definition", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "walker" });
	await h.ok("anim_create", { project: "walker", name: "walk", loop: true });
	await h.ok("anim_set_keys", { project: "walker", animation: "walk", bone: "root", property: "rotate", keys: [{ time: 0, value: 0 }, { time: 1, value: 0 }] });

	const bad = await h.call("event_define", { project: "walker", name: "step", volume: 0.5 });
	expect(bad.text).toMatch(/give audio too/);
	await h.ok("event_define", { project: "walker", name: "step", string: "left", audio: "step.ogg", volume: 0.8 });
	const r = await h.ok("anim_event_keys", {
		project: "walker",
		animation: "walk",
		keys: [{ time: 0, name: "step" }, { time: 0.5, name: "step", string: "right", balance: 0.5 }, { time: 0.5, name: "dust", int: 2 }],
	});
	expect(r.text).toMatch(/3 event key\(s\) on walk; defined dust/);
	// The same name at the same time is replaced, not doubled.
	await h.ok("anim_event_keys", { project: "walker", animation: "walk", keys: [{ time: 0.5, name: "dust", int: 3 }] });

	const ws = Workspace.open("walker");
	expect(Object.keys(ws.doc).indexOf("events")).toBe(Object.keys(ws.doc).indexOf("animations") - 1);
	expect(ws.doc.events).toEqual({ step: { string: "left", audio: "step.ogg", volume: 0.8 }, dust: {} });
	expect(ws.doc.animations.walk.events).toEqual([
		{ time: 0, name: "step" },
		{ time: 0.5, name: "step", string: "right", balance: 0.5 },
		{ time: 0.5, name: "dust", int: 3 },
	]);

	const loaded = load(ws);
	const fired: Event[] = [];
	loaded.data.findAnimation("walk")!.apply(loaded.skeleton, 0.25, 0.75, false, fired, 1, MixFrom.current, false, false, false);
	expect(fired.map((e) => [e.data.name, e.stringValue, e.intValue, e.volume, e.balance])).toEqual([
		["step", "right", 0, expect.closeTo(0.8, 5), 0.5],
		["dust", "", 3, 0, 0],
	]);
	expect((await h.ok("project_status", { project: "walker" })).text).toMatch(/events step@0 step@0.5 dust@0.5/);

	const gone = await h.ok("event_define", { project: "walker", name: "dust", remove: true });
	expect(gone.text).toMatch(/removed event dust and 1 key/);
	expect(Workspace.open("walker").doc.animations.walk.events).toHaveLength(2);
});

it("keys the draw order and keeps the keys right when the setup order changes", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "cards" });
	const dir = join(h.root, "src");
	const images = (["back", "body", "arm", "front"] as const).map((n, i) => ({
		path: shape(dir, n, 20, 20, [i * 60, 0, 0]),
		x: i * 5,
		y: 0,
	}));
	await h.ok("image_import", { project: "cards", images });
	await h.ok("anim_create", { project: "cards", name: "swing", loop: true });
	await h.ok("anim_set_keys", { project: "cards", animation: "swing", bone: "root", property: "rotate", keys: [{ time: 0, value: 0 }, { time: 1, value: 0 }] });

	const missing = await h.call("anim_draw_order_keys", { project: "cards", animation: "swing", keys: [{ time: 0, order: ["hand"] }] });
	expect(missing.text).toMatch(/slot "hand" not found/);
	// arm goes behind body at 0.5 (partial order), then everything reversed at 0.75, then back to setup.
	await h.ok("anim_draw_order_keys", {
		project: "cards",
		animation: "swing",
		keys: [{ time: 0.5, order: ["arm", "body"] }, { time: 0.75, order: ["front", "arm", "body", "back"] }, { time: 0.9 }],
	});

	const order = (project: string, t: number) => {
		const loaded = load(Workspace.open(project));
		poseAt(loaded, "swing", t);
		return loaded.skeleton.drawOrder.appliedPose.map((s) => s.data.name);
	};
	expect(order("cards", 0.1)).toEqual(["back", "body", "arm", "front"]);
	expect(order("cards", 0.6)).toEqual(["back", "arm", "body", "front"]);
	expect(order("cards", 0.8)).toEqual(["front", "arm", "body", "back"]);
	expect(order("cards", 0.95)).toEqual(["back", "body", "arm", "front"]);
	expect(Workspace.open("cards").doc.animations.swing.drawOrder).toEqual([
		{ time: 0.5, offsets: [{ slot: "arm", offset: -1 }] },
		{ time: 0.75, offsets: expect.any(Array) },
		{ time: 0.9 },
	]);

	// Moving front to the back of the setup order rewrites the offsets; each key still shows the same order.
	await h.ok("slot_update", { project: "cards", name: "front", drawOrder: 0 });
	expect(order("cards", 0.1)).toEqual(["front", "back", "body", "arm"]);
	expect(order("cards", 0.6)).toEqual(["back", "arm", "body", "front"]);
	expect(order("cards", 0.8)).toEqual(["front", "arm", "body", "back"]);

	// The preview draws in the keyed order: arm's image before body's.
	const ws = Workspace.open("cards");
	const svg = renderSvg(ws, { animation: "swing", times: [0.6] });
	const at = (name: string) => svg.indexOf(`href="#img${ws.imageNames().indexOf(name)}"`);
	expect(at("arm")).toBeGreaterThan(-1);
	expect(at("arm")).toBeLessThan(at("body"));
});

it("takes a custom bezier as the ease of a key", async () => {
	const h = await connect();
	await h.ok("project_create", { name: "ease" });
	await h.ok("bone_add", { project: "ease", bones: [{ name: "b", length: 10 }] });
	await h.ok("anim_create", { project: "ease", name: "go", loop: false });
	const bad = await h.call("anim_set_keys", { project: "ease", animation: "go", bone: "b", property: "rotate", keys: [{ time: 0, value: 0, ease: [1.5, 0, 0.5, 1] }] });
	expect(bad.isError).toBe(true);
	await h.ok("anim_set_keys", {
		project: "ease",
		animation: "go",
		bone: "b",
		property: "rotate",
		keys: [{ time: 0, value: 0, ease: [0.2, 1.4, 0.6, 1] }, { time: 2, value: 100 }],
	});
	// Normalized control points scaled to the segment: time 0..2, value 0..100.
	expect(Workspace.open("ease").doc.animations.go.bones!.b.rotate[0].curve).toEqual([0.4, 140, 1.2, 100]);
	const loaded = load(Workspace.open("ease"));
	poseAt(loaded, "go", 1);
	// The overshooting curve is past the halfway value at mid-time.
	expect(loaded.skeleton.findBone("b")!.appliedPose.rotation).toBeGreaterThan(60);
});
