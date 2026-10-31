// MCP tool surface. Every editing tool runs on a fresh copy of the project, checks the result with the
// Spine 4.3 runtime, and only then saves it as a new version (so a rejected edit changes nothing).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	bounce,
	CONSTRAINT_PROPERTIES,
	defineEvent,
	EASES,
	gait,
	oscillate,
	PROPERTIES,
	SEQUENCE_MODES,
	SLOT_PROPERTIES,
	tween,
	removeEvent,
	writeConstraintKeys,
	writeDrawOrderKeys,
	writeEventKeys,
	writeKeys,
	writeSequenceKeys,
	writeSlotKeys,
} from "./motion.js";
import { diffVersions } from "./diff.js";
import { importProject, syncProject } from "./importer.js";
import { exportProject, rasterize, renderSvg } from "./preview.js";
import { importPsd } from "./psd.js";
import {
	addBone,
	addConstraint,
	addShape,
	importSequence,
	assertUnlocked,
	describe,
	generateMesh,
	importImages,
	removeBone,
	removeConstraint,
	updateAttachment,
	updateBone,
	updateSlot,
} from "./rig.js";
import { footSlip, load, validate } from "./runtime.js";
import { addVariant, createSkin, removeSkin } from "./skins.js";
import * as templates from "./templates.js";
import { startStudio } from "./ui.js";
import type { ConstraintJson } from "./types.js";
import { checkName, UserError, Workspace } from "./workspace.js";

const INSTRUCTIONS = `rydspine builds Spine 4.3 rigs and animations as files.
Existing Spine exports can be brought in with project_import and edited with the same tools.
Workflow: project_create -> psd_import or image_import (place each part at its world position) -> rig_template (chain/hinge/wheel/limb/biped) or bone_add (joints, world space)
-> slot_update (bind parts to bones, keepWorld) -> mesh_generate / constraint_add where parts bend or follow
-> anim_create + anim_oscillate / anim_tween / anim_bounce / anim_set_keys -> validate -> preview -> export.
Coordinates: world space is y-up, units are pixels, rotations are degrees counter-clockwise.
Animation values are offsets from the setup pose (scalex/scaley are multipliers).
Every edit is a new version; history_revert undoes. Look at preview images before reporting success.`;

type Result = CallToolResult;
const text = (s: string): Result => ({ content: [{ type: "text", text: s }] });

async function run(fn: () => Promise<Result> | Result): Promise<Result> {
	try {
		return await fn();
	} catch (e) {
		const msg = e instanceof UserError ? e.message : `internal error: ${(e as Error).stack ?? e}`;
		return { isError: true, content: [{ type: "text", text: msg }] };
	}
}

/** Applies an edit, verifies the runtime still loads the skeleton, then commits it. */
function edit(project: string, message: string, fn: (ws: Workspace) => string | void): Promise<Result> {
	return run(() => {
		const ws = Workspace.open(project);
		const out = fn(ws);
		load(ws);
		const version = ws.commit(message);
		return text(`${out ? `${out}\n` : ""}saved as version ${version}`);
	});
}

const project = z.string().describe("Project name");
const space = z.enum(["local", "world"]).optional().describe("Coordinate space for x/y/rotation (default local)");
const property = z.enum(PROPERTIES);
const ease = z
	.union([z.enum(EASES), z.tuple([z.number().min(0).max(1), z.number(), z.number().min(0).max(1), z.number()])])
	.optional()
	.describe("Curve of the segment after the key: a preset, or a CSS cubic-bezier [x1, y1, x2, y2] (y may overshoot 0..1)");
const chain = {
	bones: z.array(z.string()).min(1).describe("Bones to animate; for a chain, list root to tip"),
	delayPerBone: z.number().optional().describe("Seconds each bone lags the previous one (follow-through)"),
	falloff: z.number().optional().describe("Amplitude multiplier per bone down the chain, e.g. 1.2 grows toward the tip"),
};

export function createServer(): McpServer {
	const server = new McpServer({ name: "rydspine", version: "0.1.0" }, { instructions: INSTRUCTIONS });

	server.registerTool(
		"project_create",
		{ description: "Create a new empty project (root bone only).", inputSchema: { name: z.string() } },
		({ name }) =>
			run(() => {
				const ws = Workspace.create(name);
				ws.commit("create project");
				return text(`created project ${ws.meta.name}`);
			}),
	);

	server.registerTool(
		"project_import",
		{
			description:
				"Import an existing Spine 4.3 export as a new project so it can be inspected and edited: the skeleton " +
				"JSON plus either the folder of source images or the .atlas file (its PNG pages are unpacked).",
			inputSchema: {
				name: z.string().describe("New project name"),
				skeleton: z.string().describe("Path to the exported skeleton .json"),
				images: z.string().optional().describe("Folder of source PNGs (Spine's images folder)"),
				atlas: z.string().optional().describe("Path to the .atlas, used when there is no images folder"),
				loops: z.array(z.string()).optional().describe("Animations that should loop seamlessly"),
			},
		},
		(spec) =>
			run(() => {
				const { ws, notes } = importProject(spec);
				return text([...notes, describe(ws)].join("\n"));
			}),
	);

	server.registerTool("project_list", { description: "List projects." }, () =>
		run(() => text(Workspace.list().join("\n") || "no projects")),
	);

	server.registerTool(
		"project_status",
		{ description: "Show the rig as text: bone tree, slots, constraints, animations, images.", inputSchema: { project } },
		({ project }) => run(() => text(describe(Workspace.open(project)))),
	);

	server.registerTool(
		"image_import",
		{
			description:
				"Import PNG parts. Each becomes a slot with the same name showing the image centered at world (x, y). " +
				"Import back-to-front: later images draw on top.",
			inputSchema: {
				project,
				images: z.array(
					z.object({
						path: z.string().describe("Path to a PNG file"),
						name: z.string().optional().describe("Slot/image name (default: file name)"),
						x: z.number().optional(),
						y: z.number().optional(),
						bone: z.string().optional().describe("Bone to attach to (default root)"),
					}),
				),
			},
		},
		({ project, images }) =>
			edit(project, `import ${images.length} image(s)`, (ws) =>
				importImages(ws, images)
					.map((i) => `${i.slot}: ${i.width}x${i.height}`)
					.join("\n"),
			),
	);

	server.registerTool(
		"psd_import",
		{
			description:
				"Import every visible pixel layer of a PSD as a part (image + slot), keeping position, layer order, " +
				"opacity and blend mode. World origin defaults to the bottom-center of the canvas (where feet stand).",
			inputSchema: {
				project,
				psd: z.string().describe("Path to the .psd file"),
				origin: z.enum(["bottom-center", "center", "top-left"]).optional(),
				includeHidden: z.boolean().optional().describe("Also import hidden layers (with nothing shown)"),
				keepGroups: z.boolean().optional().describe("Name images group/layer instead of layer"),
			},
		},
		({ project, ...spec }) =>
			edit(project, `import PSD ${spec.psd}`, (ws) => {
				const r = importPsd(ws, spec);
				return [
					`canvas ${r.canvas}; ${r.parts.length} parts (back to front):`,
					...r.parts.map(
						(p) => `  ${p.slot}: ${p.width}x${p.height} at (${p.x}, ${p.y})${p.note ? ` - ${p.note}` : ""}`,
					),
					...(r.skipped.length ? ["skipped:", ...r.skipped.map((s) => `  ${s}`)] : []),
				].join("\n");
			}),
	);

	server.registerTool(
		"image_view",
		{ description: "Return an imported image so you can look at it.", inputSchema: { project, image: z.string() } },
		({ project, image }) =>
			run(() => {
				const ws = Workspace.open(project);
				const data = readFileSync(ws.imagePath(image)).toString("base64");
				return { content: [{ type: "image", data, mimeType: "image/png" }] };
			}),
	);

	const boneShape = {
		parent: z.string().optional().describe("Parent bone (default root)"),
		x: z.number().optional(),
		y: z.number().optional(),
		rotation: z.number().optional(),
		length: z.number().optional(),
		scaleX: z.number().optional(),
		scaleY: z.number().optional(),
		color: z.string().optional().describe("RRGGBBAA"),
		space,
	};

	server.registerTool(
		"bone_add",
		{
			description: "Add bones, in order (parents first). With space=world, x/y/rotation are world values (e.g. joint positions on the art).",
			inputSchema: { project, bones: z.array(z.object({ name: z.string(), ...boneShape })).min(1) },
		},
		({ project, bones }) =>
			edit(project, `add bones ${bones.map((b) => b.name).join(", ")}`, (ws) => {
				for (const b of bones) addBone(ws, b);
			}),
	);

	server.registerTool(
		"bone_update",
		{
			description: "Move, reparent (keeps world position), rename or resize a bone.",
			inputSchema: { project, name: z.string(), rename: z.string().optional(), ...boneShape },
		},
		(args) => edit(args.project, `update bone ${args.name}`, (ws) => void updateBone(ws, args)),
	);

	server.registerTool(
		"bone_remove",
		{ description: "Remove an unused bone.", inputSchema: { project, name: z.string() } },
		({ project, name }) => edit(project, `remove bone ${name}`, (ws) => removeBone(ws, name)),
	);

	const point = z.object({ x: z.number(), y: z.number() });
	const leg = z.object({ start: point.describe("Shoulder / hip"), joint: point.describe("Elbow / knee, as drawn"), foot: point });
	const template = z.discriminatedUnion("kind", [
		z
			.object({
				kind: z.literal("chain"),
				name: z.string().describe("Bone name prefix: tail -> tail1, tail2, ..."),
				parent: z.string().optional(),
				points: z.array(point).min(2).describe("Base to tip; with 2 points, segments splits the line"),
				segments: z.number().int().min(1).max(20).optional(),
				slots: z.array(z.string()).optional().describe("Parts to bind and mesh along the chain"),
				physics: z.boolean().optional().describe("Add drag/settle physics to each bone"),
			})
			.describe("Tails, necks, tentacles, ropes, branches"),
		z
			.object({
				kind: z.literal("hinge"),
				name: z.string(),
				parent: z.string().optional(),
				pivot: point,
				tip: point.optional(),
				slots: z.array(z.string()).optional(),
			})
			.describe("Lids, doors, jaws, flaps"),
		z
			.object({
				kind: z.literal("wheel"),
				name: z.string(),
				parent: z.string().optional(),
				center: point,
				radius: z.number().positive(),
				slots: z.array(z.string()).optional(),
			})
			.describe("Wheels, gears, fans"),
		z
			.object({
				kind: z.literal("limb"),
				name: z.string(),
				parent: z.string().optional(),
				start: point.describe("Shoulder / hip"),
				joint: point.describe("Elbow / knee, as drawn"),
				end: point.describe("Wrist / ankle"),
				upperSlots: z.array(z.string()).optional(),
				lowerSlots: z.array(z.string()).optional(),
				endSlots: z.array(z.string()).optional().describe("Hand / foot parts"),
				targetParent: z.string().optional().describe("Owner of the IK target (default root: planted feet)"),
			})
			.describe("Arms and legs with IK"),
		z
			.object({
				kind: z.literal("biped"),
				hips: point,
				chest: point,
				neck: point,
				head: point,
				leftShoulder: point.optional(),
				leftElbow: point.optional(),
				leftHand: point.optional(),
				rightShoulder: point.optional(),
				rightElbow: point.optional(),
				rightHand: point.optional(),
				leftHip: point,
				leftKnee: point,
				leftFoot: point,
				rightHip: point,
				rightKnee: point,
				rightFoot: point,
				parts: z.record(z.string(), z.string()).optional().describe("slot -> bone"),
			})
			.describe("Two-legged character: hips, torso, neck, head, IK arms (left-arm-*) and legs (left-leg-*)"),
		z
			.object({
				kind: z.literal("quadruped"),
				hips: point.describe("Where the back legs attach"),
				chest: point.describe("Where the front legs attach"),
				neck: point,
				head: point,
				frontLeft: leg,
				frontRight: leg,
				backLeft: leg,
				backRight: leg,
				tail: z.array(point).min(2).optional().describe("Base to tip"),
				tailSegments: z.number().int().min(1).max(12).optional(),
				tailSlots: z.array(z.string()).optional(),
				parts: z.record(z.string(), z.string()).optional().describe("slot -> bone"),
			})
			.describe(
				"Four-legged animal: body, neck, head, IK legs (front-left-leg-*, back-right-leg-* ...), optional tail. " +
					"Walk with anim_gait: back-left 0, front-left 0.25, back-right 0.5, front-right 0.75",
			),
	]);

	server.registerTool(
		"rig_template",
		{
			description:
				"Build a common structure from a few world-space points (joints read off the art): chain (also tails, " +
				"necks and wings: bind the wing art and flap with anim_oscillate + delayPerBone), hinge, wheel, limb " +
				"(2 bones + IK), biped or quadruped. Faster and more consistent than adding bones one by one.",
			inputSchema: { project, template },
		},
		({ project, template }) =>
			edit(project, `rig template ${template.kind}`, (ws) => {
				const bones =
					template.kind === "chain"
						? templates.chain(ws, template)
						: template.kind === "hinge"
							? templates.hinge(ws, template)
							: template.kind === "wheel"
								? templates.wheel(ws, template)
								: template.kind === "limb"
									? templates.limb(ws, template)
									: template.kind === "biped"
										? templates.biped(ws, template)
										: templates.quadruped(ws, template);
				return `bones: ${bones.join(", ")}`;
			}),
	);

	server.registerTool(
		"slot_update",
		{
			description:
				"Bind a slot to a bone (keepWorld keeps the art where it is, default true), change the visible attachment, " +
				"color, blend mode, or draw order (0 = back).",
			inputSchema: {
				project,
				name: z.string(),
				bone: z.string().optional(),
				keepWorld: z.boolean().optional(),
				attachment: z.string().nullable().optional(),
				color: z.string().optional(),
				blend: z.enum(["normal", "additive", "multiply", "screen"]).optional(),
				drawOrder: z.number().int().optional(),
			},
		},
		(args) => edit(args.project, `update slot ${args.name}`, (ws) => void updateSlot(ws, args)),
	);

	server.registerTool(
		"sequence_import",
		{
			description:
				"Import PNG frames as one image sequence attachment (flipbook: flames, sparkles, blinking lights, " +
				"hand-drawn effects), centered at world (x, y). Makes a new slot on top, or adds the attachment to slot. " +
				"Play it with anim_sequence_keys.",
			inputSchema: {
				project,
				name: z.string().describe("Attachment name (and the new slot's name)"),
				images: z.array(z.string()).min(2).describe("PNG files, in playing order"),
				slot: z.string().optional().describe("Existing slot to add the attachment to"),
				x: z.number().optional(),
				y: z.number().optional(),
				bone: z.string().optional().describe("Bone for a new slot (default root)"),
				setup: z.number().int().min(0).optional().describe("Frame shown in the setup pose (default 0)"),
			},
		},
		(a) =>
			edit(a.project, `import sequence ${a.name}`, (ws) => {
				const r = importSequence(ws, a);
				return [`${r.slot}: ${r.frames} frames, ${r.width}x${r.height}`, ...r.warnings.map((w) => `warning: ${w}`)].join("\n");
			}),
	);

	server.registerTool(
		"attachment_update",
		{
			description: "Move, rotate or scale a region attachment inside its slot.",
			inputSchema: {
				project,
				slot: z.string(),
				attachment: z.string().optional(),
				x: z.number().optional(),
				y: z.number().optional(),
				rotation: z.number().optional(),
				scaleX: z.number().optional(),
				scaleY: z.number().optional(),
				space,
			},
		},
		(args) => edit(args.project, `update attachment in ${args.slot}`, (ws) => void updateAttachment(ws, args)),
	);

	server.registerTool(
		"shape_add",
		{
			description:
				"Add a point (a marker the game reads: muzzle, hand grip, spawn spot), a bounding box (hit area) or a " +
				"clipping mask, each in a new slot. Shapes are world points, or around=<slot> traces that slot's image " +
				"outline or mesh hull. A clipping masks the slots from `from` (default end) up to `end` and is placed " +
				"right below `from`.",
			inputSchema: {
				project,
				type: z.enum(["point", "boundingbox", "clipping"]),
				name: z.string().describe("attachment and new slot name"),
				bone: z.string().optional().describe("bone the slot follows (default: the bone of around, else root)"),
				x: z.number().optional().describe("point: world x (default the bone's origin)"),
				y: z.number().optional(),
				rotation: z.number().optional().describe("point: world rotation in degrees"),
				points: z.array(point).min(3).optional().describe("boundingbox/clipping: world polygon"),
				around: z.string().optional().describe("boundingbox/clipping: trace this slot's art instead of points"),
				padding: z.number().min(0).max(32).optional().describe("around: grow the outline by px (default 2)"),
				from: z.string().optional().describe("clipping: first slot masked"),
				end: z.string().optional().describe("clipping: last slot masked (required)"),
			},
		},
		({ project, ...spec }) =>
			edit(project, `add ${spec.type} ${spec.name}`, (ws) => {
				const r = addShape(ws, spec);
				const what = spec.type === "point" ? "point" : `${r.vertices} vertices`;
				return [`${spec.type} ${r.slot}: ${what}`, ...r.warnings.map((w) => `warning: ${w}`)].join("\n");
			}),
	);

	server.registerTool(
		"mesh_generate",
		{
			description:
				"Turn a region attachment into a mesh so it can bend. shape=contour (default) follows the image's opaque " +
				"outline; shape=grid covers the whole rectangle. Give bones to weight it automatically by distance " +
				"(bind the slot and place bones first).",
			inputSchema: {
				project,
				slot: z.string(),
				attachment: z.string().optional(),
				shape: z.enum(["contour", "grid"]).optional(),
				detail: z.number().positive().optional().describe("contour: max outline error in px (smaller = more hull vertices)"),
				spacing: z.number().positive().optional().describe("contour: interior vertex spacing in px"),
				padding: z.number().min(0).max(16).optional().describe("contour: grow outline by px (default 2)"),
				cols: z.number().int().min(1).max(32).optional().describe("grid columns (default 4)"),
				rows: z.number().int().min(1).max(32).optional().describe("grid rows (default 4)"),
				bones: z.array(z.string()).optional(),
				maxInfluences: z.number().int().min(1).max(4).optional(),
			},
		},
		(args) =>
			edit(args.project, `mesh ${args.slot}`, (ws) => {
				const r = generateMesh(ws, args);
				return [
					`${r.vertices} vertices, ${r.triangles} triangles${args.bones ? `, weighted to ${args.bones.join(", ")}` : ""}`,
					...r.warnings.map((w) => `warning: ${w}`),
				].join("\n");
			}),
	);

	const mix = z.number().min(0).max(1).optional();
	const constraint = z.discriminatedUnion("type", [
		z
			.object({
				type: z.literal("ik"),
				name: z.string(),
				bones: z.array(z.string()).min(1).max(2).describe("1 bone, or parent and child"),
				target: z.string(),
				bendPositive: z.boolean().optional(),
				mix,
				softness: z.number().optional(),
				stretch: z.boolean().optional(),
				compress: z.boolean().optional(),
			})
			.loose(),
		z
			.object({
				type: z.literal("transform"),
				name: z.string(),
				bones: z.array(z.string()).min(1),
				source: z.string(),
			})
			.loose()
			.describe("Spine 4.3 transform constraint; extra fields are passed through to the JSON"),
		z
			.object({
				type: z.literal("physics"),
				name: z.string(),
				bone: z.string(),
				x: z.number().optional(),
				y: z.number().optional(),
				rotate: z.number().optional(),
				scaleX: z.number().optional(),
				shearX: z.number().optional(),
				inertia: z.number().optional(),
				strength: z.number().optional(),
				damping: z.number().optional(),
				mass: z.number().optional(),
				wind: z.number().optional(),
				gravity: z.number().optional(),
				mix,
			})
			.loose()
			.describe("Secondary motion (hair, tails, antennae): set rotate to 1 for rotational follow"),
		z
			.object({
				type: z.literal("path"),
				name: z.string(),
				bones: z.array(z.string()).min(1).describe("bones laid along the path, parents first (e.g. a chain from rig_template)"),
				points: z
					.array(point)
					.min(2)
					.optional()
					.describe("world points the path passes through, read off the art; creates slot <name>-path with a smooth path"),
				closed: z.boolean().optional().describe("loop the path (treads, conveyor belts)"),
				pathBone: z.string().optional().describe("bone the new path slot follows (default root); bones on it bend the path"),
				pathBones: z
					.array(z.string())
					.optional()
					.describe("control bones that bend the new path, each point weighted to the nearest (like Spine's examples); not bones on the chain"),
				maxInfluences: z.number().int().min(1).max(4).optional().describe("bones per path point with pathBones (default 2)"),
				slot: z.string().optional().describe("existing slot holding a path attachment, instead of points"),
				positionMode: z.enum(["percent", "fixed"]).optional(),
				spacingMode: z.enum(["length", "fixed", "percent", "proportional"]).optional(),
				rotateMode: z.enum(["tangent", "chain", "chainScale"]).optional(),
				position: z.number().optional(),
				spacing: z.number().optional(),
				mixRotate: mix,
				mixX: mix,
				mixY: mix,
			})
			.loose()
			.describe("Bones follow a curve: rubber limbs (percent spacing, chainScale), chains and treads (length spacing, chain); animate position to slide along it"),
		z
			.object({
				type: z.literal("slider"),
				name: z.string(),
				animation: z.string().describe("existing animation the slider plays (create it first)"),
				time: z.number().optional().describe("setup time in seconds when no bone drives the slider"),
				bone: z.string().optional().describe("drive the time from this bone's property (a control bone)"),
				property: z.enum(["rotate", "x", "y", "scaleX", "scaleY", "shearY"]).optional(),
				from: z.number().optional().describe("property value that maps to time `to`"),
				to: z.number().optional(),
				scale: z.number().optional().describe("seconds per unit of the property (e.g. 1/360 for one turn per second)"),
				local: z.boolean().optional(),
				loop: z.boolean().optional(),
				additive: z.boolean().optional(),
				mix,
			})
			.loose()
			.describe("Pose an animation by a value: a dial, a facial expression blend, a turn-around sheet"),
	]);

	server.registerTool(
		"constraint_add",
		{ description: "Add an IK, transform, path, physics or slider constraint.", inputSchema: { project, constraint } },
		({ project, constraint }) =>
			edit(project, `add ${constraint.type} ${constraint.name}`, (ws) => void addConstraint(ws, constraint as ConstraintJson)),
	);

	server.registerTool(
		"constraint_remove",
		{ description: "Remove a constraint.", inputSchema: { project, name: z.string() } },
		({ project, name }) => edit(project, `remove constraint ${name}`, (ws) => removeConstraint(ws, name)),
	);

	server.registerTool(
		"skin_create",
		{
			description: "Create a skin (outfit, color scheme, equipment set). Optionally start from a copy of another skin.",
			inputSchema: { project, name: z.string(), copyFrom: z.string().optional() },
		},
		({ project, name, copyFrom }) => edit(project, `create skin ${name}`, (ws) => createSkin(ws, name, copyFrom)),
	);

	server.registerTool(
		"skin_variant",
		{
			description:
				"In one skin, show a different image in a slot, placed like the default skin's attachment. Meshes become " +
				"linked meshes, so the variant bends and deforms exactly like the original.",
			inputSchema: {
				project,
				skin: z.string(),
				slot: z.string(),
				image: z.string().describe("PNG path to import, or an image already in the project"),
				placeholder: z.string().optional().describe("Attachment to replace (default: the slot's setup attachment)"),
			},
		},
		({ project, ...v }) => edit(project, `skin ${v.skin}: ${v.slot}`, (ws) => addVariant(ws, v)),
	);

	server.registerTool(
		"skin_remove",
		{ description: "Delete a skin.", inputSchema: { project, name: z.string() } },
		({ project, name }) => edit(project, `remove skin ${name}`, (ws) => removeSkin(ws, name)),
	);

	server.registerTool(
		"anim_create",
		{
			description: "Create an empty animation (replaces nothing if it exists).",
			inputSchema: { project, name: z.string(), loop: z.boolean().describe("Loops seamlessly when played") },
		},
		({ project, name, loop }) =>
			edit(project, `create animation ${name}`, (ws) => {
				checkName("animation", name);
				if (ws.doc.animations[name]) throw new UserError(`animation "${name}" already exists`);
				ws.doc.animations[name] = {};
				ws.meta.loops[name] = loop;
			}),
	);

	server.registerTool(
		"anim_remove",
		{ description: "Delete an animation.", inputSchema: { project, name: z.string() } },
		({ project, name }) =>
			edit(project, `remove animation ${name}`, (ws) => {
				assertUnlocked(ws, "animations", [name]);
				if (!ws.doc.animations[name]) throw new UserError(`animation "${name}" not found`);
				const sliders = ws.doc.constraints.filter((c) => c.type === "slider" && c.animation === name);
				if (sliders.length) throw new UserError(`animation "${name}" is played by slider ${sliders.map((c) => c.name).join(", ")}`);
				delete ws.doc.animations[name];
				delete ws.meta.loops[name];
			}),
	);

	server.registerTool(
		"anim_set_keys",
		{
			description:
				"Set explicit keys on one bone property. Replaces existing keys between the first and last given time " +
				"(or `range`), keeping the rest. ease applies to the segment after each key.",
			inputSchema: {
				project,
				animation: z.string(),
				bone: z.string(),
				property,
				keys: z.array(z.object({ time: z.number().min(0), value: z.number(), ease: ease })).min(1),
				range: z.tuple([z.number(), z.number()]).optional(),
			},
		},
		(a) =>
			edit(a.project, `keys ${a.animation} ${a.bone}.${a.property}`, (ws) =>
				writeKeys(ws, a.animation, a.bone, a.property, a.keys, a.range),
			),
	);

	server.registerTool(
		"anim_oscillate",
		{
			description:
				"Smooth back-and-forth motion (flap, sway, breathe, bob, wag). Use delayPerBone on a chain for " +
				"follow-through (tails, necks, branches). In loop animations the period is fitted to whole cycles.",
			inputSchema: {
				project,
				animation: z.string(),
				property,
				amplitude: z.number(),
				period: z.number().positive().describe("Seconds per cycle"),
				start: z.number().min(0).optional(),
				end: z.number().optional().describe("Default: animation length, or one period"),
				phase: z.number().optional().describe("Starting phase in cycles (0..1)"),
				center: z.number().optional(),
				...chain,
			},
		},
		(a) => edit(a.project, `oscillate ${a.bones.join(",")}.${a.property}`, (ws) => oscillate(ws, a)),
	);

	server.registerTool(
		"anim_tween",
		{
			description:
				"Move a property from one value to another (open, turn, lean, spin: rotate to -360 for a full turn). " +
				"anticipation winds up the opposite way first (0.1-0.3).",
			inputSchema: {
				project,
				animation: z.string(),
				property,
				to: z.number(),
				from: z.number().optional(),
				start: z.number().min(0).optional(),
				duration: z.number().positive(),
				ease: ease,
				anticipation: z.number().min(0).max(1).optional(),
				...chain,
			},
		},
		(a) => edit(a.project, `tween ${a.bones.join(",")}.${a.property}`, (ws) => tween(ws, a)),
	);

	server.registerTool(
		"anim_bounce",
		{
			description:
				"Settle onto a value with bounces. style=spring overshoots and wobbles (logo pop, landing squash); " +
				"style=drop lands and rebounds (lid slamming, object dropping).",
			inputSchema: {
				project,
				animation: z.string(),
				property,
				from: z.number(),
				to: z.number(),
				start: z.number().min(0).optional(),
				duration: z.number().positive(),
				bounces: z.number().int().min(0).max(6).optional(),
				height: z.number().min(0).max(2).optional(),
				decay: z.number().min(0).max(1).optional(),
				style: z.enum(["spring", "drop"]).optional(),
				...chain,
			},
		},
		(a) => edit(a.project, `bounce ${a.bones.join(",")}.${a.property}`, (ws) => bounce(ws, a)),
	);

	server.registerTool(
		"anim_slot_keys",
		{
			description:
				"Key a slot: alpha (fade in/out, 0..1), rgba (tint RRGGBBAA, linear/stepped) or attachment (swap images: " +
				"blink, mouth shapes; name null hides). Replaces keys between the first and last given time.",
			inputSchema: {
				project,
				animation: z.string(),
				slot: z.string(),
				property: z.enum(SLOT_PROPERTIES),
				keys: z
					.array(
						z.object({
							time: z.number().min(0),
							value: z.number().min(0).max(1).optional(),
							color: z.string().optional(),
							name: z.string().nullable().optional(),
							ease: ease,
						}),
					)
					.min(1),
			},
		},
		(a) => edit(a.project, `slot keys ${a.animation} ${a.slot}.${a.property}`, (ws) => writeSlotKeys(ws, a.animation, a.slot, a.property, a.keys)),
	);

	server.registerTool(
		"anim_constraint_keys",
		{
			description:
				"Key a constraint over time. ik mix: mix (or value), softness, bendPositive, compress, stretch. " +
				"transform mix: mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY. path: position or spacing (value), " +
				"mix (mixRotate, mixX, mixY); animate position to slide bones along the path or roll treads. " +
				"physics: inertia, strength, damping, mass, wind, gravity, mix (value) or reset (time only; constraint \"\" = all " +
				"physics). slider: time (value, seconds into its animation) or mix. Channels a key leaves out keep the setup " +
				"value. Replaces keys between the first and last given time.",
			inputSchema: {
				project,
				animation: z.string(),
				constraint: z.string(),
				property: z.enum(CONSTRAINT_PROPERTIES),
				keys: z
					.array(
						z.object({
							time: z.number().min(0),
							value: z.number().optional(),
							mix: z.number().optional(),
							softness: z.number().optional(),
							bendPositive: z.boolean().optional(),
							compress: z.boolean().optional(),
							stretch: z.boolean().optional(),
							mixRotate: z.number().optional(),
							mixX: z.number().optional(),
							mixY: z.number().optional(),
							mixScaleX: z.number().optional(),
							mixScaleY: z.number().optional(),
							mixShearY: z.number().optional(),
							ease: ease,
						}),
					)
					.min(1),
			},
		},
		(a) =>
			edit(a.project, `constraint keys ${a.animation} ${a.constraint || "physics"}.${a.property}`, (ws) =>
				writeConstraintKeys(ws, a.animation, a.constraint, a.property, a.keys),
			),
	);

	server.registerTool(
		"event_define",
		{
			description:
				"Define an event a game listens for (footstep, hit, spawn, sound cue), or change its setup values; " +
				"anim_event_keys keys inherit them. audio is a path under the skeleton's audio folder; volume and balance " +
				"apply to audio events. remove deletes the event and every key that fires it.",
			inputSchema: {
				project,
				name: z.string(),
				int: z.number().int().optional(),
				float: z.number().optional(),
				string: z.string().optional(),
				audio: z.string().optional(),
				volume: z.number().min(0).max(1).optional(),
				balance: z.number().min(-1).max(1).optional(),
				remove: z.boolean().optional(),
			},
		},
		({ project, remove, ...d }) =>
			edit(project, `${remove ? "remove" : "define"} event ${d.name}`, (ws) => (remove ? removeEvent(ws, d.name) : defineEvent(ws, d))),
	);

	server.registerTool(
		"anim_event_keys",
		{
			description:
				"Fire events at times in an animation (footsteps on contact frames, a hit on impact, a sound cue). Values a " +
				"key leaves out come from event_define; undefined events are defined on the fly. A key replaces an event of " +
				"the same name at the same time; replace clears the animation's events first.",
			inputSchema: {
				project,
				animation: z.string(),
				keys: z
					.array(
						z.object({
							time: z.number().min(0),
							name: z.string(),
							int: z.number().int().optional(),
							float: z.number().optional(),
							string: z.string().optional(),
							volume: z.number().min(0).max(1).optional(),
							balance: z.number().min(-1).max(1).optional(),
						}),
					)
					.min(1),
				replace: z.boolean().optional(),
			},
		},
		(a) => edit(a.project, `events ${a.animation}`, (ws) => writeEventKeys(ws, a.animation, a.keys, a.replace)),
	);

	server.registerTool(
		"anim_draw_order_keys",
		{
			description:
				"Change which slots draw in front during an animation (an arm swinging behind the body, a card turning over). " +
				"Each key's order lists slot names back to front: all slots, or just the ones that move, which then trade " +
				"the places they hold in setup (e.g. [body, arm] puts arm in front of body). No order: back to setup. " +
				"Draw order holds until the next key. Replaces keys between the first and last given time.",
			inputSchema: {
				project,
				animation: z.string(),
				keys: z.array(z.object({ time: z.number().min(0), order: z.array(z.string()).optional() })).min(1),
			},
		},
		(a) => edit(a.project, `draw order ${a.animation}`, (ws) => writeDrawOrderKeys(ws, a.animation, a.keys)),
	);

	server.registerTool(
		"anim_sequence_keys",
		{
			description:
				"Play an image sequence attachment (see sequence_import): from each key on, mode (hold, once, loop, pingpong, " +
				"onceReverse, loopReverse, pingpongReverse; default hold), starting frame index (0-based) and delay " +
				"(seconds per frame, e.g. 1/12). Replaces keys between the first and last given time.",
			inputSchema: {
				project,
				animation: z.string(),
				slot: z.string(),
				attachment: z.string().optional().describe("Default: the slot's setup attachment"),
				skin: z.string().optional(),
				keys: z
					.array(
						z.object({
							time: z.number().min(0),
							mode: z.enum(SEQUENCE_MODES).optional(),
							index: z.number().int().min(0).optional(),
							delay: z.number().min(0).optional(),
						}),
					)
					.min(1),
			},
		},
		(a) =>
			edit(a.project, `sequence keys ${a.animation} ${a.slot}`, (ws) =>
				writeSequenceKeys(ws, a.animation, a.slot, a.attachment, a.keys, a.skin),
			),
	);

	server.registerTool(
		"anim_gait",
		{
			description:
				"Walk or run cycle in place for IK feet (e.g. biped left-leg-target phase 0, right-leg-target phase 0.5). " +
				"Planted feet slide back at constant speed; reports the ground speed to move the character at and when each " +
				"foot lands (event keys a footstep event there, string = foot bone). " +
				"Walk: contact ~0.6, run: ~0.35 with more lift and bob.",
			inputSchema: {
				project,
				animation: z.string(),
				feet: z.array(z.object({ bone: z.string(), phase: z.number().min(0).max(1) })).min(1),
				body: z.string().optional().describe("Bone that bobs, e.g. hips"),
				period: z.number().positive(),
				stride: z.number().positive(),
				lift: z.number().min(0),
				contact: z.number().min(0.1).max(0.9).optional(),
				bob: z.number().min(0).optional(),
				start: z.number().min(0).optional(),
				cycles: z.number().int().min(1).max(20).optional(),
				event: z.string().optional().describe("Event fired as each foot lands, e.g. footstep"),
			},
		},
		(a) => edit(a.project, `gait ${a.animation}`, (ws) => gait(ws, a)),
	);

	server.registerTool(
		"motion_check",
		{
			description:
				"Check feet for sliding: while a foot bone is on the ground its horizontal speed must stay constant " +
				"(0 when standing still, the ground speed in an in-place cycle).",
			inputSchema: {
				project,
				animation: z.string(),
				feet: z.array(z.string()).min(1).describe("Bones whose origin is the foot contact point (IK targets)"),
				tolerance: z.number().min(0).optional().describe("Height above ground still counted as contact (px, default 1)"),
				maxSlip: z.number().min(0).optional().describe("Allowed speed change while planted, px/frame (default 0.5)"),
			},
		},
		({ project, animation, feet, tolerance, maxSlip }) =>
			run(() => {
				const limit = maxSlip ?? 0.5;
				const reports = footSlip(Workspace.open(project), animation, feet, tolerance);
				const bad = reports.filter((r) => r.slip > limit);
				const lines = reports.map(
					(r) =>
						`${r.bone}: ${r.contactFrames} planted frames, speed ${r.speed.toFixed(1)} px/s, slip ${r.slip.toFixed(3)} px/frame`,
				);
				return { isError: bad.length > 0, content: [{ type: "text", text: [bad.length ? "SLIDING" : "OK", ...lines].join("\n") }] };
			}),
	);

	server.registerTool(
		"validate",
		{
			description: "Check the project with the Spine 4.3 runtime: references, images, weights, NaNs, loop seams, IK reach.",
			inputSchema: { project },
		},
		({ project }) =>
			run(() => {
				const r = validate(Workspace.open(project));
				const lines = [
					r.ok ? "OK" : "FAILED",
					...r.errors.map((e) => `error: ${e}`),
					...r.warnings.map((w) => `warning: ${w}`),
					...r.info,
				];
				return { isError: !r.ok, content: [{ type: "text", text: lines.join("\n") }] };
			}),
	);

	server.registerTool(
		"preview",
		{
			description:
				"Render frames of an animation (or the setup pose) side by side with bones overlaid, as an image. " +
				"Frames are played with physics, as the runtime would.",
			inputSchema: {
				project,
				animation: z.string().optional(),
				frames: z.number().int().min(1).max(24).optional(),
				times: z.array(z.number().min(0)).max(24).optional(),
				showBones: z.boolean().optional(),
				skin: z.string().optional().describe("Skin to show (default: the default skin)"),
			},
		},
		({ project, ...spec }) =>
			run(async () => {
				const ws = Workspace.open(project);
				const svg = renderSvg(ws, spec);
				const dir = join(ws.dir, "previews");
				mkdirSync(dir, { recursive: true });
				const base = join(dir, `v${ws.meta.version}-${spec.animation ?? "setup"}${spec.skin ? `@${spec.skin}` : ""}`);
				writeFileSync(`${base}.svg`, svg);
				const png = await rasterize(svg);
				if (!png) return text(`Playwright is not available; SVG saved to ${base}.svg`);
				writeFileSync(`${base}.png`, png);
				return {
					content: [
						{ type: "image", data: png.toString("base64"), mimeType: "image/png" },
						{ type: "text", text: `saved ${base}.png` },
					],
				};
			}),
	);

	server.registerTool(
		"export",
		{
			description:
				"Export skeleton JSON, atlas and PNG for Spine 4.3 runtimes, plus an HTML player page. " +
				"Spine Editor users can open the JSON with File > Import Data to get a .spine project.",
			inputSchema: { project, outDir: z.string().optional().describe("Default: <project>/export") },
		},
		({ project, outDir }) =>
			run(() => {
				const ws = Workspace.open(project);
				const report = validate(ws);
				if (!report.ok) throw new UserError(`fix validation errors first:\n${report.errors.join("\n")}`);
				const { dir, files } = exportProject(ws, outDir);
				return text(`exported to ${dir}:\n${files.join("\n")}`);
			}),
	);

	let studio: Promise<{ url: string }> | null = null;
	server.registerTool(
		"ui_open",
		{
			description:
				"Start rydspine studio, a local web page that plays every project's animations with the Spine player and " +
				"shows rigs, checks, versions and frame previews. Returns the URL to open in a browser.",
			inputSchema: { port: z.number().int().min(1024).max(65535).optional() },
		},
		({ port }) =>
			run(async () => {
				studio ??= startStudio(port ?? 5180);
				try {
					return text(`rydspine studio is running at ${(await studio).url}`);
				} catch (e) {
					studio = null;
					throw new UserError(`could not start the studio: ${(e as Error).message}`);
				}
			}),
	);

	server.registerTool(
		"history_list",
		{ description: "List saved versions.", inputSchema: { project } },
		({ project }) =>
			run(() =>
				text(
					Workspace.open(project)
						.history()
						.map((h) => `v${h.version}  ${h.time}  ${h.message}`)
						.join("\n"),
				),
			),
	);

	server.registerTool(
		"history_diff",
		{
			description: "Show what changed between two versions: bones, slots, constraints, attachments, animation timelines, loops and locks.",
			inputSchema: {
				project,
				from: z.number().int().describe("Older version"),
				to: z.number().int().optional().describe("Newer version (default: current)"),
			},
		},
		({ project, from, to }) =>
			run(() => {
				const ws = Workspace.open(project);
				const target = to ?? ws.meta.version;
				const lines = diffVersions(ws.snapshot(from), ws.snapshot(target));
				return text([`v${from} -> v${target}: ${lines.length ? `${lines.length} changes` : "no changes"}`, ...lines].join("\n"));
			}),
	);

	server.registerTool(
		"project_sync",
		{
			description:
				"Bring back a project after it was edited in Spine Editor and exported as JSON again. The edit becomes a " +
				"new version (diffed against the previous one, revertible); images are added from the folder or atlas.",
			inputSchema: {
				project,
				skeleton: z.string().describe("Path to the re-exported skeleton .json"),
				images: z.string().optional(),
				atlas: z.string().optional(),
			},
		},
		({ project, ...spec }) =>
			run(() => {
				const ws = Workspace.open(project);
				const before = ws.snapshot(ws.meta.version);
				const notes = syncProject(ws, spec);
				load(ws);
				const version = ws.commit(`sync from Spine: ${spec.skeleton}`);
				const changes = diffVersions(before, ws.snapshot(version));
				return text([...notes, `saved as version ${version}; ${changes.length} changes:`, ...changes].join("\n"));
			}),
	);

	server.registerTool(
		"history_revert",
		{ description: "Restore an earlier version (saved as a new version, so it can be undone too).", inputSchema: { project, version: z.number().int() } },
		({ project, version }) => run(() => text(`reverted; now version ${Workspace.open(project).revert(version)}`)),
	);

	server.registerTool(
		"lock_set",
		{
			description: "Lock or unlock approved bones, slots or animations so later edits cannot change them.",
			inputSchema: { project, kind: z.enum(["bones", "slots", "animations"]), names: z.array(z.string()).min(1), locked: z.boolean() },
		},
		({ project, kind, names, locked }) =>
			edit(project, `${locked ? "lock" : "unlock"} ${kind} ${names.join(", ")}`, (ws) => {
				const set = new Set(ws.meta.locks[kind]);
				for (const n of names) locked ? set.add(n) : set.delete(n);
				ws.meta.locks[kind] = [...set].sort();
			}),
	);

	return server;
}
