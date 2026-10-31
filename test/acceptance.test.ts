// Builds the six reference assets through the MCP tools and requires every check to pass.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildAll } from "../acceptance/build.js";

type Json = Record<string, unknown>;

/** Rules found by importing the assets into Spine Editor 4.3.26 (npm run spine:check); the runtime alone accepts all of these. */
function spineEditorProblems(doc: Json): string[] {
	const problems: string[] = [];
	for (const skin of doc.skins as { attachments: Record<string, Record<string, Json>> }[])
		for (const [slot, atts] of Object.entries(skin.attachments))
			for (const [name, a] of Object.entries(atts)) {
				if (a.type !== "mesh") continue;
				// Without edges Spine warns that the file was exported without nonessential data.
				if (!Array.isArray(a.edges) || !a.edges.length) problems.push(`${slot}/${name}: mesh without edges`);
				const v = a.vertices as number[];
				if (v.length === (a.uvs as number[]).length) continue;
				// Spine fails to import ("Index -2 out of bounds") unless each vertex lists its bones in skeleton order.
				for (let i = 0; i < v.length; ) {
					const n = v[i++];
					const bones = Array.from({ length: n }, (_, k) => v[i + k * 4]);
					if (bones.some((b, k) => k > 0 && b <= bones[k - 1])) problems.push(`${slot}/${name}: vertex bones out of order ${bones}`);
					i += n * 4;
				}
			}
	// Spine snaps near-frame key times on import, which would shift the pose.
	const visit = (node: unknown, path: string) => {
		if (Array.isArray(node)) node.forEach((k, i) => visit(k, `${path}[${i}]`));
		else if (node && typeof node === "object")
			for (const [key, value] of Object.entries(node)) {
				if (key === "time" && typeof value === "number") {
					const f = value * 30;
					const off = Math.abs(f - Math.round(f));
					if (off > 1e-5 && off < 0.06) problems.push(`${path}: time ${value} is just off frame ${Math.round(f)}`);
				} else visit(value, `${path}.${key}`);
			}
	};
	visit(doc.animations, "animations");
	return problems;
}

it("builds all acceptance assets with passing checks", async () => {
	const out = mkdtempSync(join(tmpdir(), "rydspine-acceptance-"));
	const reports = await buildAll(out);
	expect(reports.map((r) => r.project)).toEqual(["hero", "dragon", "tree", "chest", "car", "logo", "lantern"]);
	for (const r of reports) for (const c of r.checks) expect(c.ok, `${r.project} ${c.name}: ${c.detail}`).toBe(true);
	for (const r of reports) {
		const doc = JSON.parse(readFileSync(join(out, r.project, `${r.project}.json`), "utf8"));
		expect(spineEditorProblems(doc), r.project).toEqual([]);
	}
}, 300000);
