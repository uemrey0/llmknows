import type { HallucinatedSymbol, ModelScore, SampleResult, SampleStatus } from './types.js'

const STATUSES: SampleStatus[] = ['pass', 'fail', 'no-code', 'unused', 'refused', 'error']

export function scoreModels(models: string[], samples: SampleResult[]): ModelScore[] {
  return models.map((model) => {
    const own = samples.filter((s) => s.model === model)
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<SampleStatus, number>
    for (const sample of own) byStatus[sample.status]++
    // Refusals and provider errors say nothing about API knowledge, so they are not graded.
    const graded = own.length - byStatus.refused - byStatus.error
    return {
      model,
      total: own.length,
      graded,
      passed: byStatus.pass,
      score: graded > 0 ? byStatus.pass / graded : 0,
      byStatus,
    }
  })
}

/** Aggregates issues across samples, most frequent first. */
export function collectHallucinations(samples: SampleResult[]): HallucinatedSymbol[] {
  const bySymbol = new Map<string, HallucinatedSymbol & { modelSet: Set<string> }>()
  for (const sample of samples) {
    for (const issue of sample.issues) {
      const key = `${issue.kind}:${issue.symbol}`
      let entry = bySymbol.get(key)
      if (!entry) {
        entry = {
          symbol: issue.symbol,
          kind: issue.kind,
          count: 0,
          models: [],
          modelSet: new Set(),
          example: issue.message,
        }
        if (issue.suggestion) entry.suggestion = issue.suggestion
        bySymbol.set(key, entry)
      }
      entry.count++
      entry.modelSet.add(sample.model)
      entry.suggestion ??= issue.suggestion
    }
  }
  return [...bySymbol.values()]
    .map(({ modelSet, ...entry }) => ({ ...entry, models: [...modelSet].sort() }))
    .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol))
}
