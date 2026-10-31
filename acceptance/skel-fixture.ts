// Builds test/fixtures/features: a small skeleton that uses every constraint kind and image sequences, imported
// into the real Spine Editor and exported as both .skel and .json, so the .skel reader can be tested against
// files Spine itself wrote. Needs Spine (see spine-check.ts).
//
// Usage: npx tsx acceptance/skel-fixture.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spineOrder } from "../src/workspace.js";
import { launcher, spine } from "./spine-check.js";

const OUT = resolve("test/fixtures/features");

const square = (w: number, h: number) => ({ width: w, height: h });

const doc = {
	skeleton: { spine: "4.3.26", images: "./images/" },
	bones: [
		{ name: "root" },
		{ name: "driver", parent: "root", x: -120, y: 40, length: 50 },
		{ name: "follower", parent: "root", x: 120, y: 40, length: 50 },
		{ name: "local", parent: "follower", x: 30, y: 30, length: 30 },
		{ name: "path-bone", parent: "root", y: -60 },
		{ name: "chain1", parent: "root", x: -100, y: -60, length: 40 },
		{ name: "chain2", parent: "chain1", x: 40, length: 40 },
		{ name: "chain3", parent: "chain2", x: 40, length: 40 },
		{ name: "dial", parent: "root", y: 140, length: 40 },
		{ name: "lamp", parent: "root", x: 80, y: 140 },
		{ name: "flame", parent: "root", x: -80, y: 140 },
	],
	slots: [
		{ name: "driver", bone: "driver", attachment: "box" },
		{ name: "follower", bone: "follower", attachment: "box" },
		{ name: "local", bone: "local", attachment: "box" },
		{ name: "path", bone: "path-bone", attachment: "curve" },
		{ name: "chain1", bone: "chain1", attachment: "box" },
		{ name: "chain2", bone: "chain2", attachment: "box" },
		{ name: "chain3", bone: "chain3", attachment: "box" },
		{ name: "lamp", bone: "lamp", attachment: "lamp" },
		{ name: "flame", bone: "flame", attachment: "flame" },
		{ name: "flame-copy", bone: "flame", attachment: "flame" },
	],
	constraints: [
		{
			type: "transform",
			name: "follow",
			bones: ["follower"],
			source: "driver",
			properties: {
				rotate: { to: { rotate: { scale: 0.5 }, shearY: { scale: 0.2, offset: 5, max: 30 } } },
				x: { offset: 10, to: { x: { max: 200 }, y: { scale: 0.3, max: 200 } } },
				scaleX: { to: { scaleX: {}, scaleY: { scale: 0.5 } } },
			},
			rotation: 15,
			x: 240,
			mixRotate: 0.8,
			mixX: 0.6,
			mixY: 0.4,
			mixScaleX: 0.7,
			mixShearY: 0.5,
		},
		{
			type: "transform",
			name: "local-follow",
			bones: ["local"],
			source: "driver",
			localSource: true,
			localTarget: true,
			additive: true,
			clamp: true,
			properties: { rotate: { to: { rotate: { max: 45 } } }, y: { to: { y: { max: 20 } } } },
			mixY: 0.5,
		},
		{
			type: "path",
			name: "chain",
			bones: ["chain1", "chain2", "chain3"],
			slot: "path",
			spacingMode: "percent",
			rotateMode: "chainScale",
			rotation: 10,
			position: 0.1,
			spacing: 0.25,
			mixRotate: 0.9,
			mixX: 0.8,
		},
		{ type: "slider", name: "lamp-slider", animation: "lamp-glow", loop: true, time: 0.25 },
		{
			type: "slider",
			name: "dial-slider",
			animation: "flame-flicker",
			bone: "dial",
			property: "rotate",
			from: 10,
			to: 0.1,
			scale: 0.01,
			mix: 0.75,
			additive: true,
		},
	],
	skins: [
		{
			name: "default",
			attachments: {
				driver: { box: square(40, 40) },
				follower: { box: square(40, 40) },
				local: { box: square(20, 20) },
				path: {
					curve: {
						type: "path",
						vertexCount: 6,
						vertices: [-140, -20, -100, 0, -60, 20, 0, 40, 60, 20, 100, 0],
						lengths: [120, 240],
					},
				},
				chain1: { box: square(40, 10) },
				chain2: { box: square(40, 10) },
				chain3: { box: square(40, 10) },
				lamp: { lamp: { ...square(30, 30), path: "lamp/glow", sequence: { count: 4, start: 1, digits: 2, setup: 1 } } },
				flame: {
					flame: {
						type: "mesh",
						path: "flame/f",
						sequence: { count: 3, start: 0 },
						uvs: [0, 1, 1, 1, 1, 0, 0, 0],
						triangles: [0, 1, 2, 2, 3, 0],
						vertices: [-15, -20, 15, -20, 15, 20, -15, 20],
						hull: 4,
						edges: [0, 2, 2, 4, 4, 6, 6, 0],
						width: 30,
						height: 40,
					},
				},
				"flame-copy": { flame: { type: "linkedmesh", slot: "flame", source: "flame", path: "flame/f", sequence: { count: 3, start: 0 }, width: 30, height: 40 } },
			},
		},
	],
	animations: {
		move: {
			bones: {
				driver: {
					rotate: [{ value: 0, curve: [0.25, 0, 0.75, 90] }, { time: 1, value: 90 }, { time: 2, value: 0 }],
					translate: [{ x: 0 }, { time: 1, x: 60, y: 20 }, { time: 2 }],
					scale: [{}, { time: 1, x: 1.5 }, { time: 2 }],
				},
				dial: { rotate: [{}, { time: 2, value: 360 }] },
			},
			transform: {
				follow: [
					{ mixRotate: 0.8, mixX: 0.6, mixY: 0.4, mixScaleX: 0.7, mixShearY: 0.5, curve: [0.5, 0.8, 0.75, 0.2, 0.5, 0.6, 0.75, 1, 0.5, 0.4, 0.75, 0, 0.5, 0.7, 0.75, 0.3, 0.5, 1, 0.75, 1, 0.5, 0.5, 0.75, 1] },
					{ time: 1, mixRotate: 0.2, mixX: 1, mixY: 0, mixScaleX: 0.3, mixScaleY: 1, mixShearY: 1 },
					{ time: 2, mixRotate: 0.8, mixX: 0.6, mixY: 0.4, mixScaleX: 0.7, mixShearY: 0.5 },
				],
			},
			path: {
				chain: {
					position: [{ value: 0.1, curve: [0.5, 0.1, 0.75, 0.6] }, { time: 1, value: 0.6 }, { time: 2, value: 0.1 }],
					spacing: [{ value: 0.25 }, { time: 1, value: 0.1, curve: "stepped" }, { time: 2, value: 0.25 }],
					mix: [{ mixRotate: 0.9, mixX: 0.8 }, { time: 1, mixRotate: 0.3, mixX: 0.5, mixY: 1 }, { time: 2, mixRotate: 0.9, mixX: 0.8 }],
				},
			},
			slider: {
				"lamp-slider": {
					time: [{ value: 0.25 }, { time: 1, value: 0.9, curve: [1.25, 0.9, 1.75, 0.25] }, { time: 2, value: 0.25 }],
					mix: [{}, { time: 1, value: 0.5 }, { time: 2 }],
				},
				"dial-slider": { mix: [{ value: 0.75 }, { time: 2, value: 0.25 }] },
			},
			attachments: {
				default: {
					lamp: { lamp: { sequence: [{ mode: "loop", delay: 0.1 }, { time: 1, mode: "pingpong", index: 1 }, { time: 1.5, mode: "onceReverse", delay: 0.2 }] } },
					flame: { flame: { sequence: [{ mode: "loopReverse", delay: 0.0667 }, { time: 1.2, mode: "hold", index: 2 }] } },
				},
			},
		},
		"lamp-glow": {
			slots: { lamp: { rgba: [{ color: "ffffffff" }, { time: 1, color: "ff8040a0" }] } },
			attachments: { default: { lamp: { lamp: { sequence: [{ mode: "loop", delay: 0.25 }] } } } },
		},
		"flame-flicker": {
			bones: { flame: { scale: [{}, { time: 0.5, x: 1.2, y: 0.8 }, { time: 1 }] } },
			attachments: { default: { flame: { flame: { sequence: [{ mode: "pingpong", delay: 0.1 }] } } } },
		},
	},
};

// Spine sorts animations on import but keeps slider animations by file index, so write them in Spine's order.
doc.animations = Object.fromEntries(spineOrder(Object.keys(doc.animations)).map((n) => [n, doc.animations[n as keyof typeof doc.animations]])) as typeof doc.animations;

const base = launcher();
if (!base) {
	console.log("skipped: set SPINE_CLI to the Spine launcher, or SPINE_ACTIVATION_CODE on Linux");
	process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), "rydspine-fixture-"));
const input = join(work, "features.json");
writeFileSync(input, JSON.stringify(doc, null, "\t"));
const project = join(work, "features.spine");
spine(base, ["-i", input, "-o", project, "-r"]);
mkdirSync(OUT, { recursive: true });
for (const format of ["json", "binary"]) spine(base, ["-i", project, "-o", OUT, "--set", "nonessential=true", "-e", format]);
console.log(`written to ${OUT}`);
