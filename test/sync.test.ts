// Round trip with Spine Editor: export, edit the JSON as Spine would, sync back, diff and revert.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { Workspace } from "../src/workspace.js";
import { connect } from "./helpers.js";

let h: Awaited<ReturnType<typeof connect>>;
const COIN = resolve("test/fixtures/coin");

beforeAll(async () => {
	h = await connect();
});

it("syncs an edit made in Spine, reports the diff and can revert it", async () => {
	const p = "coin";
	await h.ok("project_import", { name: p, skeleton: join(COIN, "coin-pro.json"), images: join(COIN, "images"), loops: ["animation"] });
	await h.ok("lock_set", { project: p, kind: "bones", names: ["shine"], locked: true });
	await h.ok("export", { project: p });
	const before = Workspace.open(p).meta.version;

	// What an animator might do in Spine: move the shine, drop a timeline, add an animation.
	const file = join(h.root, p, "export", "coin.json");
	const doc = JSON.parse(readFileSync(file, "utf8"));
	doc.bones.find((b: { name: string }) => b.name === "shine").x = 40;
	delete doc.animations.animation.bones.shine;
	doc.animations.idle = { bones: { "coin-front": { rotate: [{ value: 0 }, { time: 1, value: 10 }] } } };
	writeFileSync(file, JSON.stringify(doc));

	const r = await h.ok("project_sync", { project: p, skeleton: file });
	expect(r.text).toContain("the Spine edit changed locked items: bone shine");
	expect(r.text).toMatch(/~ bone shine: x 243\.1438 -> 40/);
	expect(r.text).toMatch(/~ animation animation: -shine\.\w+/);
	expect(r.text).toContain("+ animation idle (1 timelines)");
	expect(Workspace.open(p).meta.loops.animation).toBe(true);

	const d = await h.ok("history_diff", { project: p, from: before - 1 });
	expect(d.text).toContain("~ locked bones: none -> shine");
	expect(d.text).toContain("+ animation idle");

	await h.ok("history_revert", { project: p, version: before });
	const back = await h.ok("history_diff", { project: p, from: before });
	expect(back.text).toMatch(/no changes$/m);
});

it("rejects a sync from a binary file", async () => {
	const r = await h.call("project_sync", { project: "coin", skeleton: join(COIN, "coin.png") });
	expect(r.isError).toBe(true);
	expect(r.text).toMatch(/\.json or binary \.skel/);
});
