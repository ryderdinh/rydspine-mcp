// The coin sample from the official Spine examples (art by Esoteric Software, see license.txt in the download).
// It is not kept in this repo: it is fetched once, at a pinned commit, into ~/.cache/rydspine/coin.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const COMMIT = "7f1ba951b62c03b5a588022c50307a1aadc47588";
const BASE = `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${COMMIT}/examples/coin`;

/** Folder holding coin-pro.json, coin-pro.skel, coin.atlas, coin.png, images/ and license.txt. */
export const COIN = join(homedir(), ".cache", "rydspine", "coin", COMMIT.slice(0, 12));

const FILES: [string, string][] = [
	...["coin-pro.json", "coin-pro.skel", "coin.atlas", "coin.png"].map((f): [string, string] => [`export/${f}`, f]),
	...["coin-front-logo", "coin-front-shine-logo", "coin-front-shine-spineboy", "coin-front-spineboy", "coin-side-round", "coin-side-straight", "shine"].map(
		(f): [string, string] => [`images/${f}.png`, `images/${f}.png`],
	),
	["license.txt", "license.txt"],
];

export async function fetchCoin(): Promise<void> {
	for (const [from, to] of FILES) {
		const file = join(COIN, to);
		if (existsSync(file)) continue;
		const r = await fetch(`${BASE}/${from}`);
		if (!r.ok) throw new Error(`could not download the coin sample (${from}: HTTP ${r.status}); the tests need network access once`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(`${file}.part`, Buffer.from(await r.arrayBuffer()));
		renameSync(`${file}.part`, file);
	}
}
