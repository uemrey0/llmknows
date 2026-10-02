import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withCache } from '../src/cache.js'
import { formatFix, formatReport, overallScore, renderBadge } from '../src/format.js'
import { run } from '../src/run.js'
import type { CompletionResult, ModelSpec, Provider } from '../src/types.js'
import { fakeProject } from './helpers.js'

const fence = (code: string) => `Here you go:\n\n\`\`\`ts\n${code}\n\`\`\`\n`

/** "good" models write correct code, "bad" models hallucinate, "shy" ones refuse. */
const fakeProvider: Provider = {
  async complete(model: ModelSpec): Promise<CompletionResult> {
    if (model.model === 'shy') return { ok: false, reason: 'refused', message: 'no' }
    if (model.model === 'good') {
      return { ok: true, text: fence(`import { connect } from 'fakelib'\nconnect('db').close()`) }
    }
    return {
      ok: true,
      text: fence(`import { connect, createPool } from 'fakelib'\nconnect('db').disconnect()`),
    }
  },
}

const { projectRoot } = fakeProject()
const tasks = [
  { id: 'connect', prompt: 'Connect to a database.' },
  { id: 'close', prompt: 'Close a connection.' },
]

describe('run', () => {
  it('scores models and aggregates hallucinations', async () => {
    const report = await run({
      package: 'fakelib',
      models: ['test:good', 'test:bad', 'test:shy'],
      tasks,
      samples: 2,
      cwd: projectRoot,
      cacheDir: false,
      provider: fakeProvider,
    })

    expect(report.package).toEqual({ name: 'fakelib', version: '1.2.3' })
    const scores = Object.fromEntries(report.models.map((m) => [m.model, m]))
    expect(scores['test:good']).toMatchObject({ score: 1, passed: 4, graded: 4 })
    expect(scores['test:bad']).toMatchObject({ score: 0, passed: 0, graded: 4 })
    expect(scores['test:shy']).toMatchObject({ graded: 0, byStatus: { refused: 4 } })

    expect(report.hallucinations.map((h) => [h.symbol, h.count])).toEqual([
      ['Client.disconnect', 4],
      ['fakelib.createPool', 4],
    ])
    expect(overallScore(report)).toBe(0.5)
  })

  it('generates tasks from exports when none are given', async () => {
    const report = await run({
      package: 'fakelib',
      models: ['test:good'],
      cwd: projectRoot,
      cacheDir: false,
      provider: fakeProvider,
    })
    expect(report.tasks.map((t) => t.id)).toEqual([
      'Client',
      'connect',
      'Level',
      'utils',
      'VERSION',
    ])
  })

  it('marks answers without code or without the package', async () => {
    const provider: Provider = {
      async complete(_model, request) {
        return request.prompt.startsWith('Connect')
          ? { ok: true, text: 'I cannot write code today.' }
          : { ok: true, text: fence(`const x = 1\nconsole.log(x)`) }
      },
    }
    const report = await run({
      package: 'fakelib',
      models: ['test:lazy'],
      tasks,
      cwd: projectRoot,
      cacheDir: false,
      provider,
    })
    expect(report.samples.map((s) => s.status)).toEqual(['no-code', 'unused'])
    expect(report.models[0]?.score).toBe(0)
  })
})

describe('withCache', () => {
  it('reuses answers and never caches errors', async () => {
    let calls = 0
    const provider: Provider = {
      async complete(model) {
        calls++
        return model.model === 'broken'
          ? { ok: false, reason: 'error', message: 'boom' }
          : { ok: true, text: 'hi' }
      },
    }
    const cached = withCache(provider, mkdtempSync(join(tmpdir(), 'llmknows-cache-')))
    const request = { system: 's', prompt: 'p' }
    const ok = { provider: 'x', model: 'ok', id: 'x:ok' }
    const broken = { provider: 'x', model: 'broken', id: 'x:broken' }

    await cached.complete(ok, request)
    await cached.complete(ok, request)
    await cached.complete(ok, { ...request, sample: 1 })
    await cached.complete(broken, request)
    await cached.complete(broken, request)
    expect(calls).toBe(4)
    expect(cached.hits).toBe(1)
  })
})

describe('format', () => {
  it('renders the terminal report, fix notes and badge', async () => {
    const report = await run({
      package: 'fakelib',
      models: ['test:good', 'test:bad'],
      tasks,
      cwd: projectRoot,
      cacheDir: false,
      provider: fakeProvider,
    })
    const text = formatReport(report)
    expect(text).toContain('fakelib@1.2.3')
    expect(text).toMatch(/test:good\s+█{20}\s+100%/)
    expect(text).toContain('Client.disconnect')

    const fix = formatFix(report)
    expect(fix).toContain('## Using fakelib (v1.2.3)')
    expect(fix).toContain('`fakelib.createPool` does not exist')

    const badge = renderBadge(overallScore(report))
    expect(badge).toContain('AI API accuracy: 50%')
    expect(badge.startsWith('<svg')).toBe(true)
  })
})
