# rydspine-mcp — Product requirements

Status: draft for discussion. The detailed requirements below are proposals; the scope of the first version is not settled.

## 1. Confirmed goals

- Build a dedicated MCP for Spine 4.3.
- The tool must build rigs, including binding to bones, and create animations from natural-language requests.
- Serve many kinds of assets, not only characters.
- Clarify requirements before implementation.

## 2. Inputs

Input types to consider:

- Multi-layer PSD.
- A set of PNGs already split into parts.
- A flat picture not yet split into parts.
- An existing Spine project or skeleton JSON.
- A description of the motion; reference images/videos if available.

The required input types for the first version need to be decided. For flat pictures, splitting parts and filling in hidden areas is a separate requirement.

## 3. Asset analysis

- Identify the parts and how they relate.
- Determine a structure suited to each kind of asset.
- Propose joint positions, pivots and parts that need to deform.
- Detect missing parts or data.
- Let the user correct the analysis.

## 4. Rigging

- Create bones and parent–child relationships.
- Set joint positions and the setup pose.
- Create slots, attachments and draw order.
- Create meshes and distribute weights for parts that deform.
- Set up IK, transform, path and physics constraints when needed.
- Support skins and attachment swaps.
- Allow test poses, rig adjustments and reuse of existing rigs.

The rig must suit the structure and the motion to perform, including multiple legs, wings, segmented chains, hinges, wheels and independent shapes.

## 5. Animation

- Accept action descriptions in natural language.
- Create the corresponding poses, keyframes, timing and curves.
- Support looping and non-looping animations.
- Allow adjusting duration, speed, amplitude and delay.
- Support anticipation, follow-through and secondary motion.
- Combine several motions in one animation.
- Allow describing custom moves and extending the set of actions.

Example requests for discussion and for choosing the acceptance set:

- A character runs, stops, then swings a sword.
- A dragon flaps its wings, neck and tail following.
- A tree leans in the wind, branches swaying differently.
- A chest opens its lid then bounces slightly.
- A car rolls its wheels and the body bobs with the motion.
- A logo appears, bounces, then settles.

## 6. Editing

- Adjust rigs and animations with follow-up requests.
- Edit by part, animation or time range.
- Leave parts outside the edited scope unchanged.
- Allow locking parts the user has approved.
- Save versions to compare and go back.
- Support continuing after the user edits in Spine.

## 7. Preview and checks

- Play animations, scrub and view any point in time.
- Show bones, meshes, weights and constraints when needed.
- Check with the Spine 4.3 runtime.
- Detect data errors, missing images and invalid references.
- Help assess motion defects such as foot sliding, joint separation, abnormal deformation and pops at the loop seam.
- Allow reviewing the result after each edit.

## 8. Outputs

- A `.spine` project that opens and can be edited further in Spine 4.3.
- Skeleton JSON/binary, atlas and textures for the target runtime.
- Previews for the user to judge the motion.
- A report of what is done, errors and remaining limitations.

## 9. Proposed acceptance criteria

- Complete the flow from the agreed inputs to rig and animation.
- Results show the requested action and parameters.
- The rig covers the agreed range of motion.
- Looping animations loop seamlessly when requested.
- Edits affect exactly the selected scope.
- Results open in Spine 4.3 and run on the target runtime.
- Can be edited further by hand in Spine.
- The acceptance set covers many kinds of assets, not only characters.
- Previous versions can be restored after an edit.

Criteria on visual and motion quality need reference samples, test scenarios and concrete thresholds before acceptance.

## 10. Open decisions

- Required input types for the first version.
- Level of automation and the steps the user must approve.
- Priority asset types and complexity.
- Motion quality standard and acceptance reference samples.
- Exact Spine 4.3 version and target runtime.
- Operating systems to support.
- File-based processing or working inside an open editor.
- Processing time and cost limits per task.

## 11. Status of technical decisions

The programming language, SDK, MCP transport, rigging approach and motion generation method are not settled. The options discussed are suggestions to evaluate once the product scope is defined.
