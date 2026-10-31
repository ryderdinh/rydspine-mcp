// Deform keys: reshape a mesh over time (a glow stretching into a streak, a flag bulging, a blob squashing).
// Shapes are described as moves in world space; they are turned into the per-vertex offsets Spine stores.
import { MeshAttachment, Physics } from "@esotericsoftware/spine-core";
import { animation, type EaseSpec, easeCurve, mergeKeys, r3, rt } from "./motion.js";
import { assertUnlocked } from "./rig.js";
import { boneByName, load } from "./runtime.js";
import type { Curve } from "./types.js";
import { UserError, type Workspace } from "./workspace.js";

/** One change of shape, in world space, applied on top of the moves before it. */
export interface DeformMove {
	/** Center of scaling and rotation, and of the falloff. Default: the center of the mesh's bounds. */
	pivot?: { x: number; y: number };
	/** Scale along `angle` (scaleX) and across it (scaleY). */
	scaleX?: number;
	scaleY?: number;
	/** Direction of the scale axes, degrees counter-clockwise (default 0: world x). */
	angle?: number;
	/** Rotation around the pivot, degrees counter-clockwise. */
	rotate?: number;
	/** Translation in px. */
	x?: number;
	y?: number;
	/** Only vertices within this distance of the pivot move, fully at the pivot and fading to none at the edge. */
	radius?: number;
}

export interface DeformKey {
	time: number;
	/** No moves: the setup shape. */
	moves?: DeformMove[];
	ease?: EaseSpec;
}

interface DeformKeyJson {
	time: number;
	offset?: number;
	vertices?: number[];
	curve?: Curve;
}

export interface DeformSpec {
	animation: string;
	slot: string;
	attachment?: string;
	skin?: string;
	keys: DeformKey[];
}

/** Writes deform keys for a mesh; returns a line per key with how far the vertices moved. */
export function writeDeformKeys(ws: Workspace, s: DeformSpec): string {
	assertUnlocked(ws, "animations", [s.animation]);
	assertUnlocked(ws, "slots", [s.slot]);
	const anim = animation(ws, s.animation);
	const slotJson = ws.doc.slots.find((x) => x.name === s.slot);
	if (!slotJson) throw new UserError(`slot "${s.slot}" not found`);
	const skin = s.skin ?? "default";
	const name = s.attachment ?? slotJson.attachment ?? s.slot;
	const skinJson = ws.doc.skins.find((x) => x.name === skin);
	if (!skinJson) throw new UserError(`skin "${skin}" not found`);
	const att = skinJson.attachments[s.slot]?.[name];
	if (!att) throw new UserError(`attachment "${name}" not found in slot "${s.slot}" of skin "${skin}"`);
	if (att.type === "linkedmesh") throw new UserError(`"${name}" is a linked mesh; key the deform on its parent mesh`);
	if (att.type !== "mesh") throw new UserError(`"${name}" is not a mesh; make one with mesh_generate first`);
	if (!s.keys.length) return "";

	// Setup-pose world positions of the vertices, and what turns a world move into Spine's offsets.
	const { skeleton, data } = load(ws);
	skeleton.setupPose();
	skeleton.updateWorldTransform(Physics.none);
	const slot = skeleton.findSlot(s.slot)!;
	const mesh = data.findSkin(skin)?.getAttachment(slot.data.index, name);
	if (!(mesh instanceof MeshAttachment)) throw new UserError(`"${name}" is not a mesh`);
	const n = mesh.worldVerticesLength / 2;
	const world = new Array<number>(n * 2);
	mesh.computeWorldVertices(skeleton, slot, 0, n * 2, world, 0, 2);
	// Each offset entry is in the space of one bone: the slot's bone, or each bone weighting the vertex.
	const entries: { vertex: number; bone: number }[] = [];
	if (mesh.bones)
		for (let i = 0, v = 0; i < mesh.bones.length; v++) for (let count = mesh.bones[i++]; count > 0; count--) entries.push({ vertex: v, bone: mesh.bones[i++] });
	else {
		const bone = boneByName(skeleton, slotJson.bone).data.index;
		for (let v = 0; v < n; v++) entries.push({ vertex: v, bone });
	}

	const xs = world.filter((_, i) => i % 2 === 0);
	const ys = world.filter((_, i) => i % 2 === 1);
	const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
	const sorted = [...s.keys].sort((a, b) => a.time - b.time);
	const report: string[] = [];
	const fresh: DeformKeyJson[] = sorted.map((k, ki) => {
		const moved = [...world];
		for (const m of k.moves ?? []) apply(moved, world, m, center);
		const offsets: number[] = [];
		for (const { vertex, bone } of entries) {
			const p = skeleton.bones[bone].appliedPose;
			const dx = moved[vertex * 2] - world[vertex * 2];
			const dy = moved[vertex * 2 + 1] - world[vertex * 2 + 1];
			const det = p.a * p.d - p.b * p.c;
			if (Math.abs(det) < 1e-9) throw new UserError(`bone "${skeleton.bones[bone].data.name}" is scaled to zero in the setup pose`);
			offsets.push(r3((p.d * dx - p.b * dy) / det), r3((p.a * dy - p.c * dx) / det));
		}
		let most = 0;
		for (let v = 0; v < n; v++) most = Math.max(most, Math.hypot(moved[v * 2] - world[v * 2], moved[v * 2 + 1] - world[v * 2 + 1]));
		report.push(`${r3(k.time)}s: vertices move up to ${most.toFixed(1)}px`);

		const out: DeformKeyJson = { time: rt(k.time) };
		const first = offsets.findIndex((o) => o !== 0);
		if (first >= 0) {
			let last = offsets.length - 1;
			while (offsets[last] === 0) last--;
			if (first > 0) out.offset = first;
			out.vertices = offsets.slice(first, last + 1);
		}
		const next = sorted[ki + 1];
		const curve = next && k.ease ? easeCurve(k.ease, k.time, 0, next.time, 1) : undefined;
		if (curve) out.curve = curve;
		return out;
	});

	const bySkin = (anim.attachments ??= {}) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
	const timelines = (((bySkin[skin] ??= {})[s.slot] ??= {})[name] ??= {});
	timelines.deform = mergeKeys((timelines.deform ?? []) as DeformKeyJson[], fresh);
	return `${s.slot}/${name}: ${n} vertices\n${report.join("\n")}`;
}

/** Moves the vertices (`moved`, in place) by one move; the falloff is measured on the setup shape (`setup`). */
function apply(moved: number[], setup: number[], m: DeformMove, center: { x: number; y: number }): void {
	const pivot = m.pivot ?? center;
	const axis = ((m.angle ?? 0) * Math.PI) / 180;
	const [ca, sa] = [Math.cos(axis), Math.sin(axis)];
	const turn = ((m.rotate ?? 0) * Math.PI) / 180;
	const [ct, st] = [Math.cos(turn), Math.sin(turn)];
	const [sx, sy] = [m.scaleX ?? 1, m.scaleY ?? 1];
	if (m.radius !== undefined && m.radius <= 0) throw new UserError("radius must be greater than 0");
	for (let i = 0; i < moved.length; i += 2) {
		let w = 1;
		if (m.radius !== undefined) {
			const d = Math.hypot(setup[i] - pivot.x, setup[i + 1] - pivot.y);
			w = d >= m.radius ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / m.radius));
		}
		if (w === 0) continue;
		const [x, y] = [moved[i] - pivot.x, moved[i + 1] - pivot.y];
		// Into the axis frame, scale, back out, then rotate and translate.
		const u = (x * ca + y * sa) * sx;
		const v = (-x * sa + y * ca) * sy;
		const [bx, by] = [u * ca - v * sa, u * sa + v * ca];
		const tx = pivot.x + bx * ct - by * st + (m.x ?? 0);
		const ty = pivot.y + bx * st + by * ct + (m.y ?? 0);
		moved[i] += w * (tx - moved[i]);
		moved[i + 1] += w * (ty - moved[i + 1]);
	}
}
