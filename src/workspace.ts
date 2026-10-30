// A project workspace on disk: the current skeleton, its images, metadata and a snapshot per change.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { emptySkeleton, type ProjectMeta, type SkeletonDoc } from "./types.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export class UserError extends Error {}

export function workspacesRoot(): string {
	return resolve(process.env.RYDSPINE_WORKSPACES ?? "workspaces");
}

export function checkName(kind: string, name: string): string {
	if (!NAME.test(name)) throw new UserError(`${kind} name "${name}" must match ${NAME}`);
	return name;
}

interface Snapshot {
	version: number;
	message: string;
	time: string;
	doc: SkeletonDoc;
	meta: ProjectMeta;
}

export class Workspace {
	readonly dir: string;
	doc: SkeletonDoc;
	meta: ProjectMeta;

	private constructor(dir: string, doc: SkeletonDoc, meta: ProjectMeta) {
		this.dir = dir;
		this.doc = doc;
		this.meta = meta;
	}

	static create(name: string): Workspace {
		const dir = join(workspacesRoot(), checkName("project", name));
		if (existsSync(dir)) throw new UserError(`project "${name}" already exists`);
		mkdirSync(join(dir, "images"), { recursive: true });
		mkdirSync(join(dir, "history"), { recursive: true });
		const meta: ProjectMeta = { name, version: 0, loops: {}, locks: { bones: [], slots: [], animations: [] } };
		const ws = new Workspace(dir, emptySkeleton(), meta);
		ws.commit("create project");
		return ws;
	}

	static open(name: string): Workspace {
		const dir = join(workspacesRoot(), checkName("project", name));
		if (!existsSync(join(dir, "skeleton.json"))) throw new UserError(`project "${name}" not found`);
		const doc = JSON.parse(readFileSync(join(dir, "skeleton.json"), "utf8")) as SkeletonDoc;
		const meta = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as ProjectMeta;
		return new Workspace(dir, doc, meta);
	}

	static list(): string[] {
		const root = workspacesRoot();
		if (!existsSync(root)) return [];
		return readdirSync(root).filter((d) => existsSync(join(root, d, "skeleton.json")));
	}

	get imagesDir(): string {
		return join(this.dir, "images");
	}

	imageNames(): string[] {
		return readdirSync(this.imagesDir)
			.filter((f) => f.endsWith(".png"))
			.map((f) => f.slice(0, -4))
			.sort();
	}

	addImage(source: string, name?: string): string {
		const imageName = checkName("image", name ?? basename(source).replace(/\.png$/i, ""));
		copyFileSync(source, join(this.imagesDir, `${imageName}.png`));
		return imageName;
	}

	/** Saves the current state as a new version. */
	commit(message: string): number {
		this.meta.version++;
		writeFileSync(join(this.dir, "skeleton.json"), `${JSON.stringify(this.doc, null, 2)}\n`);
		writeFileSync(join(this.dir, "project.json"), `${JSON.stringify(this.meta, null, 2)}\n`);
		const snap: Snapshot = {
			version: this.meta.version,
			message,
			time: new Date().toISOString(),
			doc: this.doc,
			meta: this.meta,
		};
		writeFileSync(this.snapshotPath(this.meta.version), JSON.stringify(snap));
		return this.meta.version;
	}

	history(): { version: number; message: string; time: string }[] {
		return readdirSync(join(this.dir, "history"))
			.filter((f) => f.endsWith(".json"))
			.sort()
			.map((f) => {
				const s = JSON.parse(readFileSync(join(this.dir, "history", f), "utf8")) as Snapshot;
				return { version: s.version, message: s.message, time: s.time };
			});
	}

	/** Restores an earlier version as a new version, so the revert itself can be undone. */
	revert(version: number): number {
		const path = this.snapshotPath(version);
		if (!existsSync(path)) throw new UserError(`version ${version} not found`);
		const snap = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
		const current = this.meta.version;
		this.doc = snap.doc;
		this.meta = { ...snap.meta, version: current };
		return this.commit(`revert to version ${version}`);
	}

	private snapshotPath(version: number): string {
		return join(this.dir, "history", `${String(version).padStart(5, "0")}.json`);
	}
}
