// Renders the animated showcase at the top of README.md (.github/readme/showcase.gif) from four acceptance
// assets, whose art is drawn in code by acceptance/build.ts. Every frame of a panel shares one bounding box, so
// nothing jitters; frames are drawn with rydspine's own preview renderer, physics included.
// Usage: npm run acceptance && npm run showcase   (needs Playwright's Chromium and ffmpeg)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { renderSvg } from "../src/preview.js";
import { load } from "../src/runtime.js";
import { createServer } from "../src/server.js";
import { Workspace } from "../src/workspace.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const OUT = join(ROOT, ".github", "readme", "showcase.gif");
const FPS = 12;
const PANEL = { width: 340, height: 210 };
/** Each cycle (animation plus the hold on its last frame) divides the GIF length, so every panel loops cleanly. */
const LENGTH = 8;
const PANELS = [
	{ asset: "hero", animation: "run-stop-swing", loop: false, hold: 1.6 },
	{ asset: "dragon", animation: "fly", loop: true, hold: 0 },
	{ asset: "chest", animation: "open", loop: false, hold: 0.8 },
	{ asset: "crab", animation: "wave", loop: true, hold: 0 },
];
const LABEL = 18; // the time label band at the top of a preview strip (src/preview.ts)

process.env.RYDSPINE_WORKSPACES = mkdtempSync(join(tmpdir(), "rydspine-showcase-"));
const [a, b] = InMemoryTransport.createLinkedPair();
await createServer().connect(a);
const client = new Client({ name: "showcase", version: "0" });
await client.connect(b);

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
const frames = mkdtempSync(join(tmpdir(), "rydspine-frames-"));

for (const [i, p] of PANELS.entries()) {
	const dir = join(ROOT, "acceptance", "out", p.asset);
	const r = (await client.callTool({
		name: "project_import",
		arguments: { name: p.asset, skeleton: join(dir, `${p.asset}.json`), images: join(dir, "images"), loops: p.loop ? [p.animation] : [] },
	})) as { isError?: boolean; content: { text?: string }[] };
	if (r.isError) throw new Error(`${p.asset}: ${r.content[0]?.text} (run npm run acceptance first)`);
	const ws = Workspace.open(p.asset);
	const duration = load(ws).data.findAnimation(p.animation)!.duration;
	const cycle = duration + p.hold;
	if (Math.abs(LENGTH / cycle - Math.round(LENGTH / cycle)) > 1e-6) throw new Error(`${p.asset}: cycle ${cycle}s does not divide ${LENGTH}s`);
	const times = Array.from({ length: Math.round(cycle * FPS) }, (_, k) => Math.min(k / FPS, duration));
	const svg = renderSvg(ws, { animation: p.animation, times, showBones: false });
	// The preview draws one cell per distinct frame (held frames share one), in play order, w wide.
	const cells = [...new Set(times.map((t) => Math.round(t * 30)))].sort((x, y) => x - y);
	const [w, h] = svg.match(/<rect x="0" y="0" width="([\d.]+)" height="([\d.]+)" class="cell"\/>/)!.slice(1).map(Number);
	const height = h - LABEL;
	mkdirSync(join(frames, `${i}`));
	for (let k = 0; k < times.length; k++) {
		// Show one cell at its own aspect ratio (letterboxing would reveal the neighbors), inset past its border,
		// without the time label; ffmpeg fits it into the panel.
		const x = cells.indexOf(Math.round(times[k] * 30)) * w;
		const cell = svg.replace(/^<svg([^>]*) width="\d+" height="\d+"/, `<svg$1 width="${w - 2}" height="${height - 2}" viewBox="${x + 1} ${LABEL + 1} ${w - 2} ${height - 2}"`);
		await page.setContent(`<html><body style="margin:0;background:#f4f4f4">${cell}</body></html>`);
		await page.locator("svg").screenshot({ path: join(frames, `${i}`, `${String(k).padStart(3, "0")}.png`) });
	}
	console.log(`${p.asset} ${p.animation}: ${times.length} frames`);
}
await browser.close();
await client.close();

// Loop each panel over the GIF length (limited per input: palettegen waits for its input to end), tile them
// 2 x 2, then build a palette for a small GIF.
const inputs = PANELS.flatMap((_, i) => ["-stream_loop", "-1", "-framerate", `${FPS}`, "-t", `${LENGTH}`, "-i", join(frames, `${i}`, "%03d.png")]);
const tiles = PANELS.map((_, i) => `[${i}:v]scale=${PANEL.width}:${PANEL.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${PANEL.width}:${PANEL.height}:-1:-1:color=0xf4f4f4,setsar=1[p${i}]`).join(";");
const filter = `${tiles};[p0][p1][p2][p3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[pal];[s1][pal]paletteuse=dither=none:diff_mode=rectangle`;
mkdirSync(join(OUT, ".."), { recursive: true });
const ff = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter, "-t", `${LENGTH}`, "-r", `${FPS}`, "-loop", "0", OUT], { encoding: "utf8" });
if (ff.status !== 0) throw new Error(`ffmpeg failed (status ${ff.status}, signal ${ff.signal}): ${ff.stderr || ff.error || ""}; frames kept in ${frames}`);
rmSync(frames, { recursive: true, force: true });
console.log(`wrote ${OUT}`);
process.exit(0);
