export function hasReachedPlanLimit(used: number | null | undefined, limit: number | null | undefined) {
  if (typeof limit !== 'number' || limit === -1) return false
  return (used ?? 0) >= limit
}
