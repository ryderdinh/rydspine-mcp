// Imports PSD layers as parts: one PNG + slot per visible pixel layer, keeping position, order,
// opacity and blend mode. "<name>[pivot]" marker layers become bones, nested like the PSD groups.
// Files are read structure-first so oversized layers are refused before decoding.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { initializeCanvas, type Layer, readPsd } from "ag-psd";
import { PNG } from "pngjs";
import { addBone, addPart } from "./rig.js";
import { UserError, type Workspace } from "./workspace.js";

// ag-psd allocates pixel buffers through a canvas hook; Node has no canvas, and plain RGBA buffers are all we need.
initializeCanvas(
	() => {
		throw new Error("canvas is not available");
	},
	(width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
);

const MAX_SIDE = 8192;
const MEMORY_LIMIT = 1024 * 1024 * 1024;
const MAX_LAYERS = 500;

const BLEND: Record<string, string> = {
	multiply: "multiply",
	screen: "screen",
	"linear dodge": "additive",
	"color dodge": "additive",
	lighten: "additive",
};

export type Origin = "bottom-center" | "center" | "top-left";

export interface PsdSpec {
	psd: string;
	origin?: Origin;
	includeHidden?: boolean;
	/** Prefix image names with their group path ("arm/upper"). */
	keepGroups?: boolean;
}

export interface PsdPart {
	slot: string;
	bone: string;
	width: number;
	height: number;
	x: number;
	y: number;
	note?: string;
}

export interface PsdBone {
	bone: string;
	parent: string;
	x: number;
	y: number;
}

const clean = (name: string) => name.trim().replace(/[^A-Za-z0-9 _.-]+/g, "_").replace(/^\.+/, "_") || "layer";

export function importPsd(
	ws: Workspace,
	spec: PsdSpec,
): { parts: PsdPart[]; bones: PsdBone[]; skipped: string[]; canvas: string } {
	const buffer = readFileSync(spec.psd);
	// Pass 1: structure only, so oversized documents and layers are refused before any pixels are decoded.
	const outline = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
	if (outline.width > MAX_SIDE || outline.height > MAX_SIDE)
		throw new UserError(`PSD is ${outline.width}x${outline.height}; max ${MAX_SIDE}px per side`);
	if ((outline.bitsPerChannel ?? 8) !== 8) throw new UserError("only 8-bit PSDs are supported");
	if (outline.colorMode !== undefined && outline.colorMode !== 3) throw new UserError("only RGB PSDs are supported");
	let layers = 0;
	const check = (l: Layer) => {
		if (++layers > MAX_LAYERS) throw new UserError(`more than ${MAX_LAYERS} layers`);
		const w = (l.right ?? 0) - (l.left ?? 0);
		const h = (l.bottom ?? 0) - (l.top ?? 0);
		if (w > MAX_SIDE || h > MAX_SIDE) throw new UserError(`layer "${l.name}" is ${w}x${h}; max ${MAX_SIDE}px`);
		l.children?.forEach(check);
	};
	outline.children?.forEach(check);
	// Pass 2: decode layer pixels as plain RGBA (no canvas needed in Node).
	const psd = readPsd(buffer, {
		useImageData: true,
		skipCompositeImageData: true,
		skipThumbnail: true,
		totalMemoryLimit: MEMORY_LIMIT,
	});

	const origin = spec.origin ?? "bottom-center";
	const ox = origin === "top-left" ? 0 : psd.width / 2;
	const oy = origin === "bottom-center" ? psd.height : origin === "center" ? psd.height / 2 : 0;

	const parts: PsdPart[] = [];
	const skipped: string[] = [];
	const bones: PsdBone[] = [];
	const used = new Set([...ws.imageNames(), ...ws.doc.slots.map((s) => s.name)]);
	const boneNames = new Set(ws.doc.bones.map((b) => b.name));

	// The center of a marker layer, in world space.
	const pivotOf = (l: Layer) => ({
		x: ((l.left ?? 0) + (l.right ?? 0)) / 2 - ox,
		y: oy - ((l.top ?? 0) + (l.bottom ?? 0)) / 2,
	});
	const makeBone = (name: string, parent: string, at: { x: number; y: number }) => {
		const base = boneName(name);
		let bone = base;
		for (let i = 2; boneNames.has(bone); i++) bone = `${base.slice(0, 60)}-${i}`;
		boneNames.add(bone);
		addBone(ws, { name: bone, parent, x: at.x, y: at.y, space: "world" });
		bones.push({ bone, parent, x: at.x, y: at.y });
		return bone;
	};

	// ag-psd lists children bottom to top, which is Spine's draw order (back to front).
	const visitGroup = (
		children: Layer[],
		group: string | undefined,
		path: string[],
		hidden: boolean,
		opacity: number,
		parentBone: string,
	) => {
		// "<name>[pivot]" marks the pivot of the sibling layer or group called <name>; a bare "[pivot]",
		// or one named after the enclosing group, marks the group's own pivot. Markers may be hidden.
		const pivots = new Map<string, Layer>();
		let groupPivot: Layer | undefined;
		const names = new Set(children.filter((c) => !PIVOT.test(c.name ?? "")).map((c) => clean(c.name ?? "layer")));
		for (const child of children) {
			const m = child.children ? null : PIVOT.exec(child.name ?? "");
			if (!m) continue;
			const target = m[1] ? clean(m[1]) : "";
			const label = [...path, child.name ?? ""].join("/");
			if (target && names.has(target)) {
				if (pivots.has(target)) skipped.push(`${label} (second pivot for "${target}"; first one used)`);
				else pivots.set(target, child);
			} else if (group !== undefined && (target === "" || target === group)) {
				if (groupPivot) skipped.push(`${label} (second pivot for group "${group}"; first one used)`);
				else groupPivot = child;
			} else skipped.push(`${label} (pivot marker: no layer or group named "${m[1] || "(none)"}" next to it)`);
		}
		let bone = parentBone;
		if (groupPivot && group !== undefined) bone = makeBone(group, parentBone, pivotOf(groupPivot));
		for (const child of children) {
			if (!child.children && PIVOT.test(child.name ?? "")) continue;
			visit(child, path, hidden, opacity, bone, pivots.get(clean(child.name ?? "layer")));
		}
	};

	const visit = (
		layer: Layer,
		path: string[],
		hiddenParent: boolean,
		parentOpacity: number,
		parentBone: string,
		pivot: Layer | undefined,
	) => {
		const name = clean(layer.name ?? "layer");
		const hidden = hiddenParent || !!layer.hidden;
		const opacity = parentOpacity * (layer.opacity ?? 1);
		const label = [...path, name].join("/");
		if (layer.children) {
			// A pivot placed next to a group works like one placed inside it.
			const children = pivot ? [{ ...pivot, name: "[pivot]" }, ...layer.children] : layer.children;
			visitGroup(children, name, [...path, name], hidden, opacity, parentBone);
			return;
		}
		if (hidden && !spec.includeHidden) return void skipped.push(`${label} (hidden)`);
		if (layer.text || layer.adjustment) return void skipped.push(`${label} (text/adjustment layer: rasterize it first)`);
		const width = (layer.right ?? 0) - (layer.left ?? 0);
		const height = (layer.bottom ?? 0) - (layer.top ?? 0);
		if (width <= 0 || height <= 0) return void skipped.push(`${label} (empty)`);
		const pixels = layer.imageData;
		if (!pixels) return void skipped.push(`${label} (no pixels)`);

		let image = spec.keepGroups ? [...path, name].join("/") : name;
		for (let i = 2; used.has(image); i++) image = `${spec.keepGroups ? [...path, name].join("/") : name}-${i}`;
		used.add(image);

		const png = new PNG({ width, height });
		png.data = Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
		const file = ws.imagePath(image);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, PNG.sync.write(png));

		const x = (layer.left ?? 0) + width / 2 - ox;
		const y = oy - ((layer.top ?? 0) + height / 2);
		const slot: Record<string, unknown> = {};
		if (opacity < 1) slot.color = `ffffff${Math.round(opacity * 255).toString(16).padStart(2, "0")}`;
		const mode = layer.blendMode ?? "normal";
		let note: string | undefined;
		if (BLEND[mode]) slot.blend = BLEND[mode];
		else if (mode !== "normal" && mode !== "pass through") note = `blend mode "${mode}" has no Spine equivalent; using normal`;
		if (hidden) note = "hidden in the PSD: imported with no attachment shown";
		const bone = pivot ? makeBone(name, parentBone, pivotOf(pivot)) : parentBone;
		const added = addPart(ws, { image, x, y, slot, bone });
		if (hidden) delete ws.doc.slots[ws.doc.slots.length - 1].attachment;
		parts.push({ slot: added.slot, bone, width, height, x, y, note });
	};
	visitGroup(psd.children ?? [], undefined, [], false, 1, "root");
	if (!parts.length) throw new UserError("no visible pixel layers found in the PSD");
	return { parts, bones, skipped, canvas: `${psd.width}x${psd.height}, origin ${origin}` };
}

const PIVOT = /^\s*(.*?)\s*\[pivot\]\s*$/i;

/** Layer names allow spaces and dots; bone names do not. */
function boneName(name: string): string {
	const n = name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
	return /^[A-Za-z0-9]/.test(n) ? n : `b${n}`.slice(0, 64);
}
