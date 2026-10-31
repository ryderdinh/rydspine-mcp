// Round-trips the acceptance assets through the real Spine Editor: Spine imports each exported JSON into a
// .spine project and exports it again, then the official runtime plays both JSON files and compares every
// bone, slot and attachment vertex at every frame.
//
// Needs Spine: SPINE_CLI points at the Spine launcher (e.g. /Applications/Spine.app/Contents/MacOS/Spine).
// Without it, on Linux with SPINE_ACTIVATION_CODE set, the launcher is downloaded to ~/.cache/rydspine/spine
// and activated from the variable. With neither, the check is skipped.
// The activation code is read only from the environment and is never printed or written anywhere.
//
// Usage: npx tsx acceptance/spine-check.ts [outDir]   (default acceptance/out/spine-check)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import { SkeletonJson } from "@esotericsoftware/spine-core";
import { buildAll } from "./build.js";
import { type Compared, compareAnimation, compareStructure, FPS, PlaceholderLoader } from "./compare.js";

const SPINE_VERSION = process.env.RYDSPINE_SPINE_VERSION ?? "4.3.26";

const secret = process.env.SPINE_ACTIVATION_CODE ?? "";
const redact = (s: string) => (secret ? s.split(secret).join("<code>") : s);

/** Finds or installs the Spine launcher. Returns null when Spine is not available. */
export function launcher(): string[] | null {
	if (process.env.SPINE_CLI) return [process.env.SPINE_CLI];
	if (!secret || platform() !== "linux") return null;
	const dir = join(homedir(), ".cache", "rydspine", "spine");
	const script = join(dir, "Spine", "Spine.sh");
	if (!existsSync(script)) {
		mkdirSync(dir, { recursive: true });
		const tar = join(dir, "launcher.tar.gz");
		console.log("downloading the Spine launcher…");
		const get = spawnSync("curl", ["-sSfL", "-o", tar, `https://esotericsoftware.com/launcher/linux/${secret}`], { encoding: "utf8" });
		if (get.status !== 0) throw new Error(`could not download the Spine launcher: ${redact(get.stderr)}`);
		const unpack = spawnSync("tar", ["-xzf", tar, "-C", dir], { encoding: "utf8" });
		rmSync(tar, { force: true });
		if (unpack.status !== 0) throw new Error(`could not unpack the Spine launcher: ${unpack.stderr}`);
	}
	return ["sh", script];
}

/** Runs one Spine CLI command headless. The activation code goes in on stdin the first time Spine asks for it. */
export function spine(base: string[], args: string[]): string {
	const extra: string[] = ["-u", SPINE_VERSION];
	const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
	if (proxy) extra.push("-x", new URL(proxy).host);
	let cmd = [...base, ...extra, ...args];
	if (platform() === "linux" && !process.env.DISPLAY) cmd = ["xvfb-run", "-a", ...cmd];
	const r = spawnSync(cmd[0], cmd.slice(1), { input: secret ? `${secret}\n` : "", encoding: "utf8", timeout: 600000 });
	const out = redact(`${r.stdout}${r.stderr}`);
	if (r.status !== 0 || /^ERROR/m.test(out)) throw new Error(`Spine failed (${args.join(" ")}):\n${out}`);
	return out;
}

/** Reads a JSON export with placeholder regions. */
const read = (file: string) => new SkeletonJson(new PlaceholderLoader()).readSkeletonData(JSON.parse(readFileSync(file, "utf8")));

/** PNG sequence settings, as the Export dialog saves them; Spine needs OpenGL (Xvfb with Mesa on Linux). */
function pngSettings(skeleton: string, animation: string) {
	return {
		class: "export-png",
		name: "PNG",
		exportType: "animation",
		skeletonType: "single",
		skeleton,
		animationType: "single",
		animation,
		skinType: "current",
		skin: null,
		maxBounds: true,
		renderImages: true,
		renderBones: false,
		renderOthers: false,
		scale: 100,
		fps: FPS,
		lastFrame: false,
		rangeStart: -1,
		rangeEnd: -1,
		transparency: true,
	};
}

/** Lays `count` evenly spaced frames side by side on white. */
function contactSheet(frames: string[], count = 8): PNG {
	const pick = Array.from({ length: Math.min(count, frames.length) }, (_, i) => frames[Math.round((i * (frames.length - 1)) / Math.max(1, count - 1))]);
	const images = pick.map((f) => PNG.sync.read(readFileSync(f)));
	const w = Math.max(...images.map((im) => im.width));
	const h = Math.max(...images.map((im) => im.height));
	const sheet = new PNG({ width: w * images.length, height: h });
	sheet.data.fill(255);
	images.forEach((im, k) => {
		for (let y = 0; y < im.height; y++)
			for (let x = 0; x < im.width; x++) {
				const s = (y * im.width + x) * 4;
				const d = (y * sheet.width + k * w + x) * 4;
				const a = im.data[s + 3] / 255;
				for (let c = 0; c < 3; c++) sheet.data[d + c] = Math.round(im.data[s + c] * a + 255 * (1 - a));
			}
	});
	return sheet;
}

/** Renders each animation with Spine itself into a contact sheet. Returns the sheet paths. */
function renderSheets(base: string[], project: string, skeleton: string, animations: string[], dir: string): string[] {
	const sheets: string[] = [];
	for (const animation of animations) {
		const frames = join(dir, "frames", animation);
		mkdirSync(frames, { recursive: true });
		const settings = join(dir, `png-${animation}.export.json`);
		writeFileSync(settings, JSON.stringify(pngSettings(skeleton, animation), null, 1));
		// Spine treats the output as a file prefix: frames/<animation>/f_00.png, f_01.png, ...
		const args = ["-i", project, "-o", join(frames, "f"), "-e", settings];
		try {
			spine(base, args);
		} catch {
			// Image export through Xvfb fails now and then for no reason it reports; a second run succeeds.
			spine(base, args);
		}
		const files = readdirSync(frames)
			.filter((f) => f.endsWith(".png"))
			.sort()
			.map((f) => join(frames, f));
		if (!files.length) throw new Error(`Spine wrote no frames for ${skeleton}/${animation}`);
		const sheet = join(dir, `${animation}.png`);
		writeFileSync(sheet, PNG.sync.write(contactSheet(files)));
		sheets.push(sheet);
	}
	return sheets;
}

export interface SpineCheck {
	asset: string;
	ok: boolean;
	problems: string[];
	animations: Compared[];
	/** Contact sheets rendered by Spine, one per animation. */
	sheets: string[];
	log: string;
}

/** Imports one exported JSON into Spine, exports it again and compares both; Spine also renders contact sheets into dir. */
export function roundTrip(base: string[], original: string, name: string, animationNames: string[], dir: string): SpineCheck {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const project = join(dir, `${name}.spine`);
	let log = spine(base, ["-i", original, "-o", project, "-r"]);
	// Nonessential data keeps mesh internal edges, bone colors and other editor-only fields.
	log += spine(base, ["-i", project, "-o", join(dir, "export"), "--set", "nonessential=true", "-e", "json"]);
	const exported = join(dir, "export", `${name}.json`);
	const warnings = log.split("\n").filter((l) => /^WARNING/.test(l));
	const a = read(original);
	const b = read(exported);
	const animations = a.animations.map((anim) => compareAnimation(name, a, b, anim.name));
	const problems = [...warnings, ...compareStructure(a, b), ...animations.flatMap((c) => c.problems.map((p) => `${c.animation}: ${p}`))];
	let sheets: string[] = [];
	try {
		sheets = renderSheets(base, project, name, animationNames, dir);
	} catch (e) {
		// The reason is at the end of Spine's output, after the launcher banner.
		problems.push(`image export: ${(e as Error).message.split("\n").filter(Boolean).slice(-4).join(" | ")}`);
	}
	return { asset: name, ok: problems.length === 0, problems, animations, sheets, log };
}

export async function spineCheck(outDir: string): Promise<SpineCheck[] | null> {
	const base = launcher();
	if (!base) return null;
	const exported = join(outDir, "assets");
	const reports = await buildAll(exported);
	const results = reports.map((r) =>
		roundTrip(base, join(exported, r.project, `${r.project}.json`), r.project, r.animations, join(outDir, "spine", r.project)),
	);
	writeFileSync(join(outDir, "spine-check.json"), `${JSON.stringify(results, null, 2)}\n`);
	return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const out = resolve(process.argv[2] ?? "acceptance/out/spine-check");
	const results = await spineCheck(out);
	if (!results) {
		console.log("skipped: set SPINE_CLI to the Spine launcher, or SPINE_ACTIVATION_CODE on Linux");
		process.exit(0);
	}
	for (const r of results) {
		console.log(`${r.ok ? "ok  " : "FAIL"} ${r.asset}`);
		for (const c of r.animations) console.log(`       ${c.animation}: ${c.frames} frames, max difference ${c.worst.toFixed(4)}${c.where ? ` (${c.where})` : ""}${c.events ? `, ${c.events} events match` : ""}`);
		for (const p of r.problems) console.log(`       ! ${p}`);
		for (const sheet of r.sheets) console.log(`       sheet ${sheet}`);
	}
	console.log(`\nwritten to ${out}`);
	process.exit(results.every((r) => r.ok) ? 0 : 1);
}
