// Spine 4.3 skeleton JSON, as far as rydspine writes it. Unknown fields are preserved.

export type Curve = "stepped" | number[];

export interface ValueKey {
	time?: number;
	value?: number;
	curve?: Curve;
}

export interface BoneJson {
	name: string;
	parent?: string;
	length?: number;
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	shearX?: number;
	shearY?: number;
	inherit?: string;
	color?: string;
	[key: string]: unknown;
}

export interface SlotJson {
	name: string;
	bone: string;
	attachment?: string;
	color?: string;
	blend?: string;
	[key: string]: unknown;
}

export interface RegionJson {
	type?: "region";
	path?: string;
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	width: number;
	height: number;
	[key: string]: unknown;
}

export interface MeshJson {
	type: "mesh";
	path?: string;
	uvs: number[];
	triangles: number[];
	vertices: number[];
	hull: number;
	edges?: number[];
	width: number;
	height: number;
	[key: string]: unknown;
}

export type AttachmentJson = RegionJson | MeshJson | ({ type: string } & Record<string, unknown>);

export interface SkinJson {
	name: string;
	attachments: Record<string, Record<string, AttachmentJson>>;
	[key: string]: unknown;
}

export interface ConstraintJson {
	type: "ik" | "transform" | "path" | "physics" | "slider";
	name: string;
	[key: string]: unknown;
}

export interface AnimationJson {
	bones?: Record<string, Record<string, ValueKey[]>>;
	slots?: Record<string, Record<string, unknown[]>>;
	[key: string]: unknown;
}

export interface SkeletonDoc {
	skeleton: {
		spine: string;
		hash?: string;
		x?: number;
		y?: number;
		width?: number;
		height?: number;
		images?: string;
		audio?: string;
		[key: string]: unknown;
	};
	bones: BoneJson[];
	slots: SlotJson[];
	constraints: ConstraintJson[];
	skins: SkinJson[];
	animations: Record<string, AnimationJson>;
	[key: string]: unknown;
}

/** rydspine metadata that has no place in Spine JSON. */
export interface ProjectMeta {
	name: string;
	version: number;
	loops: Record<string, boolean>;
	locks: { bones: string[]; slots: string[]; animations: string[] };
}

/** Editor version written into new skeletons; matches the Spine Editor the JSON will be imported into. */
export const SPINE_VERSION = process.env.RYDSPINE_SPINE_VERSION ?? "4.3.26";

export function emptySkeleton(): SkeletonDoc {
	return {
		skeleton: { spine: SPINE_VERSION, images: "./images/", audio: "" },
		bones: [{ name: "root" }],
		slots: [],
		constraints: [],
		skins: [{ name: "default", attachments: {} }],
		animations: {},
	};
}
