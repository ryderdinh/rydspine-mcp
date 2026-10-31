// Converts every .skel in the official Spine examples (github.com/EsotericSoftware/spine-runtimes, examples/*/export)
// to JSON and plays it against the runtime's own reading of the .skel, every animation, frame by frame, with physics.
// The examples are fetched once into ~/.cache/rydspine/spine-runtimes (sparse, export files only).
//
// Usage: npx tsx acceptance/skel-examples.ts [filter]   (RYDSPINE_RUNTIMES_BRANCH, default 4.3)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SkeletonBinary, SkeletonJson } from "@esotericsoftware/spine-core";
import { skelToJson } from "../src/skel.js";
import { compareAnimation, compareStructure, PlaceholderLoader, TOLERANCE } from "./compare.js";

const BRANCH = process.env.RYDSPINE_RUNTIMES_BRANCH ?? "4.3";
const DIR = join(homedir(), ".cache", "rydspine", "spine-runtimes");

/** Differences that come from the JS runtime, not from the conversion; each names why. */
const KNOWN: Record<string, string> = {
	// The slider maps 360 degrees times 0.005555556 to the loop end: exactly 2 from JSON doubles, just under 2
	// from .skel float32, so the setup pose shows a different sequence frame. Spine's own JSON export does the same.
	"diamond-pro.skel": "slider at the loop boundary",
};

function git(args: string[], cwd?: string) {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function fetchExamples(): string {
	if (!existsSync(DIR)) {
		git(["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "-b", BRANCH, "https://github.com/EsotericSoftware/spine-runtimes", DIR]);
		git(["sparse-checkout", "set", "--no-cone", "/examples/*/export/*.skel", "/examples/*/export/*.json"], DIR);
	}
	return join(DIR, "examples");
}

const filter = process.argv[2] ?? "";
const root = fetchExamples();
let failed = 0;
for (const example of readdirSync(root).sort()) {
	const dir = join(root, example, "export");
	if (!existsSync(dir)) continue;
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".skel") && f.includes(filter))) {
		const bytes = readFileSync(join(dir, file));
		const problems: string[] = [];
		let worst = 0;
		let where = "";
		try {
			const binary = new SkeletonBinary(new PlaceholderLoader()).readSkeletonData(new Uint8Array(bytes));
			const converted = new SkeletonJson(new PlaceholderLoader()).readSkeletonData(JSON.parse(JSON.stringify(skelToJson(bytes))));
			problems.push(...compareStructure(binary, converted));
			for (const a of binary.animations) {
				// Samples between frames; see test/skel.test.ts.
				const c = compareAnimation(file, binary, converted, a.name, TOLERANCE, 0.5);
				problems.push(...c.problems.map((p) => `${a.name}: ${p}`));
				if (c.worst > worst) [worst, where] = [c.worst, `${a.name}, ${c.where}`];
			}
		} catch (e) {
			problems.push((e as Error).message);
		}
		const known = KNOWN[file];
		if (problems.length && !known) failed++;
		console.log(`${problems.length ? (known ? "known" : "FAIL ") : "ok   "} ${file}: max difference ${worst.toFixed(4)}${where ? ` (${where})` : ""}${problems.length && known ? ` — ${known}` : ""}`);
		for (const p of problems.slice(0, 5)) console.log(`        ${p}`);
	}
}
process.exit(failed ? 1 : 0);
