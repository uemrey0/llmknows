export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    prev = curr
  }
  return prev[b.length] ?? 0
}

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return i
}

/** Closest candidate to `name`, if it is close enough to be a plausible intended name. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  const target = name.toLowerCase()
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    if (candidate === name) continue
    const other = candidate.toLowerCase()
    // `retry` → `retries`: a shared stem is a stronger signal than raw edit distance.
    const shorter = Math.min(target.length, other.length)
    const stem = shorter >= 4 && commonPrefix(target, other) >= shorter - 2
    const distance = stem ? 1 : levenshtein(target, other)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  const limit = Math.max(2, Math.floor(name.length / 3))
  return bestDistance <= limit ? best : undefined
}

/** Runs `fn` over `items` with at most `limit` promises in flight, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

export function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
}
