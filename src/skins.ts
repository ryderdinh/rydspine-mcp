// Skins: named sets of attachments that swap a character's look (outfits, colors, equipment) on the
// same rig. A skin entry shadows the default skin's attachment with the same placeholder name.
import { join } from "node:path";
import { imageSize } from "./atlas.js";
import { assertUnlocked, findSlot } from "./rig.js";
import type { MeshJson, RegionJson, SkinJson } from "./types.js";
import { checkName, UserError, type Workspace } from "./workspace.js";

function skin(ws: Workspace, name: string): SkinJson {
	const s = ws.doc.skins.find((x) => x.name === name);
	if (!s) throw new UserError(`skin "${name}" not found`);
	return s;
}

export function createSkin(ws: Workspace, name: string, copyFrom?: string): void {
	checkName("skin", name);
	if (ws.doc.skins.some((s) => s.name === name)) throw new UserError(`skin "${name}" already exists`);
	const attachments = copyFrom && copyFrom !== "default" ? structuredClone(skin(ws, copyFrom).attachments) : {};
	ws.doc.skins.push({ name, attachments });
}

export function removeSkin(ws: Workspace, name: string): void {
	if (name === "default") throw new UserError("the default skin cannot be removed");
	skin(ws, name);
	ws.doc.skins = ws.doc.skins.filter((s) => s.name !== name);
}

export interface VariantSpec {
	skin: string;
	slot: string;
	/** A PNG to import, or the name of an image already in the project. */
	image: string;
	/** Placeholder to replace; defaults to the slot's setup attachment. */
	placeholder?: string;
}

/**
 * Puts a different image in a slot for one skin, laid out like the default skin's attachment. A
 * region becomes a region of the new image's size at the same place; a mesh becomes a linked mesh
 * that reuses the original's vertices, weights and deform keys.
 */
export function addVariant(ws: Workspace, v: VariantSpec): string {
	assertUnlocked(ws, "slots", [v.slot]);
	if (v.skin === "default") throw new UserError("variants go in a named skin; the default skin holds the originals");
	const target = skin(ws, v.skin);
	const slot = findSlot(ws, v.slot);
	const placeholder = v.placeholder ?? slot.attachment;
	if (!placeholder) throw new UserError(`slot "${v.slot}" shows nothing in the setup pose; give the placeholder to replace`);
	const base = ws.doc.skins.find((s) => s.name === "default")?.attachments[v.slot]?.[placeholder];
	if (!base) throw new UserError(`the default skin has no attachment "${placeholder}" in slot "${v.slot}" to base the variant on`);

	const image = v.image.toLowerCase().endsWith(".png") ? ws.addImage(v.image) : v.image;
	if (!ws.imageNames().includes(image)) throw new UserError(`image "${image}" not found; give a PNG path or an imported image name`);
	const { width, height } = imageSize(join(ws.imagesDir, `${image}.png`));

	let att: Record<string, unknown>;
	if (base.type === undefined || base.type === "region") {
		const { x, y, rotation, scaleX, scaleY } = base as RegionJson;
		att = { path: image, width, height };
		for (const [k, val] of Object.entries({ x, y, rotation, scaleX, scaleY })) if (val !== undefined) att[k] = val;
	} else if (base.type === "mesh") {
		const mesh = base as MeshJson;
		if (Math.abs(width / height - mesh.width / mesh.height) > 0.02)
			throw new UserError(
				`the mesh variant image is ${width}x${height} but the original is ${mesh.width}x${mesh.height}; a linked mesh reuses UVs, so keep the same proportions`,
			);
		att = { type: "linkedmesh", path: image, source: placeholder, width, height };
	} else {
		throw new UserError(`"${placeholder}" is a ${base.type} attachment, which has no image to swap`);
	}
	(target.attachments[v.slot] ??= {})[placeholder] = att as never;
	return `${v.skin}: slot ${v.slot} shows ${image} (${att.type ?? "region"}) in place of ${placeholder}`;
}
