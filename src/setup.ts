// Setup wizard: connects an installed copy of rydspine to Claude Code, Claude Desktop and Codex, copies the
// rigging skill, installs Chromium for PNG previews, then starts the server once to prove it works.
// Run by the downloadable installers in docs/ (after they fetch the code into ~/.rydspine/app), or directly:
//   npx tsx src/setup.ts [--yes] [--clients=claude-code,claude-desktop,codex] [--no-chromium] [--home=<dir>]
// --home points every config at another folder, for trying the wizard without touching the real ones.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "rydspine";
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const HOME = resolve(option("home") ?? homedir());
const testHome = option("home") !== undefined;
const claudeDir = testHome ? join(HOME, ".claude") : (process.env.CLAUDE_CONFIG_DIR ?? join(HOME, ".claude"));
const codexDir = testHome ? join(HOME, ".codex") : (process.env.CODEX_HOME ?? join(HOME, ".codex"));
const desktopConfig =
	platform() === "win32"
		? join(testHome ? join(HOME, "AppData", "Roaming") : (process.env.APPDATA ?? join(HOME, "AppData", "Roaming")), "Claude", "claude_desktop_config.json")
		: platform() === "darwin"
			? join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json")
			: join(HOME, ".config", "Claude", "claude_desktop_config.json");
const workspaces = join(HOME, ".rydspine", "workspaces");

// GUI apps do not see the shell's PATH (nvm, Homebrew), so the server is launched by absolute paths.
const server = {
	command: process.execPath,
	args: [join(APP, "node_modules", "tsx", "dist", "cli.mjs"), join(APP, "src", "index.ts")],
	env: { RYDSPINE_WORKSPACES: workspaces },
};

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const [green, red, yellow, dim, bold] = [paint(32), paint(31), paint(33), paint(2), paint(1)];
const ok = (s: string) => console.log(`  ${green("✓")} ${s}`);
const fail = (s: string) => console.log(`  ${red("✗")} ${s}`);
const note = (s: string) => console.log(`  ${dim(s)}`);
const step = (n: number, s: string) => console.log(`\n${bold(`${n}. ${s}`)}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
async function ask(question: string, yes = true): Promise<boolean> {
	if (flag("yes") || !process.stdin.isTTY) return yes;
	const a = (await rl.question(`  ${question} ${yes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
	return a ? a.startsWith("y") || a.startsWith("c") : yes;
}

/** Runs a CLI through the shell so Windows finds .cmd shims; returns null if it is not installed. */
function run(cmd: string, argv: string[], env?: NodeJS.ProcessEnv) {
	const quoted = argv.map((a) => (platform() === "win32" ? `"${a.replace(/"/g, '\\"')}"` : `'${a.replace(/'/g, "'\\''")}'`));
	const r = spawnSync([cmd, ...quoted].join(" "), { shell: true, encoding: "utf8", env: { ...process.env, ...env } });
	return r.error ? null : { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}
const has = (cmd: string) => run(cmd, ["--version"])?.ok ?? false;

function backup(file: string) {
	if (!existsSync(file)) return;
	const copy = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
	copyFileSync(file, copy);
	note(`backup: ${copy}`);
}

interface Target {
	id: string;
	label: string;
	found: () => boolean;
	install: () => boolean;
	missing: string;
}

const cliEnv = testHome ? { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir } : undefined;
const targets: Target[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		found: () => has("claude"),
		missing: "no `claude` command found; install Claude Code and run this again",
		install: () => {
			run("claude", ["mcp", "remove", NAME, "-s", "user"], cliEnv);
			const env = Object.entries(server.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
			// -e takes several values, so the name goes before it.
			const r = run("claude", ["mcp", "add", "-s", "user", NAME, ...env, "--", server.command, ...server.args], cliEnv);
			if (!r?.ok) return void fail(`claude mcp add: ${r?.out ?? "could not run"}`), false;
			const skill = join(APP, ".claude", "skills", "spine-rigging");
			if (existsSync(skill)) {
				cpSync(skill, join(claudeDir, "skills", "spine-rigging"), { recursive: true });
				note(`skill spine-rigging: ${join(claudeDir, "skills", "spine-rigging")}`);
			}
			return true;
		},
	},
	{
		id: "claude-desktop",
		label: "Claude Desktop",
		found: () => existsSync(dirname(desktopConfig)),
		missing: "Claude Desktop not found (open the app at least once and run this again)",
		install: () => {
			let config: { mcpServers?: Record<string, unknown> } = {};
			if (existsSync(desktopConfig)) {
				try {
					config = JSON.parse(readFileSync(desktopConfig, "utf8") || "{}");
				} catch {
					return void fail(`${desktopConfig} is not valid JSON; fix the file and run this again`), false;
				}
			}
			backup(desktopConfig);
			config.mcpServers = { ...config.mcpServers, [NAME]: server };
			mkdirSync(dirname(desktopConfig), { recursive: true });
			writeFileSync(desktopConfig, `${JSON.stringify(config, null, 2)}\n`);
			note(`config: ${desktopConfig}`);
			note("quit Claude Desktop completely and reopen it to load the MCP");
			return true;
		},
	},
	{
		id: "codex",
		label: "Codex",
		found: () => has("codex"),
		missing: "no `codex` command found; install the Codex CLI and run this again",
		install: () => {
			mkdirSync(codexDir, { recursive: true });
			run("codex", ["mcp", "remove", NAME], cliEnv);
			const env = Object.entries(server.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
			const r = run("codex", ["mcp", "add", NAME, ...env, "--", server.command, ...server.args], cliEnv);
			if (!r?.ok) return void fail(`codex mcp add: ${r?.out ?? "could not run"}`), false;
			return true;
		},
	},
];

/** Starts the server the way a client would and lists its tools. */
async function verify(): Promise<number> {
	const client = new Client({ name: "rydspine-setup", version: "0" });
	const transport = new StdioClientTransport({ ...server, env: { ...(process.env as Record<string, string>), ...server.env }, stderr: "ignore" });
	await client.connect(transport);
	try {
		return (await client.listTools()).tools.length;
	} finally {
		await client.close();
	}
}

async function main() {
	console.log(`\n${bold("rydspine — Spine rig & animation MCP setup")}`);
	note(`source: ${APP}`);
	if (testHome) console.log(`  ${yellow("!")} test mode: all configuration goes to ${HOME}`);

	step(1, "Node.js");
	const major = Number(process.versions.node.split(".")[0]);
	if (major < 20) return void fail(`needs Node 20 or later, this machine has ${process.versions.node}`), 1;
	ok(`Node ${process.versions.node} (${process.execPath})`);

	step(2, "Connect to apps");
	const wanted = option("clients")?.split(",");
	const done: string[] = [];
	for (const t of targets) {
		if (wanted && !wanted.includes(t.id)) continue;
		if (!t.found()) {
			note(`${t.label}: ${t.missing}`);
			continue;
		}
		if (!(await ask(`Set up ${t.label}?`))) continue;
		if (t.install()) {
			ok(t.label);
			done.push(t.label);
		}
	}
	if (!done.length) console.log(`  ${yellow("!")} no app connected`);
	mkdirSync(workspaces, { recursive: true });
	note(`projects are stored in ${workspaces}`);

	step(3, "PNG previews");
	if (flag("no-chromium")) note("skipped (--no-chromium)");
	else if (await ask("Download Chromium (~150 MB) so the preview tool can render PNG images? Without it previews are SVG only.")) {
		const r = spawnSync(process.execPath, [join(APP, "node_modules", "playwright", "cli.js"), "install", "chromium"], { stdio: "inherit" });
		r.status === 0 ? ok("Chromium") : fail("could not download Chromium; previews still work as SVG");
	}

	step(4, "Spine Editor");
	const spine = [
		"/Applications/Spine.app/Contents/MacOS/Spine",
		"C:\\Program Files\\Spine\\Spine.exe",
		"C:\\Program Files (x86)\\Spine\\Spine.exe",
	].find(existsSync);
	if (spine) ok(`found ${spine}; open results with Spine → Import Data… and pick the exported .json file`);
	else note("Spine Editor not found; it is optional, exported files still work in games and the Spine runtimes");

	step(5, "Test the server");
	try {
		ok(`server runs, ${await verify()} tools ready`);
	} catch (e) {
		fail(`server did not start: ${(e as Error).message}`);
		return 1;
	}

	console.log(`\n${bold(green("Done!"))} ${done.length ? `Connected: ${done.join(", ")}.` : ""}`);
	console.log(`  Try asking your AI: "Create a Spine project from character.psd, rig it and make a walk animation."`);
	return 0;
}

const code = await main();
rl.close();
process.exit(code);
