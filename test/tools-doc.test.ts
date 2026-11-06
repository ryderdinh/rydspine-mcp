import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TOOLS_FILE, toolsMarkdown } from "../scripts/tools-doc.js";

it("TOOLS.md matches the server's tool definitions (run npm run docs:tools)", async () => {
	expect(readFileSync(TOOLS_FILE, "utf8")).toBe(await toolsMarkdown());
});
