import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CompletionRequest, CompletionResult, ModelSpec, Provider } from './types.js'

/**
 * Wraps a provider so answers are stored on disk. Re-running a measurement (or regrading
 * after a package release) then costs nothing. Provider errors are never cached.
 */
export function withCache(provider: Provider, dir: string): Provider & { hits: number } {
  const wrapped = {
    hits: 0,
    async complete(model: ModelSpec, request: CompletionRequest) {
      const key = createHash('sha256')
        .update(JSON.stringify([model.id, request.system, request.prompt, request.sample ?? 0]))
        .digest('hex')
      const file = join(dir, `${key}.json`)
      try {
        const cached = JSON.parse(await readFile(file, 'utf8')) as CompletionResult
        wrapped.hits++
        return cached
      } catch {}
      const result = await provider.complete(model, request)
      if (result.ok || result.reason === 'refused') {
        await mkdir(dir, { recursive: true })
        await writeFile(file, JSON.stringify(result))
      }
      return result
    },
  }
  return wrapped
}
