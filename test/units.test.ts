import { describe, expect, it } from 'vitest'
import { buildRequest, extractCode, usesPackage } from '../src/prompt.js'
import { parseModel } from '../src/providers.js'
import { parsePackageSpec, typesPackageName } from '../src/resolve-package.js'
import { parseTasks, tasksFromExports } from '../src/tasks.js'
import type { ExportedSymbol } from '../src/types.js'
import { closest, mapLimit } from '../src/util.js'

describe('extractCode', () => {
  it('takes the longest TypeScript block', () => {
    const answer =
      '```bash\nnpm i zod\n```\n```ts\nimport { z } from "zod"\nz.string()\n```\n```ts\nx\n```'
    expect(extractCode(answer)).toBe('import { z } from "zod"\nz.string()')
  })

  it('accepts unfenced code but not prose', () => {
    expect(extractCode('import { z } from "zod"')).toBe('import { z } from "zod"')
    expect(extractCode('Sorry, I do not know this library.')).toBeUndefined()
  })
})

describe('usesPackage', () => {
  it.each([
    [`import { z } from 'zod'`, true],
    [`import * as z from "zod/mini"`, true],
    [`const z = require('zod')`, true],
    [`const z = await import('zod')`, true],
    [`import 'zod'`, true],
    [`import { z } from 'zodiac'`, false],
    [`// zod is great`, false],
  ])('%s → %s', (code, expected) => {
    expect(usesPackage(code, 'zod')).toBe(expected)
  })

  it('handles scoped names', () => {
    expect(usesPackage(`import { x } from '@scope/pkg'`, '@scope/pkg')).toBe(true)
  })
})

describe('buildRequest', () => {
  it('adds the version only when asked', () => {
    const task = { id: 't', prompt: 'Do it.' }
    expect(buildRequest(task, { packageName: 'zod', version: '4.0.0' }).prompt).not.toContain(
      '4.0.0',
    )
    expect(
      buildRequest(task, { packageName: 'zod', version: '4.0.0', versionHint: true }).prompt,
    ).toContain('Target version 4.0.0')
  })
})

describe('parseModel', () => {
  it('splits on the first colon only', () => {
    expect(parseModel('ollama:qwen3:8b')).toEqual({
      provider: 'ollama',
      model: 'qwen3:8b',
      id: 'ollama:qwen3:8b',
    })
  })

  it.each(['claude', ':x', 'x:'])('rejects %s', (spec) => {
    expect(() => parseModel(spec)).toThrow(/provider:model/)
  })
})

describe('package specs', () => {
  it.each([
    ['zod', { name: 'zod' }],
    ['zod@3', { name: 'zod', range: '3' }],
    ['@scope/pkg', { name: '@scope/pkg' }],
    ['@scope/pkg@^1.2.0', { name: '@scope/pkg', range: '^1.2.0' }],
  ])('%s', (spec, expected) => {
    expect(parsePackageSpec(spec)).toEqual(expected)
  })

  it('maps DefinitelyTyped names', () => {
    expect(typesPackageName('lodash')).toBe('@types/lodash')
    expect(typesPackageName('@babel/core')).toBe('@types/babel__core')
  })
})

describe('tasks', () => {
  const symbol = (name: string, kind: ExportedSymbol['kind']): ExportedSymbol => ({
    name,
    kind,
    entry: 'lib',
  })

  it('prefers functions and classes and samples large APIs evenly', () => {
    const symbols = [
      ...Array.from({ length: 30 }, (_, i) =>
        symbol(`fn${String(i).padStart(2, '0')}`, 'function'),
      ),
      symbol('CONSTANT', 'variable'),
    ]
    const tasks = tasksFromExports(symbols, 10)
    expect(tasks).toHaveLength(10)
    expect(tasks.map((t) => t.id)).not.toContain('CONSTANT')
    expect(tasks[0]?.id).toBe('fn00')
    expect(tasks[9]?.id).toBe('fn27')
  })

  it('parses JSON and line-based task files', () => {
    expect(parseTasks('["Parse a date", {"id": "fmt", "prompt": "Format it"}]')).toEqual([
      { id: 'parse-a-date', prompt: 'Parse a date' },
      { id: 'fmt', prompt: 'Format it' },
    ])
    expect(parseTasks('# comment\nParse a date\n\nParse a date\n', 'tasks.txt')).toEqual([
      { id: 'parse-a-date', prompt: 'Parse a date' },
      { id: 'parse-a-date-2', prompt: 'Parse a date' },
    ])
  })
})

describe('util', () => {
  it('finds close names', () => {
    expect(closest('qeury', ['query', 'close'])).toBe('query')
    expect(closest('retry', ['retries', 'timeout'])).toBe('retries')
    expect(closest('createClient', ['createServer', 'connect'])).toBeUndefined()
  })

  it('limits concurrency and keeps order', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, n))
      active--
      return n * 2
    })
    expect(out).toEqual([10, 2, 6, 4])
    expect(peak).toBe(2)
  })
})
