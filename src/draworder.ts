// Draw order keys store, for each slot that moves, its offset from its setup position. Slots on the
// longest run already in setup order stay unlisted, the way Spine writes them.
import type { AnimationJson } from "./types.js";

export interface DrawOrderOffset {
	slot: string;
	offset: number;
}

export interface DrawOrderJson {
	time?: number;
	offsets?: DrawOrderOffset[];
}

/** Indices of the values on the longest increasing run of seq (the values, not their positions). */
export function longestIncreasing(seq: number[]): Set<number> {
	const tails: number[] = [];
	const prev = new Array<number>(seq.length).fill(-1);
	seq.forEach((v, i) => {
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (seq[tails[mid]] < v) lo = mid + 1;
			else hi = mid;
		}
		prev[i] = lo > 0 ? tails[lo - 1] : -1;
		tails[lo] = i;
	});
	const out = new Set<number>();
	for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.add(seq[i]);
	return out;
}

/** Offsets for a draw order given as setup slot indices back to front; undefined when it is the setup order. */
export function orderToOffsets(slots: string[], order: number[]): DrawOrderOffset[] | undefined {
	const keep = longestIncreasing(order);
	const offsets = order
		.map((slotIndex, position) => ({ slotIndex, position }))
		.filter((e) => !keep.has(e.slotIndex))
		.sort((a, b) => a.slotIndex - b.slotIndex)
		.map((e) => ({ slot: slots[e.slotIndex], offset: e.position - e.slotIndex }));
	return offsets.length ? offsets : undefined;
}

/** The slot names back to front that a key's offsets produce (same algorithm as the runtime). */
export function offsetsToNames(slots: string[], offsets: DrawOrderOffset[] | undefined): string[] {
	if (!offsets?.length) return [...slots];
	const order = new Array<number>(slots.length).fill(-1);
	const unchanged: number[] = [];
	let original = 0;
	for (const o of offsets) {
		const index = slots.indexOf(o.slot);
		if (index < 0) throw new Error(`draw order slot not found: ${o.slot}`);
		while (original !== index) unchanged.push(original++);
		order[original + o.offset] = original++;
	}
	while (original < slots.length) unchanged.push(original++);
	for (let i = slots.length - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged.pop()!;
	return order.map((i) => slots[i]);
}

/**
 * Rewrites every draw order key after the setup slot order changes, so each key still shows the same
 * order. Slots that are gone are dropped; new slots keep their place next to the slot below them in setup.
 */
export function remapDrawOrders(animations: Record<string, AnimationJson>, before: string[], after: string[]): void {
	for (const a of Object.values(animations)) {
		const keys = a.drawOrder as DrawOrderJson[] | undefined;
		if (!keys) continue;
		for (const k of keys) {
			const names = offsetsToNames(before, k.offsets).filter((n) => after.includes(n));
			after.forEach((n, i) => {
				if (names.includes(n)) return;
				const below = i > 0 ? names.indexOf(after[i - 1]) : -1;
				names.splice(below + 1, 0, n);
			});
			const offsets = orderToOffsets(after, names.map((n) => after.indexOf(n)));
			if (offsets) k.offsets = offsets;
			else delete k.offsets;
		}
	}
}
