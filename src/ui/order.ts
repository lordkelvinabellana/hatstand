// Reordering happens within the visible group (active or archived) while the stored
// order interleaves both. Moving past a hidden archived profile must still move visibly.
export interface Orderable {
  id: string;
  archived: boolean;
}

/** Returns every profile id, with `id` moved to position `index` among profiles sharing its archived state. */
export function moveToIndex(profiles: Orderable[], id: string, index: number): string[] {
  const moving = profiles.find((p) => p.id === id);
  if (!moving) return profiles.map((p) => p.id);
  const group = profiles.filter((p) => p.archived === moving.archived && p.id !== id).map((p) => p.id);
  group.splice(Math.max(0, Math.min(index, group.length)), 0, id);
  let next = 0;
  return profiles.map((p) => (p.archived === moving.archived ? group[next++] : p.id));
}

/** Moves `id` one step up (-1) or down (+1) within its group; null when already at the edge. */
export function moveByStep(profiles: Orderable[], id: string, delta: -1 | 1): string[] | null {
  const moving = profiles.find((p) => p.id === id);
  if (!moving) return null;
  const group = profiles.filter((p) => p.archived === moving.archived);
  const index = group.findIndex((p) => p.id === id) + delta;
  if (index < 0 || index >= group.length) return null;
  return moveToIndex(profiles, id, index);
}
