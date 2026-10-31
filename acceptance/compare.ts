// Plays two skeletons side by side with the official runtime and compares every bone, slot colour,
// visible attachment (with its image sequence frame), attachment vertex and the draw order at every frame.
import {
	type Attachment,
	AtlasAttachmentLoader,
	type Event,
	MixFrom,
	Physics,
	PointAttachment,
	RegionAttachment,
	Skeleton,
	type SkeletonData,
	TextureAtlas,
	type TextureAtlasRegion,
	Vector2,
	VertexAttachment,
} from "@esotericsoftware/spine-core";

export const FPS = 30;
/** Spine writes floats with fewer digits than the runtime keeps; anything below this is rounding.
 * Pixels for positions, hundredths for scales and colours. */
export const TOLERANCE = 0.05;

/** Loader that gives every attachment a 1x1 region: the comparison needs geometry, not pixels. */
export class PlaceholderLoader extends AtlasAttachmentLoader {
	private readonly region: TextureAtlasRegion;
	constructor() {
		const atlas = new TextureAtlas("placeholder.png\nsize:1,1\nfilter:Linear,Linear\nplaceholder\nbounds:0,0,1,1\n");
		super(atlas);
		this.region = atlas.regions[0];
	}
	protected findRegion(): TextureAtlasRegion {
		return this.region;
	}
}

function worldVertices(skeleton: Skeleton, slotIndex: number, att: Attachment | null): number[] {
	const slot = skeleton.slots[slotIndex];
	if (att instanceof RegionAttachment) {
		const v = new Array<number>(8);
		att.computeWorldVertices(slot, att.getOffsets(slot.appliedPose), v, 0, 2);
		return v;
	}
	// Meshes, bounding boxes, clippings and paths (weighted or not).
	if (att instanceof VertexAttachment) {
		const v = new Array<number>(att.worldVerticesLength);
		att.computeWorldVertices(skeleton, slot, 0, att.worldVerticesLength, v, 0, 2);
		return v;
	}
	if (att instanceof PointAttachment) {
		const p = att.computeWorldPosition(slot.bone.appliedPose, new Vector2());
		return [p.x, p.y, att.computeWorldRotation(slot.bone.appliedPose), 0];
	}
	return [];
}

export interface Pose {
	values: number[];
	labels: string[];
	attachments: (string | null)[];
	order: string[];
}

export function pose(skeleton: Skeleton): Pose {
	const values: number[] = [];
	const labels: string[] = [];
	for (const b of skeleton.bones) {
		const p = b.appliedPose;
		for (const [k, v] of Object.entries({ x: p.worldX, y: p.worldY, a: p.a, b: p.b, c: p.c, d: p.d })) {
			values.push(k === "x" || k === "y" ? v : v * 100);
			labels.push(`bone ${b.data.name} ${k}`);
		}
	}
	const attachments: (string | null)[] = [];
	skeleton.slots.forEach((s, i) => {
		const att = s.appliedPose.getAttachment();
		// Frames of an image sequence share one attachment; the index tells them apart.
		attachments.push(att ? `${att.name}#${s.appliedPose.sequenceIndex}` : null);
		const c = s.appliedPose.color;
		for (const [k, v] of Object.entries({ r: c.r, g: c.g, b: c.b, a: c.a })) {
			values.push(v * 100);
			labels.push(`slot ${s.data.name} ${k}`);
		}
		worldVertices(skeleton, i, att).forEach((v, j) => {
			values.push(v);
			labels.push(`slot ${s.data.name} vertex ${j >> 1}`);
		});
	});
	return { values, labels, attachments, order: skeleton.drawOrder.appliedPose.map((s) => s.data.name) };
}

export interface Compared {
	asset: string;
	animation: string;
	frames: number;
	worst: number;
	where: string;
	problems: string[];
	/** Events the animation fires, the same before and after when problems is empty. */
	events?: number;
}

/** Plays one animation in both skeletons, frame by frame, with physics. `phase` (0..1) shifts the samples off
 * the frame times, where keys sit and a float32 rounding can land a sample on either side of a step. */
export function compareAnimation(asset: string, a: SkeletonData, b: SkeletonData, name: string, tolerance = TOLERANCE, phase = 0): Compared {
	const out: Compared = { asset, animation: name, frames: 0, worst: 0, where: "", problems: [] };
	const animA = a.findAnimation(name);
	const animB = b.findAnimation(name);
	if (!animA || !animB) {
		out.problems.push("animation missing after the round trip");
		return out;
	}
	if (Math.abs(animA.duration - animB.duration) > 1e-3) out.problems.push(`duration ${animA.duration} became ${animB.duration}`);
	const sa = new Skeleton(a);
	const sb = new Skeleton(b);
	const frames = Math.round(animA.duration * FPS);
	for (let i = 0; i <= frames; i++) {
		const t = Math.min((i + (i > 0 ? phase : 0)) / FPS, animA.duration);
		const poses = ([
			[sa, animA],
			[sb, animB],
		] as const).map(([s, anim]) => {
			s.setupPose();
			anim.apply(s, t, t, false, null, 1, MixFrom.current, false, false, false);
			if (i > 0) s.update(1 / FPS);
			s.updateWorldTransform(i === 0 ? Physics.reset : Physics.update);
			return pose(s);
		});
		const [pa, pb] = poses;
		out.frames++;
		if (pa.values.length !== pb.values.length) {
			out.problems.push(`frame ${i}: pose has ${pa.values.length} values, ${pb.values.length} after the round trip`);
			break;
		}
		pa.values.forEach((v, k) => {
			const d = Math.abs(v - pb.values[k]);
			if (d > out.worst) {
				out.worst = d;
				out.where = `${pa.labels[k]} at frame ${i}`;
			}
		});
		if (pa.attachments.join() !== pb.attachments.join()) out.problems.push(`frame ${i}: visible attachments differ`);
		if (pa.order.join() !== pb.order.join()) out.problems.push(`frame ${i}: draw order differs`);
		if (out.problems.length > 5) break;
	}
	if (out.worst > tolerance) out.problems.push(`max difference ${out.worst.toFixed(3)} (${out.where})`);
	const fired = (s: SkeletonData, anim: typeof animA) => {
		const events: Event[] = [];
		anim.apply(new Skeleton(s), -1, anim.duration, false, events, 1, MixFrom.current, false, false, false);
		return events.map((e) => `${e.data.name}@${e.time.toFixed(3)} ${e.intValue} ${e.floatValue.toFixed(3)} "${e.stringValue}" ${e.volume.toFixed(2)} ${e.balance.toFixed(2)}`);
	};
	const [ea, eb] = [fired(a, animA), fired(b, animB)];
	if (ea.join("|") !== eb.join("|")) out.problems.push(`events differ: ${ea.join(", ")} became ${eb.join(", ")}`);
	out.events = ea.length;
	return out;
}

export function compareStructure(a: SkeletonData, b: SkeletonData): string[] {
	const problems: string[] = [];
	const names = (label: string, x: { name: string }[], y: { name: string }[]) => {
		const [p, q] = [x.map((e) => e.name).join(", "), y.map((e) => e.name).join(", ")];
		if (p !== q) problems.push(`${label}: [${p}] became [${q}]`);
	};
	names("bones", a.bones, b.bones);
	names("slots", a.slots, b.slots);
	names("constraints", a.constraints, b.constraints);
	names("skins", a.skins, b.skins);
	names("animations", a.animations, b.animations);
	names("events", a.events, b.events);
	for (const skin of a.skins) {
		const other = b.findSkin(skin.name);
		if (!other) continue;
		const list = (s: typeof skin) =>
			s
				.getAttachments()
				.map((e) => `${a.slots[e.slotIndex].name}/${e.placeholder}:${e.attachment.constructor.name}`)
				.sort()
				.join(", ");
		if (list(skin) !== list(other)) problems.push(`skin ${skin.name}: attachments differ`);
	}
	return problems;
}
