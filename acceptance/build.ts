// Acceptance suite: builds the six reference assets from REQUIREMENTS.md §5 (plus a lantern for constraint and sequence timelines) entirely through the MCP
// tools, then validates, previews and exports each one.
// Usage: npx tsx acceptance/build.ts [outDir]   (default acceptance/out)
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect, type Result } from "../test/helpers.js";
import { collect, render } from "../src/ui.js";
import { Painter, type RGB } from "./art.js";

type Ok = (name: string, args?: Record<string, unknown>) => Promise<Result>;
type Pt = [number, number];

export interface AssetReport {
	project: string;
	title: string;
	prompt: string;
	animations: string[];
	checks: { name: string; ok: boolean; detail: string }[];
}

/** Paints a polygon given in world coordinates and returns an image_import item placing it there. */
function part(paint: Painter, name: string, world: Pt[], color: RGB, shade?: number) {
	const xs = world.map((p) => p[0]);
	const ys = world.map((p) => p[1]);
	const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
	const w = Math.ceil(maxX - minX) + 4;
	const h = Math.ceil(maxY - minY) + 4;
	const path = paint.polygon(name, w, h, world.map(([x, y]) => [x - minX + 2, maxY - y + 2] as Pt), color, { shade });
	return { path, name, x: minX - 2 + w / 2, y: maxY + 2 - h / 2 };
}

/** A tapered strip from a to b (world), thick at a. */
function strip(a: Pt, b: Pt, wa: number, wb: number): Pt[] {
	const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
	const nx = -(b[1] - a[1]) / len;
	const ny = (b[0] - a[0]) / len;
	return [
		[a[0] + (nx * wa) / 2, a[1] + (ny * wa) / 2],
		[b[0] + (nx * wb) / 2, b[1] + (ny * wb) / 2],
		[b[0] - (nx * wb) / 2, b[1] - (ny * wb) / 2],
		[a[0] - (nx * wa) / 2, a[1] - (ny * wa) / 2],
	];
}

const ellipsePts = (cx: number, cy: number, rx: number, ry: number, n = 28): Pt[] =>
	Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cy + ry * Math.sin((2 * Math.PI * i) / n)] as Pt);

async function validated(ok: Ok, call: Ok, project: string, report: AssetReport) {
	const v = await call("validate", { project });
	report.checks.push({ name: "validate", ok: !v.isError, detail: v.text });
}

async function hero(ok: Ok, call: Ok, paint: Painter): Promise<AssetReport> {
	const project = "hero";
	const r: AssetReport = {
		project,
		title: "Nhân vật",
		prompt: "Nhân vật chạy, dừng lại rồi vung kiếm.",
		animations: ["run", "run-stop-swing"],
		checks: [],
	};
	await ok("project_create", { name: project });
	const skin: RGB = [236, 196, 160];
	const cloth: RGB = [70, 110, 190];
	const pants: RGB = [60, 60, 90];
	// Limb images are drawn along +x so they can be laid on their bones with rotation 0.
	const limbs: [string, number, number, RGB][] = [
		["right-thigh", 52, 15, pants],
		["right-shin", 50, 13, pants],
		["left-upper", 30, 11, cloth],
		["left-fore", 28, 10, skin],
		["torso", 70, 38, cloth],
		["head", 46, 42, skin],
		["left-thigh", 52, 15, [75, 75, 110]],
		["left-shin", 50, 13, [75, 75, 110]],
		["right-upper", 30, 11, [90, 130, 210]],
		["right-fore", 28, 10, skin],
	];
	const images = limbs.map(([name, w, h, c]) => ({
		path: name === "head" ? paint.ellipse(name, w, h, c) : paint.rect(name, w, h, c, Math.min(w, h) / 2),
		name,
	}));
	images.push({ path: paint.polygon("sword", 84, 12, [[0, 3], [14, 3], [14, 0], [18, 0], [18, 3], [78, 3], [84, 6], [78, 9], [18, 9], [18, 12], [14, 12], [14, 9], [0, 9]], [200, 205, 215], { shade: 0.1 }), name: "sword" });
	await ok("image_import", { project, images });
	const j = {
		hips: { x: 0, y: 100 },
		chest: { x: 0, y: 160 },
		neck: { x: 0, y: 168 },
		head: { x: 0, y: 214 },
		leftShoulder: { x: -4, y: 155 },
		leftElbow: { x: -10, y: 127 },
		leftHand: { x: -2, y: 103 },
		rightShoulder: { x: 4, y: 155 },
		rightElbow: { x: 16, y: 130 },
		rightHand: { x: 30, y: 116 },
		leftHip: { x: -6, y: 100 },
		leftKnee: { x: -1, y: 52 },
		leftFoot: { x: -6, y: 4 },
		rightHip: { x: 6, y: 100 },
		rightKnee: { x: 11, y: 52 },
		rightFoot: { x: 6, y: 4 },
	};
	const parts: Record<string, string> = {
		torso: "torso",
		head: "head",
		"left-thigh": "left-leg-upper",
		"left-shin": "left-leg-lower",
		"right-thigh": "right-leg-upper",
		"right-shin": "right-leg-lower",
		"left-upper": "left-arm-upper",
		"left-fore": "left-arm-lower",
		"right-upper": "right-arm-upper",
		"right-fore": "right-arm-lower",
		sword: "right-arm-lower",
	};
	await ok("rig_template", { project, template: { kind: "biped", ...j, parts } });
	const lengths: Record<string, number> = { torso: 60, head: 46, "left-thigh": 48, "left-shin": 48, "right-thigh": 48, "right-shin": 48, "left-upper": 29, "left-fore": 26, "right-upper": 27, "right-fore": 24 };
	for (const [slot, len] of Object.entries(lengths)) await ok("attachment_update", { project, slot, x: len / 2, y: 0, rotation: 0 });
	// Sword held in the fist, pointing up and forward from the forearm.
	await ok("attachment_update", { project, slot: "sword", x: 24 + 30 * Math.cos(1.25), y: 30 * Math.sin(1.25), rotation: 72 });

	const run = { period: 0.6, stride: 50, lift: 18, contact: 0.35, bob: 4 };
	const feet = [
		{ bone: "left-leg-target", phase: 0 },
		{ bone: "right-leg-target", phase: 0.5 },
	];
	const armSwing = async (animation: string, end: number) => {
		await ok("anim_oscillate", { project, animation, bones: ["left-arm-target"], property: "translatex", amplitude: 14, period: run.period, end });
		await ok("anim_oscillate", { project, animation, bones: ["right-arm-target"], property: "translatex", amplitude: 10, period: run.period, end, phase: 0.5 });
	};

	await ok("anim_create", { project, name: "run", loop: true });
	await ok("anim_gait", { project, animation: "run", feet, body: "hips", ...run, event: "footstep" });
	await armSwing("run", run.period);
	await ok("anim_set_keys", { project, animation: "run", bone: "torso", property: "rotate", keys: [{ time: 0, value: -8 }, { time: run.period, value: -8 }] });

	// Run forward two cycles (root moves at ground speed so planted feet stay put), stop, swing.
	const a = "run-stop-swing";
	const runEnd = run.period * 2;
	await ok("anim_create", { project, name: a, loop: false });
	const g = await ok("anim_gait", { project, animation: a, feet, body: "hips", ...run, cycles: 2, event: "footstep" });
	const speed = Number(g.text.match(/ground speed ([\d.]+)/)![1]);
	await ok("anim_set_keys", { project, animation: a, bone: "root", property: "translatex", keys: [{ time: 0, value: 0 }, { time: runEnd, value: speed * runEnd }] });
	await armSwing(a, runEnd);
	await ok("anim_set_keys", { project, animation: a, bone: "torso", property: "rotate", keys: [{ time: 0, value: -8 }, { time: runEnd, value: -8, ease: "ease-out" }, { time: runEnd + 0.3, value: 2, ease: "ease-in-out" }, { time: runEnd + 0.5, value: 0 }] });
	// Stop: the planted left foot holds; the right foot finishes its swing and lands ahead.
	const v = (0.5 - run.contact) / (1 - run.contact);
	const rx = -run.stride / 2 + run.stride * v * v * (3 - 2 * v);
	const ry = run.lift * Math.sin(Math.PI * v);
	await ok("anim_set_keys", { project, animation: a, bone: "left-leg-target", property: "translatex", keys: [{ time: runEnd, value: run.stride / 2 }, { time: 2.4, value: run.stride / 2 }] });
	await ok("anim_set_keys", { project, animation: a, bone: "right-leg-target", property: "translatex", keys: [{ time: runEnd, value: rx, ease: "ease-in-out" }, { time: runEnd + 0.25, value: 12 }, { time: 2.4, value: 12 }] });
	await ok("anim_set_keys", { project, animation: a, bone: "right-leg-target", property: "translatey", keys: [{ time: runEnd, value: ry, ease: "ease-out" }, { time: runEnd + 0.12, value: run.lift, ease: "ease-in" }, { time: runEnd + 0.25, value: 0 }, { time: 2.4, value: 0 }] });
	await ok("anim_set_keys", { project, animation: a, bone: "hips", property: "translatey", keys: [{ time: runEnd, value: 0, ease: "ease-out" }, { time: runEnd + 0.2, value: -9, ease: "ease-in-out" }, { time: runEnd + 0.45, value: -3 }] });
	await ok("anim_set_keys", { project, animation: a, bone: "left-arm-target", property: "translatex", keys: [{ time: runEnd, value: 0, ease: "ease-out" }, { time: runEnd + 0.3, value: -6 }] });
	// Sword: wind up back and high (anticipation), slash forward and down, follow through.
	const s = runEnd + 0.3;
	await ok("anim_set_keys", { project, animation: a, bone: "right-arm-target", property: "translatex", keys: [{ time: runEnd, value: 0, ease: "ease-in-out" }, { time: s, value: -4, ease: "ease-in-out" }, { time: s + 0.25, value: -34, ease: "ease-in" }, { time: s + 0.38, value: 30, ease: "ease-out" }, { time: s + 0.8, value: 22 }] });
	await ok("anim_set_keys", { project, animation: a, bone: "right-arm-target", property: "translatey", keys: [{ time: runEnd, value: 0, ease: "ease-in-out" }, { time: s, value: 0, ease: "ease-in-out" }, { time: s + 0.25, value: 52, ease: "ease-in" }, { time: s + 0.38, value: -4, ease: "ease-out" }, { time: s + 0.8, value: 2 }] });
	await ok("anim_set_keys", { project, animation: a, bone: "torso", property: "rotate", keys: [{ time: s, value: 0, ease: "ease-in-out" }, { time: s + 0.25, value: 8, ease: "ease-in" }, { time: s + 0.38, value: -10, ease: "ease-out" }, { time: s + 0.8, value: -4 }] });

	await validated(ok, call, project, r);
	for (const anim of ["run", a]) {
		const m = await call("motion_check", { project, animation: anim, feet: ["left-leg-target", "right-leg-target"] });
		r.checks.push({ name: `motion_check ${anim}`, ok: !m.isError, detail: m.text });
	}
	r.checks.push({ name: "ground speed", ok: true, detail: `${speed} px/s: move the character at this speed while "run" plays` });
	return r;
}

async function dragon(ok: Ok, call: Ok, paint: Painter): Promise<AssetReport> {
	const project = "dragon";
	const r: AssetReport = { project, title: "Rồng", prompt: "Rồng vỗ cánh, cổ và đuôi chuyển động theo.", animations: ["fly"], checks: [] };
	await ok("project_create", { name: project });
	const scale: RGB = [70, 150, 90];
	const membrane: RGB = [120, 190, 120];
	const wing = (dx: number, dy: number): Pt[] =>
		([[10, 140], [36, 150], [24, 190], [-6, 244], [-44, 254], [-36, 222], [-56, 204], [-26, 188], [-38, 166]] as Pt[]).map(([x, y]) => [x + dx, y + dy]);
	await ok("image_import", {
		project,
		images: [
			part(paint, "wing-back", wing(-8, 6), [80, 140, 85]),
			part(paint, "tail", strip([-50, 118], [-190, 92], 34, 6), scale),
			part(paint, "body", ellipsePts(0, 120, 64, 32), scale),
			part(paint, "neck", strip([42, 132], [98, 178], 26, 16), scale),
			part(paint, "head", [[88, 172], [118, 196], [150, 186], [152, 176], [126, 166], [104, 160]], [90, 170, 100]),
			part(paint, "wing", wing(0, 0), membrane),
		],
	});
	await ok("bone_add", { project, bones: [{ name: "body", x: 0, y: 120, space: "world" }] });
	await ok("slot_update", { project, name: "body", bone: "body" });
	await ok("rig_template", { project, template: { kind: "chain", name: "neck", parent: "body", points: [{ x: 42, y: 132 }, { x: 98, y: 178 }], segments: 3, slots: ["neck"] } });
	await ok("slot_update", { project, name: "head", bone: "neck3" });
	await ok("rig_template", { project, template: { kind: "chain", name: "tail", parent: "body", points: [{ x: -50, y: 118 }, { x: -190, y: 92 }], segments: 4, slots: ["tail"] } });
	await ok("rig_template", { project, template: { kind: "chain", name: "wing", parent: "body", points: [{ x: 18, y: 146 }, { x: 0, y: 196 }, { x: -40, y: 246 }], slots: ["wing"] } });
	await ok("rig_template", { project, template: { kind: "chain", name: "backwing", parent: "body", points: [{ x: 10, y: 152 }, { x: -8, y: 202 }, { x: -48, y: 252 }], slots: ["wing-back"] } });

	await ok("anim_create", { project, name: "fly", loop: true });
	const period = 0.8;
	const end = period * 2;
	await ok("anim_oscillate", { project, animation: "fly", bones: ["wing1", "wing2"], property: "rotate", amplitude: 34, period, end, delayPerBone: 0.07, falloff: 0.8 });
	await ok("anim_oscillate", { project, animation: "fly", bones: ["backwing1", "backwing2"], property: "rotate", amplitude: 28, period, end, delayPerBone: 0.07, falloff: 0.8, phase: 0.04 });
	// Body rises as the wings push down, a quarter cycle behind.
	await ok("anim_oscillate", { project, animation: "fly", bones: ["body"], property: "translatey", amplitude: 7, period, end, phase: 0.5 });
	await ok("anim_oscillate", { project, animation: "fly", bones: ["neck1", "neck2", "neck3"], property: "rotate", amplitude: 4, period, end, delayPerBone: 0.06, phase: 0.6 });
	await ok("anim_oscillate", { project, animation: "fly", bones: ["tail1", "tail2", "tail3", "tail4"], property: "rotate", amplitude: 5, period, end, delayPerBone: 0.09, falloff: 1.35, phase: 0.7 });
	await validated(ok, call, project, r);
	return r;
}

async function tree(ok: Ok, call: Ok, paint: Painter): Promise<AssetReport> {
	const project = "tree";
	const r: AssetReport = { project, title: "Cây", prompt: "Cây nghiêng theo gió, các nhánh dao động khác nhau.", animations: ["wind"], checks: [] };
	await ok("project_create", { name: project });
	const bark: RGB = [120, 85, 55];
	const leaf: RGB = [70, 160, 70];
	const branches: [string, Pt, Pt, string][] = [
		["left", [0, 105], [-78, 150], "trunk2"],
		["right", [0, 135], [70, 178], "trunk3"],
		["top", [0, 170], [-14, 226], "trunk3"],
	];
	await ok("image_import", {
		project,
		images: [
			part(paint, "trunk", strip([0, 0], [0, 182], 30, 14), bark),
			...branches.map(([n, a, b]) => part(paint, `branch-${n}`, strip(a, b, 12, 5), bark)),
			part(paint, "leaves-left", ellipsePts(-84, 156, 42, 30), leaf),
			part(paint, "leaves-right", ellipsePts(76, 184, 40, 28), [80, 170, 75]),
			part(paint, "leaves-top", ellipsePts(-14, 230, 50, 36), [90, 180, 80]),
			part(paint, "vine", strip([-70, 148], [-70, 64], 8, 5), [60, 130, 50]),
		],
	});
	await ok("rig_template", { project, template: { kind: "chain", name: "trunk", points: [{ x: 0, y: 0 }, { x: 0, y: 180 }], segments: 3, slots: ["trunk"] } });
	for (const [n, a, b, parent] of branches) {
		await ok("rig_template", { project, template: { kind: "chain", name: `${n}-`, parent, points: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }], segments: 2, slots: [`branch-${n}`] } });
		await ok("slot_update", { project, name: `leaves-${n}`, bone: `${n}-2` });
	}
	// A vine hangs from the left branch: its path is weighted to the branch and to a control bone at the
	// tip (the vine example's setup), so the branch carries it and the control bone swings its end.
	await ok("rig_template", { project, template: { kind: "chain", name: "vine", points: [{ x: -70, y: 148 }, { x: -70, y: 64 }], segments: 3, slots: ["vine"] } });
	await ok("bone_add", { project, bones: [{ name: "vine-tip", x: -70, y: 64, space: "world" }] });
	await ok("constraint_add", {
		project,
		constraint: {
			type: "path",
			name: "vine",
			bones: ["vine1", "vine2", "vine3"],
			points: [{ x: -70, y: 148 }, { x: -73, y: 106 }, { x: -70, y: 64 }],
			pathBones: ["left-2", "vine-tip"],
			spacingMode: "percent",
			spacing: 0.33,
			rotateMode: "chainScale",
		},
	});
	const end = 3;
	await ok("anim_create", { project, name: "wind", loop: true });
	await ok("anim_oscillate", { project, animation: "wind", bones: ["vine-tip"], property: "translatex", amplitude: 10, period: 1.5, end, phase: 0.2 });
	await ok("anim_oscillate", { project, animation: "wind", bones: ["trunk1", "trunk2", "trunk3"], property: "rotate", amplitude: 1.5, center: -1.5, period: 3, end, delayPerBone: 0.2, falloff: 1.4 });
	await ok("anim_oscillate", { project, animation: "wind", bones: ["left-1", "left-2"], property: "rotate", amplitude: 5, period: 1.5, end, delayPerBone: 0.12 });
	await ok("anim_oscillate", { project, animation: "wind", bones: ["right-1", "right-2"], property: "rotate", amplitude: 6, period: 1, end, delayPerBone: 0.1, phase: 0.3 });
	await ok("anim_oscillate", { project, animation: "wind", bones: ["top-1", "top-2"], property: "rotate", amplitude: 4, period: 0.75, end, delayPerBone: 0.08, phase: 0.6 });
	await validated(ok, call, project, r);
	return r;
}

async function chest(ok: Ok, call: Ok, paint: Painter): Promise<AssetReport> {
	const project = "chest";
	const r: AssetReport = { project, title: "Rương", prompt: "Rương mở nắp rồi bật nảy nhẹ.", animations: ["open"], checks: [] };
	await ok("project_create", { name: project });
	await ok("image_import", {
		project,
		images: [
			{ path: paint.ellipse("glow", 110, 70, [255, 230, 120], { outline: 0, shade: 0 }), x: 0, y: 72 },
			{ path: paint.rect("box", 124, 62, [150, 95, 45], 6), x: 0, y: 31 },
			{ path: paint.rect("lock", 16, 20, [230, 190, 60], 3), x: 0, y: 52 },
			part(paint, "lid", [[-62, 60], [62, 60], [62, 78], [52, 92], [-52, 92], [-62, 78]], [175, 112, 55]),
		],
	});
	await ok("slot_update", { project, name: "glow", blend: "additive" });
	await ok("bone_add", { project, bones: [{ name: "chest", x: 0, y: 0, space: "world" }] });
	for (const slot of ["glow", "box", "lock"]) await ok("slot_update", { project, name: slot, bone: "chest" });
	await ok("rig_template", { project, template: { kind: "hinge", name: "lid", parent: "chest", pivot: { x: -62, y: 60 }, tip: { x: 62, y: 60 }, slots: ["lid"] } });
	// Game hooks: where coins spawn (rides the lid), a hit area traced from the box, and a mask that keeps
	// the glow inside the chest's opening.
	await ok("shape_add", { project, type: "point", name: "coin-spawn", bone: "lid", x: 30, y: 96, rotation: 90 });
	await ok("shape_add", { project, type: "boundingbox", name: "hit", around: "box" });
	await ok("shape_add", { project, type: "clipping", name: "opening", bone: "chest", end: "glow", points: [{ x: -60, y: 20 }, { x: 60, y: 20 }, { x: 70, y: 150 }, { x: -70, y: 150 }] });
	await ok("anim_create", { project, name: "open", loop: false });
	// A custom bezier: the lid snaps open fast and eases into the top of its swing.
	await ok("anim_tween", { project, animation: "open", bones: ["lid"], property: "rotate", to: 72, start: 0.15, duration: 0.3, ease: [0.15, 0.85, 0.35, 1] });
	await ok("anim_bounce", { project, animation: "open", bones: ["lid"], property: "rotate", from: 72, to: 62, start: 0.45, duration: 0.5, style: "spring", bounces: 2 });
	await ok("anim_tween", { project, animation: "open", bones: ["chest"], property: "translatey", to: 14, duration: 0.15, ease: "ease-out" });
	await ok("anim_bounce", { project, animation: "open", bones: ["chest"], property: "translatey", from: 14, to: 0, start: 0.15, duration: 0.55, style: "drop", bounces: 1, height: 0.25 });
	await ok("anim_bounce", { project, animation: "open", bones: ["chest"], property: "scaley", from: 0.9, to: 1, start: 0.35, duration: 0.35, style: "spring" });
	await ok("anim_slot_keys", { project, animation: "open", slot: "glow", property: "alpha", keys: [{ time: 0, value: 0 }, { time: 0.2, value: 0, ease: "ease-out" }, { time: 0.6, value: 0.85, ease: "ease-in-out" }, { time: 1.2, value: 0.55 }] });
	// Once the lid is up, the glow draws in front of it; sound and effect cues for the game.
	await ok("anim_draw_order_keys", { project, animation: "open", keys: [{ time: 0.3, order: ["lid", "glow"] }] });
	await ok("event_define", { project, name: "creak", audio: "creak.ogg", volume: 0.7 });
	await ok("anim_event_keys", { project, animation: "open", keys: [{ time: 0.15, name: "creak" }, { time: 0.4, name: "sparkle", int: 12, string: "gold" }, { time: 0.9, name: "creak", volume: 0.3, balance: -0.5 }] });
	await validated(ok, call, project, r);
	return r;
}

async function car(ok: Ok, call: Ok, paint: Painter): Promise<AssetReport> {
	const project = "car";
	const r: AssetReport = { project, title: "Xe", prompt: "Xe lăn bánh và thân nhún theo chuyển động.", animations: ["drive"], checks: [] };
	await ok("project_create", { name: project });
	const wheels: [string, number][] = [["back", -58], ["front", 62]];
	await ok("image_import", {
		project,
		images: [
			part(paint, "body", [[-100, 30], [100, 30], [104, 52], [90, 62], [50, 66], [30, 96], [-50, 96], [-70, 66], [-100, 60]], [210, 70, 60]),
			part(paint, "window", [[-40, 70], [24, 70], [10, 90], [-36, 90]], [170, 220, 240]),
			...wheels.flatMap(([n, x]) => [
				{ path: paint.ellipse(`tire-${n}`, 46, 46, [40, 40, 45]), name: `tire-${n}`, x, y: 23 },
				{ path: paint.star(`hub-${n}`, 26, 5, 0.45, [190, 190, 200]), name: `hub-${n}`, x, y: 23 },
			]),
		],
	});
	await ok("bone_add", { project, bones: [{ name: "body", x: 0, y: 40, space: "world" }] });
	for (const slot of ["body", "window"]) await ok("slot_update", { project, name: slot, bone: "body" });
	for (const [n, x] of wheels)
		await ok("rig_template", { project, template: { kind: "wheel", name: `wheel-${n}`, center: { x, y: 23 }, radius: 23, slots: [`tire-${n}`, `hub-${n}`] } });
	await ok("anim_create", { project, name: "drive", loop: true });
	for (const [n] of wheels)
		await ok("anim_tween", { project, animation: "drive", bones: [`wheel-${n}`], property: "rotate", from: 0, to: -360, duration: 1, ease: "linear" });
	await ok("anim_oscillate", { project, animation: "drive", bones: ["body"], property: "translatey", amplitude: 2.5, period: 0.25, end: 1 });
	await ok("anim_oscillate", { project, animation: "drive", bones: ["body"], property: "rotate", amplitude: 1, period: 0.5, end: 1, phase: 0.2 });
	await validated(ok, call, project, r);
	const speed = (2 * Math.PI * 23).toFixed(1);
	r.checks.push({ name: "roll speed", ok: true, detail: `one wheel turn per second = ${speed} px/s: move the car at this speed so the tires do not skid` });
	return r;
}

async function logo(ok: Ok, call: Ok, paint: Painter): Promise<AssetReport> {
	const project = "logo";
	const r: AssetReport = { project, title: "Logo", prompt: "Logo xuất hiện, nảy rồi ổn định.", animations: ["appear"], checks: [] };
	await ok("project_create", { name: project });
	await ok("image_import", {
		project,
		images: [
			{ path: paint.ellipse("ring", 150, 150, [60, 90, 200], { shade: 0.3 }), x: 0, y: 90 },
			{ path: paint.star("badge", 128, 8, 0.78, [250, 200, 60]), x: 0, y: 90 },
			{ path: paint.star("core", 64, 5, 0.45, [255, 250, 235], { shade: 0.1 }), x: 0, y: 90 },
			{ path: paint.star("spark-a", 22, 4, 0.3, [255, 255, 255], { outline: 0, shade: 0 }), x: 74, y: 152 },
			{ path: paint.star("spark-b", 16, 4, 0.3, [255, 255, 255], { outline: 0, shade: 0 }), x: -70, y: 30 },
		],
	});
	await ok("bone_add", { project, bones: [{ name: "logo", x: 0, y: 90, space: "world" }, { name: "core", parent: "logo", x: 0, y: 90, space: "world" }] });
	for (const slot of ["ring", "badge", "spark-a", "spark-b"]) await ok("slot_update", { project, name: slot, bone: "logo" });
	await ok("slot_update", { project, name: "core", bone: "core" });
	const a = "appear";
	await ok("anim_create", { project, name: a, loop: false });
	for (const property of ["scalex", "scaley"])
		await ok("anim_bounce", { project, animation: a, bones: ["logo"], property, from: 0, to: 1, duration: 0.9, style: "spring", bounces: 3, height: 0.25 });
	await ok("anim_tween", { project, animation: a, bones: ["logo"], property: "rotate", from: -25, to: 0, duration: 0.7, ease: "back-out" });
	await ok("anim_tween", { project, animation: a, bones: ["core"], property: "rotate", from: 0, to: 72, start: 0.5, duration: 0.6, ease: "ease-in-out" });
	for (const slot of ["ring", "badge", "core"])
		await ok("anim_slot_keys", { project, animation: a, slot, property: "alpha", keys: [{ time: 0, value: 0, ease: "ease-out" }, { time: 0.25, value: 1 }] });
	for (const [slot, t] of [["spark-a", 0.8], ["spark-b", 0.95]] as const)
		await ok("anim_slot_keys", { project, animation: a, slot, property: "alpha", keys: [{ time: 0, value: 0 }, { time: t, value: 0, ease: "ease-out" }, { time: t + 0.15, value: 1, ease: "ease-in" }, { time: t + 0.5, value: 0 }] });
	await validated(ok, call, project, r);
	return r;
}

/** Constraint and image sequence timelines: a flipbook flame, keyed physics wind, a slider, a path and mix keys. */
async function lantern(ok: Ok, call: Ok, paint: Painter): Promise<AssetReport> {
	const project = "lantern";
	const r: AssetReport = {
		project,
		title: "Đèn lồng",
		prompt: "Đèn lồng đung đưa trong gió, lửa bập bùng, tua rua bay, đốm sáng chạy quanh.",
		animations: ["sway"],
		checks: [],
	};
	await ok("project_create", { name: project });
	await ok("image_import", {
		project,
		images: [
			{ path: paint.ellipse("glow", 120, 120, [255, 210, 120], { outline: 0, shade: 0 }), x: 0, y: 100 },
			{ path: paint.rect("cap", 50, 14, [120, 40, 30], 4), x: 0, y: 150 },
			{ path: paint.ellipse("body", 70, 90, [220, 60, 40], { shade: 0.3 }), x: 0, y: 100 },
			part(paint, "tassel", strip([0, 54], [0, 10], 10, 4), [240, 190, 60]),
			...["a", "b", "c"].map((n, i) => ({ path: paint.star(`spark-${n}`, 14, 4, 0.35, [255, 150, 30], { outline: 0, shade: 0 }), name: `spark-${n}`, x: -60 + 40 * i, y: 100 })),
		],
	});
	// Four flame frames, each a little taller or leaner.
	const flames = [[18, 30], [16, 36], [20, 28], [15, 34]].map(([w, h], i) => paint.ellipse(`flame-${i}`, w, h, [255, 240, 140], { outline: 0, shade: 0.2 }));
	await ok("bone_add", {
		project,
		bones: [
			{ name: "lantern", x: 0, y: 160, space: "world", length: 60, rotation: -90 },
			{ name: "flame", parent: "lantern", x: 0, y: 100, space: "world" },
			{ name: "glow", parent: "root", x: 0, y: 100, space: "world" },
			{ name: "tassel", parent: "lantern", x: 0, y: 54, space: "world", length: 44, rotation: -90 },
			{ name: "brightness", parent: "root", x: 120, y: 20, space: "world" },
		],
	});
	await ok("sequence_import", { project, name: "fire", images: flames, x: 0, y: 100, bone: "flame" });
	await ok("slot_update", { project, name: "fire", drawOrder: 3 });
	for (const slot of ["cap", "body"]) await ok("slot_update", { project, name: slot, bone: "lantern" });
	await ok("slot_update", { project, name: "tassel", bone: "tassel" });
	await ok("slot_update", { project, name: "glow", bone: "glow" });
	await ok("rig_template", { project, template: { kind: "chain", name: "spark", points: [{ x: -60, y: 100 }, { x: 60, y: 100 }], segments: 3 } });
	// Each spark sits on its bone's origin, so it rides the path exactly.
	for (const [i, n] of ["a", "b", "c"].entries()) await ok("slot_update", { project, name: `spark-${n}`, bone: `spark${i + 1}` });
	// The glow trails the flame (holder pattern from the examples, with a partial mix).
	await ok("constraint_add", {
		project,
		constraint: { type: "transform", name: "glow-follow", bones: ["glow"], source: "flame", properties: { x: { to: { x: {} } }, y: { to: { y: {} } } }, mixX: 0.6, mixY: 0.6 },
	});
	await ok("constraint_add", { project, constraint: { type: "physics", name: "tassel-sway", bone: "tassel", rotate: 1, inertia: 0.4, strength: 120, damping: 0.85, mass: 2.8 } });
	await ok("constraint_add", {
		project,
		constraint: {
			type: "path",
			name: "orbit",
			bones: ["spark1", "spark2", "spark3"],
			points: [{ x: 0, y: 175 }, { x: 70, y: 100 }, { x: 0, y: 25 }, { x: -70, y: 100 }],
			closed: true,
			pathBone: "lantern",
			spacingMode: "percent",
			spacing: 0.33,
		},
	});
	await ok("anim_create", { project, name: "flicker", loop: false });
	await ok("anim_slot_keys", { project, animation: "flicker", slot: "glow", property: "alpha", keys: [{ time: 0, value: 0.3 }, { time: 1, value: 1 }] });
	await ok("constraint_add", { project, constraint: { type: "slider", name: "light", animation: "flicker", time: 0.8 } });

	const a = "sway";
	await ok("anim_create", { project, name: a, loop: true });
	await ok("anim_oscillate", { project, animation: a, bones: ["lantern"], property: "rotate", amplitude: 8, period: 2, end: 2 });
	await ok("anim_sequence_keys", { project, animation: a, slot: "fire", keys: [{ time: 0, mode: "loop", delay: 1 / 12 }] });
	await ok("anim_constraint_keys", {
		project,
		animation: a,
		constraint: "tassel-sway",
		property: "wind",
		keys: [{ time: 0, value: 0, ease: "ease-in-out" }, { time: 1, value: 40, ease: "ease-in-out" }, { time: 2, value: 0 }],
	});
	await ok("anim_constraint_keys", { project, animation: a, constraint: "orbit", property: "position", keys: [{ time: 0, value: 0 }, { time: 2, value: 1 }] });
	await ok("anim_constraint_keys", {
		project,
		animation: a,
		constraint: "glow-follow",
		property: "mix",
		keys: [{ time: 0, mixX: 0.6, mixY: 0.6, ease: "ease-in-out" }, { time: 1, mixX: 1, mixY: 0.9, ease: "ease-in-out" }, { time: 2, mixX: 0.6, mixY: 0.6 }],
	});
	await ok("anim_constraint_keys", {
		project,
		animation: a,
		constraint: "light",
		property: "time",
		keys: [{ time: 0, value: 0.8, ease: "ease-in-out" }, { time: 0.5, value: 0.4, ease: "ease-in-out" }, { time: 1.2, value: 1, ease: "ease-in-out" }, { time: 2, value: 0.8 }],
	});
	await validated(ok, call, project, r);
	return r;
}

export const ASSETS = { hero, dragon, tree, chest, car, logo, lantern };

export async function buildAll(outDir: string): Promise<AssetReport[]> {
	const { root, ok, call } = await connect();
	const paint = new Painter(join(root, "art"));
	const reports: AssetReport[] = [];
	for (const build of Object.values(ASSETS)) {
		const report = await build(ok, call, paint);
		for (const animation of report.animations) {
			const shot = await call("preview", { project: report.project, animation, frames: 8, showBones: false });
			report.checks.push({ name: `preview ${animation}`, ok: !shot.isError, detail: shot.text });
		}
		const out = join(outDir, report.project);
		const e = await call("export", { project: report.project, outDir: out });
		report.checks.push({ name: "export", ok: !e.isError, detail: e.text });
		cpSync(join(root, report.project, "previews"), join(out, "previews"), { recursive: true });
		reports.push(report);
	}
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, "report.json"), `${JSON.stringify(reports, null, 2)}\n`);
	// The studio page for these assets; studio.html is the fragment for publishing, studio-local.html opens directly.
	const extras = Object.fromEntries(reports.map((r) => [r.project, r]));
	const subtitle = "Seven acceptance assets, rigged and animated through the rydspine MCP tools";
	writeFileSync(join(outDir, "studio.html"), render(collect(extras), { player: "cdn", document: false, subtitle }));
	writeFileSync(join(outDir, "studio-local.html"), render(collect(extras), { player: "cdn", document: true, subtitle }));
	return reports;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const out = resolve(process.argv[2] ?? "acceptance/out");
	const reports = await buildAll(out);
	for (const r of reports) {
		console.log(`\n${r.title} (${r.project}): ${r.prompt}`);
		for (const c of r.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail.split("\n")[0]}`);
	}
	console.log(`\nwritten to ${out}`);
	process.exit(reports.every((r) => r.checks.every((c) => c.ok)) ? 0 : 1);
}
