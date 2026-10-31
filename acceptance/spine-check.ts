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
import {
	type Attachment,
	AtlasAttachmentLoader,
	MeshAttachment,
	MixFrom,
	Physics,
	RegionAttachment,
	Skeleton,
	type SkeletonData,
	SkeletonJson,
	TextureAtlas,
	type TextureAtlasRegion,
} from "@esotericsoftware/spine-core";
import { buildAll } from "./build.js";

const SPINE_VERSION = process.env.RYDSPINE_SPINE_VERSION ?? "4.3.26";
const FPS = 30;
/** Spine writes floats with fewer digits than the runtime keeps; anything below this is rounding. */
const TOLERANCE = 0.05;

const secret = process.env.SPINE_ACTIVATION_CODE ?? "";
const redact = (s: string) => (secret ? s.split(secret).join("<code>") : s);

/** Finds or installs the Spine launcher. Returns null when Spine is not available. */
function launcher(): string[] | null {
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
function spine(base: string[], args: string[]): string {
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

/** Every attachment gets the same 1x1 region: the comparison needs geometry, not pixels. */
class PlaceholderLoader extends AtlasAttachmentLoader {
	private readonly region: TextureAtlasRegion;
	constructor() {
		const atlas = new TextureAtlas("placeholder.png\nsize:1,1\nfilter:Linear,Linear\nplaceholder\nbounds:0,0,1,1\n");
		super(atlas);
		this.region = atlas.regions[0];
	}
	protected findRegion(): TextureAtlasRegion {
		return this.region;
	}
}

const read = (file: string) => new SkeletonJson(new PlaceholderLoader()).readSkeletonData(JSON.parse(readFileSync(file, "utf8")));

function worldVertices(skeleton: Skeleton, slotIndex: number, att: Attachment | null): number[] {
	const slot = skeleton.slots[slotIndex];
	if (att instanceof RegionAttachment) {
		const v = new Array<number>(8);
		att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
		return v;
	}
	if (att instanceof MeshAttachment) {
		const v = new Array<number>(att.worldVerticesLength);
		att.computeWorldVertices(skeleton, slot, 0, att.worldVerticesLength, v, 0, 2);
		return v;
	}
	return [];
}

interface Pose {
	values: number[];
	labels: string[];
	attachments: (string | null)[];
	order: string[];
}

function pose(skeleton: Skeleton): Pose {
	const values: number[] = [];
	const labels: string[] = [];
	for (const b of skeleton.bones) {
		const p = b.appliedPose;
		for (const [k, v] of Object.entries({ x: p.worldX, y: p.worldY, a: p.a, b: p.b, c: p.c, d: p.d })) {
			values.push(k === "x" || k === "y" ? v : v * 100);
			labels.push(`bone ${b.data.name} ${k}`);
		}
	}
	const attachments: (string | null)[] = [];
	skeleton.slots.forEach((s, i) => {
		const att = s.appliedPose.getAttachment();
		attachments.push(att?.name ?? null);
		const c = s.appliedPose.color;
		for (const [k, v] of Object.entries({ r: c.r, g: c.g, b: c.b, a: c.a })) {
			values.push(v * 100);
			labels.push(`slot ${s.data.name} ${k}`);
		}
		worldVertices(skeleton, i, att).forEach((v, j) => {
			values.push(v);
			labels.push(`slot ${s.data.name} vertex ${j >> 1}`);
		});
	});
	return { values, labels, attachments, order: skeleton.drawOrder.appliedPose.map((s) => s.data.name) };
}

interface Compared {
	asset: string;
	animation: string;
	frames: number;
	worst: number;
	where: string;
	problems: string[];
}

/** Plays one animation in both skeletons, frame by frame, with physics. */
function compareAnimation(asset: string, a: SkeletonData, b: SkeletonData, name: string): Compared {
	const out: Compared = { asset, animation: name, frames: 0, worst: 0, where: "", problems: [] };
	const animA = a.findAnimation(name);
	const animB = b.findAnimation(name);
	if (!animA || !animB) {
		out.problems.push("animation missing after the round trip");
		return out;
	}
	if (Math.abs(animA.duration - animB.duration) > 1e-3) out.problems.push(`duration ${animA.duration} became ${animB.duration}`);
	const sa = new Skeleton(a);
	const sb = new Skeleton(b);
	const frames = Math.round(animA.duration * FPS);
	for (let i = 0; i <= frames; i++) {
		const t = Math.min(i / FPS, animA.duration);
		const poses = ([
			[sa, animA],
			[sb, animB],
		] as const).map(([s, anim]) => {
			s.setupPose();
			anim.apply(s, t, t, false, null, 1, MixFrom.current, false, false, false);
			if (i > 0) s.update(1 / FPS);
			s.updateWorldTransform(i === 0 ? Physics.reset : Physics.update);
			return pose(s);
		});
		const [pa, pb] = poses;
		out.frames++;
		if (pa.values.length !== pb.values.length) {
			out.problems.push(`frame ${i}: pose has ${pa.values.length} values, ${pb.values.length} after the round trip`);
			break;
		}
		pa.values.forEach((v, k) => {
			const d = Math.abs(v - pb.values[k]);
			if (d > out.worst) {
				out.worst = d;
				out.where = `${pa.labels[k]} at frame ${i}`;
			}
		});
		if (pa.attachments.join() !== pb.attachments.join()) out.problems.push(`frame ${i}: visible attachments differ`);
		if (pa.order.join() !== pb.order.join()) out.problems.push(`frame ${i}: draw order differs`);
		if (out.problems.length > 5) break;
	}
	if (out.worst > TOLERANCE) out.problems.push(`max difference ${out.worst.toFixed(3)} (${out.where})`);
	return out;
}

function compareStructure(a: SkeletonData, b: SkeletonData): string[] {
	const problems: string[] = [];
	const names = (label: string, x: { name: string }[], y: { name: string }[]) => {
		const [p, q] = [x.map((e) => e.name).join(", "), y.map((e) => e.name).join(", ")];
		if (p !== q) problems.push(`${label}: [${p}] became [${q}]`);
	};
	names("bones", a.bones, b.bones);
	names("slots", a.slots, b.slots);
	names("constraints", a.constraints, b.constraints);
	names("skins", a.skins, b.skins);
	names("animations", a.animations, b.animations);
	names("events", a.events, b.events);
	for (const skin of a.skins) {
		const other = b.findSkin(skin.name);
		if (!other) continue;
		const list = (s: typeof skin) =>
			s
				.getAttachments()
				.map((e) => `${a.slots[e.slotIndex].name}/${e.placeholder}:${e.attachment.constructor.name}`)
				.sort()
				.join(", ");
		if (list(skin) !== list(other)) problems.push(`skin ${skin.name}: attachments differ`);
	}
	return problems;
}

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
		spine(base, ["-i", project, "-o", join(frames, "f"), "-e", settings]);
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

export async function spineCheck(outDir: string): Promise<SpineCheck[] | null> {
	const base = launcher();
	if (!base) return null;
	const exported = join(outDir, "assets");
	const reports = await buildAll(exported);
	const results: SpineCheck[] = [];
	for (const r of reports) {
		const original = join(exported, r.project, `${r.project}.json`);
		const dir = join(outDir, "spine", r.project);
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		const project = join(dir, `${r.project}.spine`);
		let log = spine(base, ["-i", original, "-o", project, "-r"]);
		// Nonessential data keeps mesh internal edges, bone colors and other editor-only fields.
		log += spine(base, ["-i", project, "-o", join(dir, "export"), "--set", "nonessential=true", "-e", "json"]);
		const roundTrip = join(dir, "export", `${r.project}.json`);
		const warnings = log.split("\n").filter((l) => /^WARNING/.test(l));
		const a = read(original);
		const b = read(roundTrip);
		const animations = a.animations.map((anim) => compareAnimation(r.project, a, b, anim.name));
		const problems = [...warnings, ...compareStructure(a, b), ...animations.flatMap((c) => c.problems.map((p) => `${c.animation}: ${p}`))];
		let sheets: string[] = [];
		try {
			sheets = renderSheets(base, project, r.project, r.animations, dir);
		} catch (e) {
			problems.push(`image export: ${(e as Error).message.split("\n").slice(0, 3).join(" ")}`);
		}
		results.push({ asset: r.project, ok: problems.length === 0, problems, animations, sheets, log });
	}
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
		for (const c of r.animations) console.log(`       ${c.animation}: ${c.frames} frames, max difference ${c.worst.toFixed(4)}${c.where ? ` (${c.where})` : ""}`);
		for (const p of r.problems) console.log(`       ! ${p}`);
		for (const sheet of r.sheets) console.log(`       sheet ${sheet}`);
	}
	console.log(`\nwritten to ${out}`);
	process.exit(results.every((r) => r.ok) ? 0 : 1);
}
