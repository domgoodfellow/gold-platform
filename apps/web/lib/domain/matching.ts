/**
 * Maximum bipartite matching by augmenting paths — the one matcher.
 *
 * *Slots* (required positions) on one side, *candidates* (resources) on the other, an edge where a
 * candidate could fill a slot. It finds the **largest** set of slots that can be filled with every
 * candidate used at most once. A greedy first-come match cannot promise that: it can spend the one
 * candidate that fits a hard slot on an easy one and report a gap that a better arrangement never
 * had. Coverage of a job (`evaluateRequirements`) and feasibility of an interval (`feasibility.ts`)
 * both ask exactly this, so both call this.
 *
 * **Deterministic.** Slots are tried in index order and each slot's candidates in the order its
 * `candidatesOf` returns them, so the same inputs give the same matching on every call. Nothing
 * here reads a clock, a database or a random number, and nothing enumerates combinations: the work
 * is bounded by slots × edges.
 *
 * @param slotCount how many slots there are, numbered 0..slotCount-1
 * @param candidatesOf the candidate indexes (any stable numbering) that may fill a slot, best first
 * @returns slot index → candidate index, for the slots that could be filled
 */
export function maximumMatching(
  slotCount: number,
  candidatesOf: (slot: number) => readonly number[],
): Map<number, number> {
  const slotOf = new Map<number, number>();
  const candidateOf = new Map<number, number>();

  function assign(slot: number, candidate: number): true {
    slotOf.set(candidate, slot);
    candidateOf.set(slot, candidate);
    return true;
  }

  function augment(slot: number, seen: Set<number>): boolean {
    const candidates = candidatesOf(slot);

    // A free candidate first, in the order given: nobody is displaced while there is room, so the
    // matching reads the way a person would expect (the first person to the first position).
    for (const candidate of candidates) {
      if (seen.has(candidate) || slotOf.has(candidate)) continue;
      seen.add(candidate);
      return assign(slot, candidate);
    }

    // Otherwise try to move whoever holds a candidate somewhere else — the augmenting path that
    // makes this a *maximum* matching and not a greedy one.
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const holder = slotOf.get(candidate);
      if (holder !== undefined && augment(holder, seen)) return assign(slot, candidate);
    }
    return false;
  }

  for (let slot = 0; slot < slotCount; slot += 1) {
    augment(slot, new Set());
  }

  return candidateOf;
}
