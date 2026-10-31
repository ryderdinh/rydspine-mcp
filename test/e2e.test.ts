// Drives the server through a real MCP client, building a small creature end to end.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RegionAttachment } from "@esotericsoftware/spine-core";
import { writePsdBuffer } from "ag-psd";
import { PNG } from "pngjs";
import { load, poseAt } from "../src/runtime.js";
import { createServer } from "../src/server.js";
import { Workspace } from "../src/workspace.js";

const IMAGES = resolve("spike/fixtures/swing/images");
let client: Client;
let root: string;

type Content = { type: string; text?: string; data?: string };
async function call(name: string, args: Record<string, unknown> = {}) {
	const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Content[] };
	const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
	return { ...r, text };
}
async function ok(name: string, args: Record<string, unknown> = {}) {
	const r = await call(name, args);
	if (r.isError) throw new Error(`${name} failed: ${r.text}`);
	return r;
}

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "rydspine-"));
	process.env.RYDSPINE_WORKSPACES = root;
	const [a, b] = InMemoryTransport.createLinkedPair();
	await createServer().connect(a);
	client = new Client({ name: "test", version: "0" });
	await client.connect(b);
});

afterAll(() => {
	if (!process.env.KEEP_WORKSPACES) rmSync(root, { recursive: true, force: true });
});

const project = "critter";

/** World corners of every region attachment in the setup pose. */
function regionCorners(): Record<string, number[]> {
	const { skeleton } = load(Workspace.open(project));
	const out: Record<string, number[]> = {};
	for (const slot of skeleton.slots) {
		const att = slot.appliedPose.getAttachment();
		if (!(att instanceof RegionAttachment)) continue;
		const v = new Array<number>(8);
		att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
		out[slot.data.name] = v;
	}
	return out;
}

describe("rydspine end to end", () => {
	it("lists its tools", async () => {
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name)).toEqual(
			expect.arrayContaining(["project_create", "bone_add", "anim_oscillate", "validate", "preview", "export"]),
		);
	});

	it("builds a rig from parts placed in world space", async () => {
		await ok("project_create", { name: project });
		await ok("image_import", {
			project,
			images: [
				{ path: join(IMAGES, "flag.png"), name: "tail", x: -40, y: 120 },
				{ path: join(IMAGES, "body.png"), x: 0, y: 100 },
				{ path: join(IMAGES, "arm1.png"), name: "upper", x: 40, y: 150 },
				{ path: join(IMAGES, "arm2.png"), name: "lower", x: 80, y: 150 },
			],
		});
		await ok("bone_add", {
			project,
			bones: [
				{ name: "body", x: 0, y: 50, rotation: 90, length: 100, space: "world" },
				{ name: "upper", parent: "body", x: 20, y: 150, rotation: 0, length: 40, space: "world" },
				{ name: "lower", parent: "upper", x: 60, y: 150, rotation: 0, length: 40, space: "world" },
				{ name: "target", x: 95, y: 140, space: "world" },
				{ name: "tail1", parent: "body", x: -20, y: 120, rotation: 180, length: 20, space: "world" },
				{ name: "tail2", parent: "tail1", x: -40, y: 120, rotation: 180, length: 20, space: "world" },
			],
		});
		const before = regionCorners();
		for (const [slot, bone] of [["body", "body"], ["upper", "upper"], ["lower", "lower"], ["tail", "tail1"]])
			await ok("slot_update", { project, name: slot, bone });
		// Binding with keepWorld must not move any art.
		const after = regionCorners();
		for (const [slot, corners] of Object.entries(before))
			corners.forEach((n, i) => expect(after[slot][i]).toBeCloseTo(n, 1));

		const mesh = await ok("mesh_generate", { project, slot: "tail", shape: "grid", cols: 4, rows: 2, bones: ["tail1", "tail2"] });
		expect(mesh.text).toMatch(/15 vertices, 16 triangles/);
		await ok("constraint_add", { project, constraint: { type: "ik", name: "arm-ik", bones: ["upper", "lower"], target: "target" } });
		await ok("constraint_add", {
			project,
			constraint: { type: "physics", name: "tail-physics", bone: "tail2", rotate: 1, inertia: 0.6, damping: 0.8 },
		});
		const status = await ok("project_status", { project });
		expect(status.text).toContain("tail -> bone tail1");
		expect(status.text).toContain("ik arm-ik");
	});

	it("rejects bad edits without saving them", async () => {
		const versions = (await ok("history_list", { project })).text.split("\n").length;
		const bad = await call("constraint_add", {
			project,
			constraint: { type: "ik", name: "bad", bones: ["upper", "tail1"], target: "target" },
		});
		expect(bad.isError).toBe(true);
		expect(bad.text).toMatch(/not a child/);
		const cycle = await call("bone_update", { project, name: "body", parent: "tail2" });
		expect(cycle.isError).toBe(true);
		expect((await ok("history_list", { project })).text.split("\n").length).toBe(versions);
	});

	it("animates a seamless loop with follow-through", async () => {
		await ok("anim_create", { project, name: "idle", loop: true });
		await ok("anim_oscillate", { project, animation: "idle", bones: ["body"], property: "rotate", amplitude: 6, period: 2, end: 2 });
		const fitted = await ok("anim_oscillate", {
			project,
			animation: "idle",
			bones: ["tail1", "tail2"],
			property: "rotate",
			amplitude: 15,
			period: 0.9,
			end: 2,
			delayPerBone: 0.12,
			falloff: 1.4,
		});
		expect(fitted.text).toMatch(/period adjusted 0.9s -> 1s/);
		await ok("anim_oscillate", { project, animation: "idle", bones: ["target"], property: "translatey", amplitude: 5, period: 1, end: 2 });
		const v = await ok("validate", { project });
		expect(v.text).toMatch(/^OK/);
		expect(v.text).toMatch(/idle: 2\.000s, loop seam 0\.0\d\dpx/);
	});

	it("animates one-shot moves: anticipation, spring and drop", async () => {
		await ok("anim_create", { project, name: "pop", loop: false });
		await ok("anim_tween", { project, animation: "pop", bones: ["upper"], property: "rotate", to: 40, duration: 0.5, anticipation: 0.2 });
		await ok("anim_bounce", { project, animation: "pop", bones: ["body"], property: "scaley", from: 0.6, to: 1, duration: 0.8, style: "spring" });
		await ok("anim_bounce", { project, animation: "pop", bones: ["target"], property: "translatey", from: 40, to: 0, start: 0.5, duration: 0.7, style: "drop" });
		const v = await ok("validate", { project });
		expect(v.text).toMatch(/^OK/);
		// IK overrides the arm's own keys: the arm tip stays on the (reachable) target.
		const loaded = load(Workspace.open(project));
		poseAt(loaded, "pop", 0.3);
		const lower = loaded.skeleton.findBone("lower")!.appliedPose;
		const target = loaded.skeleton.findBone("target")!.appliedPose;
		expect(Math.hypot(lower.worldX + lower.a * 40 - target.worldX, lower.worldY + lower.c * 40 - target.worldY)).toBeLessThan(1);
		const shot = await ok("preview", { project, animation: "pop", frames: 6 });
		expect(shot.content.some((c) => c.type === "image")).toBe(true);
	});

	it("catches a loop that does not close", async () => {
		await ok("anim_create", { project, name: "broken", loop: true });
		await ok("anim_set_keys", {
			project,
			animation: "broken",
			bone: "body",
			property: "rotate",
			keys: [{ time: 0, value: 0, ease: "ease-in-out" }, { time: 1, value: 20 }],
		});
		const v = await call("validate", { project });
		expect(v.isError).toBe(true);
		expect(v.text).toMatch(/broken: loop seam jumps/);
		await ok("anim_remove", { project, name: "broken" });
	});

	it("respects locks and can revert", async () => {
		await ok("lock_set", { project, kind: "animations", names: ["idle"], locked: true });
		const locked = await call("anim_tween", { project, animation: "idle", bones: ["body"], property: "rotate", to: 90, duration: 1 });
		expect(locked.isError).toBe(true);
		expect(locked.text).toMatch(/locked animations: idle/);

		const history = (await ok("history_list", { project })).text.split("\n");
		const before = Number(history[history.length - 1].match(/^v(\d+)/)![1]);
		await ok("bone_remove", { project, name: "target" }).catch(() => {});
		await ok("bone_update", { project, name: "body", length: 10 });
		await ok("history_revert", { project, version: before });
		expect((await ok("project_status", { project })).text).toContain("len=100");
	});

	it("exports runtime files and a working player page", async () => {
		const r = await ok("export", { project });
		const dir = join(root, project, "export");
		for (const f of ["critter.json", "critter.atlas", "critter.png", "critter.html"]) expect(existsSync(join(dir, f))).toBe(true);
		const json = JSON.parse(readFileSync(join(dir, "critter.json"), "utf8"));
		expect(json.skeleton.spine).toBe("4.3.26");
		expect(r.text).toContain("exported");

		const { chromium } = createRequire(import.meta.url)("playwright");
		const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
		try {
			const page = await browser.newPage();
			await page.goto(`file://${join(dir, "critter.html")}`);
			await page.waitForFunction(() => (window as any).playerReady || (window as any).playerError, null, { timeout: 15000 });
			expect(await page.evaluate(() => (window as any).playerError ?? null)).toBeNull();
		} finally {
			await browser.close();
		}
	}, 30000);
});

describe("existing Spine project (coin, exported by Spine 4.3.75-beta)", () => {
	const COIN = resolve("test/fixtures/coin");

	it("unpacks the atlas back into the original images", async () => {
		const r = await ok("project_import", {
			name: "coin-atlas",
			skeleton: join(COIN, "coin-pro.json"),
			atlas: join(COIN, "coin.atlas"),
			loops: ["animation"],
		});
		expect(r.text).toContain("unpacked 7 images");
		const ws = Workspace.open("coin-atlas");
		for (const name of ws.imageNames()) {
			const a = PNG.sync.read(readFileSync(ws.imagePath(name)));
			const b = PNG.sync.read(readFileSync(join(COIN, "images", `${name}.png`)));
			expect([a.width, a.height]).toEqual([b.width, b.height]);
			expect(Buffer.compare(a.data, b.data)).toBe(0);
		}
	});

	it("imports, validates, previews and edits the coin", async () => {
		const r = await ok("project_import", {
			name: "coin",
			skeleton: join(COIN, "coin-pro.json"),
			images: join(COIN, "images"),
			loops: ["animation"],
		});
		expect(r.text).toContain("copied 7 images");
		expect(r.text).toContain("clipping -> bone clipping");
		const v = await ok("validate", { project: "coin" });
		expect(v.text).toMatch(/animation: 2\.667s, loop seam 0\.000px/);
		const shot = await ok("preview", { project: "coin", animation: "animation", frames: 8, showBones: false });
		expect(shot.content.some((c) => c.type === "image")).toBe(true);

		// Add a new animation with rydspine's own tools on top of the imported rig.
		await ok("anim_create", { project: "coin", name: "pop", loop: false });
		await ok("anim_bounce", { project: "coin", animation: "pop", bones: ["root"], property: "scalex", from: 0, to: 1, duration: 0.8 });
		await ok("anim_bounce", { project: "coin", animation: "pop", bones: ["root"], property: "scaley", from: 0, to: 1, duration: 0.8 });
		await ok("validate", { project: "coin" });
		await ok("preview", { project: "coin", animation: "pop", frames: 6, showBones: false });

		// The export loads back as a fresh import: the round trip keeps the original animation intact.
		await ok("export", { project: "coin" });
		const exported = join(root, "coin", "export");
		await ok("project_import", { name: "coin-again", skeleton: join(exported, "coin.json"), atlas: join(exported, "coin.atlas") });
		const again = JSON.parse(readFileSync(join(root, "coin-again", "skeleton.json"), "utf8"));
		const original = JSON.parse(readFileSync(join(COIN, "coin-pro.json"), "utf8"));
		expect(again.animations.animation).toEqual(original.animations.animation);
		expect(Object.keys(again.animations)).toEqual(["animation", "pop"]);
	});

	it("rejects binary and pre-4.3 files with a clear message", async () => {
		const bin = await call("project_import", { name: "bin", skeleton: join(COIN, "coin.png"), atlas: join(COIN, "coin.atlas") });
		expect(bin.text).toMatch(/\.json or binary \.skel/);
	});
});

describe("PSD import", () => {
	function solid(width: number, height: number, rgba: number[]) {
		const data = new Uint8ClampedArray(width * height * 4);
		for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
		return { width, height, data };
	}
	const layer = (name: string, left: number, top: number, w: number, h: number, rgba: number[], extra: object = {}) => ({
		name,
		left,
		top,
		right: left + w,
		bottom: top + h,
		imageData: solid(w, h, rgba),
		...extra,
	});

	it("imports layers in order with position, opacity, blend and hidden handling", async () => {
		const file = join(root, "hero.psd");
		const psd = {
			width: 200,
			height: 300,
			children: [
				layer("shadow", 50, 280, 100, 20, [0, 0, 0, 255], { opacity: 0.5, blendMode: "multiply" }),
				{
					name: "body",
					children: [
						layer("legs", 70, 180, 60, 100, [40, 40, 160, 255]),
						layer("torso", 60, 80, 80, 110, [200, 60, 60, 255]),
						layer("head", 70, 20, 60, 60, [240, 200, 160, 255]),
					],
				},
				layer("sketch", 0, 0, 200, 300, [255, 0, 0, 255], { hidden: true }),
				layer("glow", 80, 30, 40, 40, [255, 255, 200, 255], { blendMode: "linear dodge" }),
			],
		};
		writeFileSync(file, writePsdBuffer(psd as never));

		await ok("project_create", { name: "hero" });
		const r = await ok("psd_import", { project: "hero", psd: file });
		expect(r.text).toContain("5 parts");
		expect(r.text).toContain("sketch (hidden)");

		const ws = Workspace.open("hero");
		expect(ws.doc.slots.map((s) => s.name)).toEqual(["shadow", "legs", "torso", "head", "glow"]);
		const slot = (n: string) => ws.doc.slots.find((s) => s.name === n)!;
		expect(slot("shadow")).toMatchObject({ color: "ffffff80", blend: "multiply" });
		expect(slot("glow").blend).toBe("additive");
		// Bottom-center origin: the head (x 70..130, y 20..80 in the PSD) is centered above the origin.
		const headRegion = ws.doc.skins[0].attachments.head.head;
		expect(headRegion).toMatchObject({ y: 250, width: 60, height: 60 });
		expect(headRegion.x).toBeUndefined();
		const head = PNG.sync.read(readFileSync(ws.imagePath("head")));
		expect([...head.data.subarray(0, 4)]).toEqual([240, 200, 160, 255]);
		await ok("validate", { project: "hero" });

		const groups = await ok("psd_import", { project: "hero", psd: file, keepGroups: true, includeHidden: true });
		expect(groups.text).toContain("body/torso");
		expect(Workspace.open("hero").doc.slots.find((s) => s.name === "sketch-2")?.attachment).toBeUndefined();
	});
});
