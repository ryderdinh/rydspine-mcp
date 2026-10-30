// Builds the six reference assets through the MCP tools and requires every check to pass.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildAll } from "../acceptance/build.js";

it("builds all acceptance assets with passing checks", async () => {
	const reports = await buildAll(mkdtempSync(join(tmpdir(), "rydspine-acceptance-")));
	expect(reports.map((r) => r.project)).toEqual(["hero", "dragon", "tree", "chest", "car", "logo"]);
	for (const r of reports) for (const c of r.checks) expect(c.ok, `${r.project} ${c.name}: ${c.detail}`).toBe(true);
}, 300000);
