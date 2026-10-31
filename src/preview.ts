// Preview: renders posed frames to SVG (and PNG through a headless browser when available),
// and exports a self-contained HTML page running the official Spine web player.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ClippingAttachment, MeshAttachment, RegionAttachment } from "@esotericsoftware/spine-core";
import { composePage, imageSize, pack } from "./atlas.js";
import { FPS, type Loaded, load, play } from "./runtime.js";
import { UserError, type Workspace } from "./workspace.js";

const require = createRequire(import.meta.url);
const FRAME_PAD = 30;
const LABEL = 18;

interface Frame {
	time: number;
	body: string;
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const f2 = (n: number) => Math.round(n * 100) / 100;

function affine(p: number[][], q: number[][]): string {
	// Solve M with M * p[i] = q[i] for three points (image px -> svg px).
	const [p0, p1, p2] = p;
	const [q0, q1, q2] = q;
	const ux = p1[0] - p0[0], uy = p1[1] - p0[1], vx = p2[0] - p0[0], vy = p2[1] - p0[1];
	const det = ux * vy - vx * uy;
	if (Math.abs(det) < 1e-9) return "";
	const ix = [vy / det, -uy / det], iy = [-vx / det, ux / det];
	const qx = [q1[0] - q0[0], q2[0] - q0[0]], qy = [q1[1] - q0[1], q2[1] - q0[1]];
	const a = qx[0] * ix[0] + qx[1] * ix[1], c = qx[0] * iy[0] + qx[1] * iy[1];
	const b = qy[0] * ix[0] + qy[1] * ix[1], d = qy[0] * iy[0] + qy[1] * iy[1];
	const e = q0[0] - a * p0[0] - c * p0[1], f = q0[1] - b * p0[0] - d * p0[1];
	return `matrix(${[a, b, c, d, e, f].map((n) => n.toFixed(5)).join(",")})`;
}

/** SVG-safe ids for image names, which may contain folders and spaces. */
function imageIds(ws: Workspace): Map<string, string> {
	return new Map(ws.imageNames().map((name, i) => [name, `img${i}`]));
}

function drawFrame(
	ws: Workspace,
	loaded: Loaded,
	time: number,
	showBones: boolean,
	clipIds: { n: number },
	ids: Map<string, string>,
): Frame {
	const { skeleton } = loaded;
	const parts: string[] = [];
	const xs: number[] = [];
	const ys: number[] = [];
	const pt = (x: number, y: number) => {
		xs.push(x);
		ys.push(-y);
		return [x, -y];
	};
	let clipEnd: unknown = null;
	const alpha = skeleton.color.a;
	for (const slot of skeleton.drawOrder.appliedPose) {
		const att = slot.appliedPose.getAttachment();
		const a = alpha * slot.appliedPose.color.a;
		const opacity = a < 0.999 ? ` opacity="${f2(Math.max(0, a))}"` : "";
		if (att instanceof ClippingAttachment) {
			if (clipEnd) parts.push("</g>");
			const n = att.worldVerticesLength;
			const v = new Array<number>(n);
			att.computeWorldVertices(skeleton, slot, 0, n, v, 0, 2);
			const poly: string[] = [];
			for (let i = 0; i < n; i += 2) poly.push(pt(v[i], v[i + 1]).map(f2).join(","));
			const id = `c${clipIds.n++}`;
			parts.push(`<clipPath id="${id}"><polygon points="${poly.join(" ")}"/></clipPath><g clip-path="url(#${id})">`);
			clipEnd = att.endSlot ?? "end";
		} else if (att instanceof RegionAttachment) {
			const v = new Array<number>(8);
			att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
			const { width, height } = imageSize(join(ws.imagesDir, `${att.path}.png`));
			const [bl, ul, ur] = [pt(v[0], v[1]), pt(v[2], v[3]), pt(v[4], v[5])];
			pt(v[6], v[7]);
			const m = affine([[0, 0], [width, 0], [0, height]], [ul, ur, bl]);
			if (m) parts.push(`<use href="#${ids.get(att.path!)}" transform="${m}"${opacity}/>`);
		} else if (att instanceof MeshAttachment) {
			const n = att.worldVerticesLength;
			const v = new Array<number>(n);
			att.computeWorldVertices(skeleton, slot, 0, n, v, 0, 2);
			const { width, height } = imageSize(join(ws.imagesDir, `${att.path}.png`));
			const uv = att.regionUVs;
			const t = att.triangles;
			for (let i = 0; i < t.length; i += 3) {
				const q = [t[i], t[i + 1], t[i + 2]].map((k) => pt(v[k * 2], v[k * 2 + 1]));
				const p = [t[i], t[i + 1], t[i + 2]].map((k) => [uv[k * 2] * width, uv[k * 2 + 1] * height]);
				const m = affine(p, q);
				if (!m) continue;
				const id = `c${clipIds.n++}`;
				const poly = q.map(([x, y]) => `${f2(x)},${f2(y)}`).join(" ");
				parts.push(
					`<clipPath id="${id}"><polygon points="${poly}" stroke="#000" stroke-width="0.6"/></clipPath>` +
						`<g clip-path="url(#${id})"><use href="#${ids.get(att.path!)}" transform="${m}"${opacity}/></g>`,
				);
			}
		}
		if (clipEnd === slot.data) {
			parts.push("</g>");
			clipEnd = null;
		}
	}
	if (clipEnd) parts.push("</g>");
	if (showBones) {
		for (const bone of skeleton.bones) {
			const p = bone.appliedPose;
			const [x0, y0] = pt(p.worldX, p.worldY);
			const len = bone.data.length;
			if (len > 0) {
				const [x1, y1] = pt(p.worldX + p.a * len, p.worldY + p.c * len);
				parts.push(`<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="bone"/>`);
			}
			parts.push(`<circle cx="${f2(x0)}" cy="${f2(y0)}" r="2.5" class="joint"/>`);
		}
	}
	return { time, body: parts.join(""), minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export interface PreviewSpec {
	animation?: string;
	frames?: number;
	times?: number[];
	showBones?: boolean;
	skin?: string;
}

export function renderSvg(ws: Workspace, spec: PreviewSpec): string {
	const loaded = load(ws);
	if (spec.skin) {
		if (!loaded.data.findSkin(spec.skin)) throw new UserError(`skin "${spec.skin}" not found`);
		loaded.skeleton.setSkin(spec.skin);
	}
	const clipIds = { n: 0 };
	const ids = imageIds(ws);
	const showBones = spec.showBones ?? true;
	const frames: Frame[] = [];
	if (!spec.animation) {
		frames.push(drawFrame(ws, loaded, 0, showBones, clipIds, ids));
	} else {
		const animation = loaded.data.findAnimation(spec.animation);
		if (!animation) throw new UserError(`animation "${spec.animation}" not found`);
		const duration = animation.duration;
		const count = Math.max(1, Math.min(spec.frames ?? 6, 24));
		const times = spec.times ?? Array.from({ length: count }, (_, i) => (count === 1 ? 0 : (duration * i) / (count - 1)));
		const wanted = new Map(times.map((t) => [Math.round(t * FPS), t]));
		const last = Math.max(...wanted.keys());
		const visit = (frame: number) => {
			const t = wanted.get(frame);
			if (t !== undefined) frames.push(drawFrame(ws, loaded, t, showBones, clipIds, ids));
		};
		play(loaded, spec.animation, last, visit, ws.meta.loops[spec.animation] ?? false);
	}
	const minX = Math.min(...frames.map((f) => f.minX)) - FRAME_PAD;
	const minY = Math.min(...frames.map((f) => f.minY)) - FRAME_PAD;
	const w = Math.max(...frames.map((f) => f.maxX)) + FRAME_PAD - minX;
	const h = Math.max(...frames.map((f) => f.maxY)) + FRAME_PAD - minY;
	const defs = ws
		.imageNames()
		.map((name) => {
			const data = readFileSync(join(ws.imagesDir, `${name}.png`)).toString("base64");
			const { width, height } = imageSize(join(ws.imagesDir, `${name}.png`));
			return `<image id="${ids.get(name)}" width="${width}" height="${height}" href="data:image/png;base64,${data}"/>`;
		})
		.join("");
	const cells = frames
		.map((f, i) => {
			const ox = i * w - minX;
			const oy = LABEL - minY;
			return (
				`<g transform="translate(${f2(ox)},${f2(oy)})">${f.body}</g>` +
				`<text x="${f2(i * w + 6)}" y="13">${spec.animation ? `t=${f.time.toFixed(2)}s` : "setup pose"}</text>` +
				`<rect x="${f2(i * w)}" y="0" width="${f2(w)}" height="${f2(h + LABEL)}" class="cell"/>`
			);
		})
		.join("");
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w * frames.length)}" height="${Math.ceil(h + LABEL)}">` +
		`<style>.bone{stroke:#e0306a;stroke-width:2}.joint{fill:#fff;stroke:#e0306a;stroke-width:1.5}` +
		`.cell{fill:none;stroke:#ccc}text{font:12px sans-serif;fill:#555}</style>` +
		`<defs>${defs}</defs><rect width="100%" height="100%" fill="#f4f4f4"/>${cells}</svg>`
	);
}

/** Rasterizes SVG with the preinstalled Playwright Chromium, or returns null if it is unavailable. */
export async function rasterize(svg: string): Promise<Buffer | null> {
	let chromium: { launch: () => Promise<any> };
	try {
		({ chromium } = require("playwright"));
	} catch {
		return null;
	}
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
		return await page.locator("svg").screenshot();
	} finally {
		await browser.close();
	}
}

export function exportProject(ws: Workspace, outDir?: string): { dir: string; files: string[] } {
	const dir = outDir ?? join(ws.dir, "export");
	mkdirSync(dir, { recursive: true });
	const name = ws.meta.name;
	const packed = pack(ws.imagesDir, ws.imageNames(), `${name}.png`);
	const page = composePage(ws.imagesDir, packed);
	// Runtimes use the atlas; Spine Editor's Import Data reads the loose images next to the JSON.
	const doc = { ...ws.doc, skeleton: { ...ws.doc.skeleton, hash: `rydspine-v${ws.meta.version}`, images: "./images/" } };
	cpSync(ws.imagesDir, join(dir, "images"), { recursive: true });
	const json = `${JSON.stringify(doc, null, 2)}\n`;
	writeFileSync(join(dir, `${name}.json`), json);
	writeFileSync(join(dir, `${name}.atlas`), packed.text);
	writeFileSync(join(dir, `${name}.png`), page);
	writeFileSync(join(dir, `${name}.html`), playerHtml(ws, json, packed.text, page));
	return { dir, files: [`${name}.json`, `${name}.atlas`, `${name}.png`, `${name}.html`, "images/"] };
}

function playerHtml(ws: Workspace, json: string, atlas: string, page: Buffer): string {
	const name = ws.meta.name;
	const playerDir = join(require.resolve("@esotericsoftware/spine-player/package.json"), "..", "dist");
	const js = readFileSync(join(playerDir, "iife", "spine-player.min.js"), "utf8");
	const css = readFileSync(join(playerDir, "spine-player.min.css"), "utf8");
	const anims = Object.keys(ws.doc.animations);
	const config = {
		skeleton: `${name}.json`,
		atlas: `${name}.atlas`,
		rawDataURIs: {
			[`${name}.json`]: `data:application/json;base64,${Buffer.from(json).toString("base64")}`,
			[`${name}.atlas`]: `data:text/plain;base64,${Buffer.from(atlas).toString("base64")}`,
			[`${name}.png`]: `data:image/png;base64,${page.toString("base64")}`,
		},
		animation: anims[0],
		showControls: true,
		backgroundColor: "#2b2b2bff",
		preserveDrawingBuffer: true,
	};
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} preview</title>
<style>${css}
html,body{margin:0;height:100%;background:#2b2b2b}#player{width:100%;height:100%}</style>
</head>
<body>
<div id="player"></div>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
<script>
window.playerReady = false;
new spine.SpinePlayer("player", Object.assign(${JSON.stringify(config)}, {
  success: function () { window.playerReady = true; },
  error: function (p, msg) { window.playerError = msg; }
}));
</script>
</body>
</html>
`;
}
