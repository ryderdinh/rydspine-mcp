// rydspine studio: a web view of the workspaces. Plays every animation with the official Spine player,
// and shows the rig, checks, versions and frame previews. Served live by `npm run ui` (or the ui_open
// tool), or written as one static page with `npm run ui -- --static out.html`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { composePage, pack } from "./atlas.js";
import { describe } from "./rig.js";
import { load, validate } from "./runtime.js";
import { Workspace, workspacesRoot } from "./workspace.js";

const require = createRequire(import.meta.url);
const PLAYER_VERSION = "4.3.13";
const PLAYER_CDN = `https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@${PLAYER_VERSION}/dist/iife/spine-player.min.js`;

export interface Extra {
	title?: string;
	prompt?: string;
	checks?: { name: string; ok: boolean; detail: string }[];
}

interface ProjectView {
	name: string;
	title: string;
	prompt?: string;
	version: number;
	rig: string;
	ok: boolean;
	checks: { name: string; ok: boolean; detail: string }[];
	animations: { name: string; loop: boolean; duration: number; preview?: string }[];
	history: { version: number; time: string; message: string }[];
	counts: { bones: number; slots: number; constraints: number };
	files: { json: string; atlas: string; png: string };
}

const dataUri = (mime: string, data: Buffer | string) => `data:${mime};base64,${Buffer.from(data).toString("base64")}`;

function latestPreview(ws: Workspace, animation: string): string | undefined {
	const dir = join(ws.dir, "previews");
	if (!existsSync(dir)) return undefined;
	const match = readdirSync(dir)
		.filter((f) => f.endsWith(`-${animation}.png`) && /^v\d+-/.test(f))
		.sort((a, b) => Number(b.slice(1).split("-")[0]) - Number(a.slice(1).split("-")[0]))[0];
	return match ? dataUri("image/png", readFileSync(join(dir, match))) : undefined;
}

export function collect(extras: Record<string, Extra> = {}): ProjectView[] {
	return Workspace.list().map((name) => {
		const ws = Workspace.open(name);
		const extra = extras[name] ?? {};
		const report = validate(ws);
		const checks = [
			{ name: "Spine runtime check", ok: report.ok, detail: [...report.errors, ...report.warnings, ...report.info].join("\n") },
			...(extra.checks ?? []).filter((c) => c.name !== "validate" && !c.name.startsWith("preview") && c.name !== "export"),
		];
		const loaded = report.ok ? load(ws) : null;
		const packed = pack(ws.imagesDir, ws.imageNames(), `${name}.png`);
		const doc = { ...ws.doc, skeleton: { ...ws.doc.skeleton, hash: `rydspine-v${ws.meta.version}` } };
		return {
			name,
			title: extra.title ?? name,
			prompt: extra.prompt,
			version: ws.meta.version,
			rig: describe(ws),
			ok: checks.every((c) => c.ok),
			checks,
			animations: Object.keys(ws.doc.animations).map((a) => ({
				name: a,
				loop: !!ws.meta.loops[a],
				duration: loaded?.data.findAnimation(a)?.duration ?? 0,
				preview: latestPreview(ws, a),
			})),
			history: ws.history().reverse().slice(0, 12),
			counts: { bones: ws.doc.bones.length, slots: ws.doc.slots.length, constraints: ws.doc.constraints.length },
			files: {
				json: dataUri("application/json", JSON.stringify(doc)),
				atlas: dataUri("text/plain", packed.text),
				png: dataUri("image/png", composePage(ws.imagesDir, packed)),
			},
		};
	});
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RenderOptions {
	/** "cdn" for a published page, "local" when served by the studio server (works offline). */
	player: "cdn" | "local";
	/** Wrap in a full HTML document (the artifact host adds its own). */
	document: boolean;
	subtitle?: string;
}

export function render(projects: ProjectView[], opts: RenderOptions): string {
	const css = readFileSync(join(require.resolve("@esotericsoftware/spine-player/package.json"), "..", "dist", "spine-player.min.css"), "utf8");
	const data = JSON.stringify(projects).replace(/</g, "\\u003c");
	const playerSrc = opts.player === "cdn" ? PLAYER_CDN : "/spine-player.js";
	const page = `<title>rydspine studio</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
${css}
/* Layout: a workbench. Project rail on top, the stage (player) beside an inspector, frame strips below. */
:root {
	--bg: #eef0f4; --surface: #ffffff; --sunk: #e4e7ee; --ink: #1a1d26; --muted: #5a6172; --line: #d6dae3;
	--bone: #d12a5e; --bone-soft: #f9dbe5; --good: #23794d; --good-soft: #dcf1e5; --bad: #b8322a; --bad-soft: #f8dedb;
	--stage: #2a2d36;
	--display: "Bricolage Grotesque", "Avenir Next", "Segoe UI", sans-serif;
	--body: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
	--mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
	--bg: #111319; --surface: #1a1d25; --sunk: #232733; --ink: #e9ebf1; --muted: #9ba2b3; --line: #2c303c;
	--bone: #ff5a8c; --bone-soft: #43202d; --good: #5fcf92; --good-soft: #17352a; --bad: #ff7b70; --bad-soft: #3e1d1b;
	--stage: #0b0d12; color-scheme: dark;
} }
:root[data-theme="dark"] {
	--bg: #111319; --surface: #1a1d25; --sunk: #232733; --ink: #e9ebf1; --muted: #9ba2b3; --line: #2c303c;
	--bone: #ff5a8c; --bone-soft: #43202d; --good: #5fcf92; --good-soft: #17352a; --bad: #ff7b70; --bad-soft: #3e1d1b;
	--stage: #0b0d12; color-scheme: dark;
}
body { background: var(--bg); color: var(--ink); font: 15px/1.5 var(--body); }
.wrap { max-width: 1240px; margin: 0 auto; padding-block: 24px 48px;
	padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
	display: grid; gap: 20px; }
header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 24px; }
h1 { font: 700 1.75rem/1.1 var(--display); margin: 0; letter-spacing: -0.01em; }
h1 .dot { color: var(--bone); }
.sub { color: var(--muted); margin: 0; }
.rail { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.chip { flex: none; display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px;
	border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: 500 0.9rem var(--body); cursor: pointer; }
.chip:hover { border-color: var(--bone); }
.chip[aria-current="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.chip:focus-visible, .anim:focus-visible { outline: 2px solid var(--bone); outline-offset: 2px; }
.state { width: 8px; height: 8px; border-radius: 50%; background: var(--good); }
.state.bad { background: var(--bad); }
.bench { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 860px) { .bench { grid-template-columns: minmax(0, 1fr); } }
.stage { background: var(--stage); border-radius: 14px; overflow: hidden; display: grid; }
#player { height: clamp(320px, 52vh, 520px); }
.anims { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; background: var(--surface); border-top: 1px solid var(--line); }
.anim { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line);
	background: var(--bg); color: var(--ink); font: 500 0.875rem var(--body); cursor: pointer; }
.anim[aria-pressed="true"] { border-color: var(--bone); background: var(--bone-soft); }
.anim small { font: 400 0.75rem var(--mono); color: var(--muted); }
.panel { display: grid; gap: 16px; min-width: 0; }
.prompt { margin: 0; font: 500 1.15rem/1.35 var(--display); text-wrap: balance; }
.label { font: 600 0.72rem var(--body); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 6px; }
.facts { display: flex; flex-wrap: wrap; gap: 6px 16px; font: 0.85rem var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.facts b { color: var(--ink); font-weight: 500; }
.checks { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.check { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; align-items: start; padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); }
.pill { font: 600 0.7rem var(--body); letter-spacing: 0.06em; padding: 2px 8px; border-radius: 999px; background: var(--good-soft); color: var(--good); }
.pill.bad { background: var(--bad-soft); color: var(--bad); }
.check strong { font-weight: 500; font-size: 0.9rem; }
.check pre { grid-column: 2; margin: 0; white-space: pre-wrap; font: 0.78rem/1.45 var(--mono); color: var(--muted); }
details { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
summary { cursor: pointer; padding: 8px 10px; font: 500 0.9rem var(--body); }
details pre { margin: 0; padding: 0 10px 10px; overflow-x: auto; font: 0.78rem/1.5 var(--mono); color: var(--ink); }
.history { list-style: none; margin: 0; padding: 0 10px 10px; display: grid; gap: 2px; font: 0.8rem var(--mono); }
.history span { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 8px; }
.strips { display: grid; gap: 12px; }
.strip { margin: 0; display: grid; gap: 6px; }
.strip figcaption { font: 500 0.85rem var(--body); color: var(--muted); }
.strip .scroll { overflow-x: auto; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); }
.strip img { max-width: none; height: 160px; display: block; }
.note { color: var(--muted); font-size: 0.85rem; margin: 0; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>
<div class="wrap">
	<header>
		<h1>rydspine<span class="dot">.</span>studio</h1>
		<p class="sub">${esc(opts.subtitle ?? "Spine 4.3 rigs and animations built through the rydspine MCP")}</p>
	</header>
	<nav class="rail" id="rail" aria-label="Projects"></nav>
	<section class="bench">
		<div class="stage">
			<div id="player"></div>
			<div class="anims" id="anims" role="group" aria-label="Animations"></div>
		</div>
		<div class="panel" id="panel"></div>
	</section>
	<section class="strips" id="strips" aria-label="Frame previews"></section>
	<p class="note">Played by the official Spine web player ${PLAYER_VERSION}. Each project exports as skeleton JSON, atlas and PNG; open the JSON in Spine with File → Import Data.</p>
</div>
<script id="projects" type="application/json">${data}</script>
<script src="${playerSrc}"></script>
<script>
(() => {
	const projects = JSON.parse(document.getElementById("projects").textContent);
	const $ = (id) => document.getElementById(id);
	const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
	let player = null;
	let current = null;

	function playerBackground() {
		const c = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#2a2d36";
		return c.length === 7 ? c + "ff" : c;
	}

	function mountPlayer(p, animation) {
		if (player) { try { player.dispose(); } catch (e) {} player = null; }
		$("player").innerHTML = "";
		if (!window.spine) { $("player").innerHTML = '<p class="note" style="padding:16px">The Spine player could not load.</p>'; return; }
		const anim = p.animations.find((a) => a.name === animation) || p.animations[0];
		player = new spine.SpinePlayer($("player"), {
			skeleton: p.name + ".json",
			atlas: p.name + ".atlas",
			rawDataURIs: { [p.name + ".json"]: p.files.json, [p.name + ".atlas"]: p.files.atlas, [p.name + ".png"]: p.files.png },
			animation: anim ? anim.name : undefined,
			showControls: true,
			backgroundColor: playerBackground(),
			alpha: false,
			preserveDrawingBuffer: false,
			viewport: { padLeft: "12%", padRight: "12%", padTop: "12%", padBottom: "12%" },
		});
	}

	function select(name, animation) {
		const p = projects.find((x) => x.name === name) || projects[0];
		if (!p) { $("panel").innerHTML = '<p class="note">No projects yet. Create one with the project_create tool.</p>'; return; }
		current = p;
		for (const chip of $("rail").children) chip.setAttribute("aria-current", String(chip.dataset.name === p.name));
		const anim = animation || (p.animations[0] && p.animations[0].name);
		$("anims").innerHTML = p.animations.map((a) =>
			'<button class="anim" data-anim="' + esc(a.name) + '" aria-pressed="' + (a.name === anim) + '">' + esc(a.name) +
			' <small>' + a.duration.toFixed(2) + "s" + (a.loop ? " · loop" : "") + "</small></button>").join("") ||
			'<span class="note">No animations yet.</span>';
		$("panel").innerHTML =
			(p.prompt ? '<div><p class="label">Request</p><p class="prompt">' + esc(p.prompt) + "</p></div>" : '<div><p class="label">Project</p><p class="prompt">' + esc(p.title) + "</p></div>") +
			'<div class="facts"><span>version <b>v' + p.version + '</b></span><span><b>' + p.counts.bones + '</b> bones</span><span><b>' + p.counts.slots +
			'</b> slots</span><span><b>' + p.counts.constraints + '</b> constraints</span></div>' +
			'<div><p class="label">Checks</p><ul class="checks">' + p.checks.map((c) =>
				'<li class="check"><span class="pill' + (c.ok ? "" : " bad") + '">' + (c.ok ? "PASS" : "FAIL") + "</span><strong>" + esc(c.name) +
				"</strong><pre>" + esc(c.detail) + "</pre></li>").join("") + "</ul></div>" +
			'<details><summary>Rig</summary><pre>' + esc(p.rig) + "</pre></details>" +
			'<details><summary>Versions</summary><ul class="history">' + p.history.map((h) =>
				"<li><span>v" + h.version + "</span>" + esc(h.message) + "</li>").join("") + "</ul></details>";
		$("strips").innerHTML = p.animations.filter((a) => a.preview).map((a) =>
			'<figure class="strip"><figcaption>' + esc(a.name) + ": frames across " + a.duration.toFixed(2) + 's, played with physics</figcaption><div class="scroll"><img alt="Frames of ' +
			esc(a.name) + '" src="' + a.preview + '"></div></figure>').join("");
		mountPlayer(p, anim);
		if (location.hash.slice(1) !== p.name) history.replaceState(null, "", "#" + p.name);
	}

	$("rail").innerHTML = projects.map((p) =>
		'<button class="chip" data-name="' + esc(p.name) + '"><span class="state' + (p.ok ? "" : " bad") + '" aria-hidden="true"></span>' + esc(p.title) + "</button>").join("");
	$("rail").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) select(b.dataset.name); });
	$("anims").addEventListener("click", (e) => {
		const b = e.target.closest(".anim");
		if (!b || !current) return;
		for (const x of $("anims").children) x.setAttribute("aria-pressed", String(x === b));
		const a = current.animations.find((x) => x.name === b.dataset.anim);
		if (player && player.skeleton) player.setAnimation(a.name, a.loop || true);
	});
	window.addEventListener("hashchange", () => { if (!current || location.hash.slice(1) !== current.name) select(location.hash.slice(1)); });
	select(location.hash.slice(1));
})();
</script>`;
	return opts.document
		? `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${page.replace("<div class=\"wrap\">", "</head>\n<body>\n<div class=\"wrap\">")}\n</body>\n</html>\n`
		: `${page}\n`;
}

/** Serves the studio on localhost, re-reading the workspaces on every page load. */
export function startStudio(port = 5180): Promise<{ server: Server; url: string }> {
	const playerJs = join(require.resolve("@esotericsoftware/spine-player/package.json"), "..", "dist", "iife", "spine-player.min.js");
	const server = createHttpServer((req, res) => {
		try {
			if (req.url === "/spine-player.js") {
				res.writeHead(200, { "content-type": "text/javascript" });
				res.end(readFileSync(playerJs));
				return;
			}
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(render(collect(), { player: "local", document: true, subtitle: `Workspaces in ${workspacesRoot()}` }));
		} catch (e) {
			res.writeHead(500, { "content-type": "text/plain" });
			res.end(String((e as Error).stack ?? e));
		}
	});
	return new Promise((ok, fail) => {
		server.once("error", fail);
		server.listen(port, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${port}/` }));
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const staticOut = args.includes("--static") ? args[args.indexOf("--static") + 1] : undefined;
	if (staticOut) {
		const extrasFile = args.includes("--extras") ? args[args.indexOf("--extras") + 1] : undefined;
		const extras: Record<string, Extra> = {};
		if (extrasFile) for (const r of JSON.parse(readFileSync(extrasFile, "utf8")) as (Extra & { project: string })[]) extras[r.project] = r;
		writeFileSync(resolve(staticOut), render(collect(extras), { player: "cdn", document: args.includes("--document") }));
		console.log(`wrote ${resolve(staticOut)}`);
	} else {
		const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 5180;
		const { url } = await startStudio(port);
		console.log(`rydspine studio: ${url}`);
	}
}
