import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "pngjs";
import { createServer } from "../src/server.js";

type Content = { type: string; text?: string; data?: string };
export interface Result {
	isError?: boolean;
	content: Content[];
	text: string;
}

/** Starts the server in-process with a fresh workspace root and returns call helpers. */
export async function connect() {
	const root = mkdtempSync(join(tmpdir(), "rydspine-"));
	process.env.RYDSPINE_WORKSPACES = root;
	const [a, b] = InMemoryTransport.createLinkedPair();
	await createServer().connect(a);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(b);
	const call = async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
		const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Content[] };
		return { ...r, text: r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n") };
	};
	const ok = async (name: string, args: Record<string, unknown> = {}) => {
		const r = await call(name, args);
		if (r.isError) throw new Error(`${name} failed: ${r.text}`);
		return r;
	};
	return { root, client, call, ok };
}

/** Writes a solid-color rectangle PNG (optionally an ellipse) and returns its path. */
export function shape(dir: string, name: string, width: number, height: number, rgb: [number, number, number], ellipse = false): string {
	mkdirSync(dir, { recursive: true });
	const png = new PNG({ width, height });
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const nx = (x + 0.5) / width - 0.5;
			const ny = (y + 0.5) / height - 0.5;
			const inside = !ellipse || nx * nx + ny * ny <= 0.25;
			const i = (y * width + x) * 4;
			png.data[i] = rgb[0];
			png.data[i + 1] = rgb[1];
			png.data[i + 2] = rgb[2];
			png.data[i + 3] = inside ? 255 : 0;
		}
	}
	const file = join(dir, `${name}.png`);
	writeFileSync(file, PNG.sync.write(png));
	return file;
}
