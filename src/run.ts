import { join, resolve } from 'node:path'
import { withCache } from './cache.js'
import { grade } from './grade.js'
import { buildRequest, extractCode, usesPackage } from './prompt.js'
import { createDefaultProvider, parseModel } from './providers.js'
import { type ResolvedPackage, resolvePackage } from './resolve-package.js'
import { collectHallucinations, scoreModels } from './score.js'
import { extractExports } from './symbols.js'
import { tasksFromExports } from './tasks.js'
import type { ModelSpec, Provider, Report, SampleResult, Task } from './types.js'
import { mapLimit } from './util.js'

export type ProgressEvent =
  | { type: 'install'; spec: string }
  | { type: 'tasks'; tasks: Task[]; package: ResolvedPackage }
  | { type: 'sample'; done: number; total: number }
  | { type: 'grading' }

export interface RunOptions {
  /** Package to evaluate: `zod`, `zod@3`, `@scope/pkg@^2`. */
  package: string
  /** Models as `provider:model` strings or specs. */
  models: Array<string | ModelSpec>
  /** Custom tasks. Defaults to one generated task per exported symbol. */
  tasks?: Task[]
  /** Import paths to read exports from. Defaults to the package root. */
  entries?: string[]
  /** Answers per task per model. Default 1. */
  samples?: number
  /** Maximum number of generated tasks. Default 25. */
  maxTasks?: number
  /** Tell models which version to target. Default false. */
  versionHint?: boolean
  /** Concurrent model requests. Default 4. */
  concurrency?: number
  cwd?: string
  /** Directory for cached answers, or `false` to disable. Default `.llmknows/cache`. */
  cacheDir?: string | false
  /** Replace the built-in Anthropic/OpenAI provider (e.g. for tests or custom gateways). */
  provider?: Provider
  onProgress?: (event: ProgressEvent) => void
}

/** Plans the tasks without calling any model. */
export async function planTasks(
  options: Pick<RunOptions, 'package' | 'tasks' | 'entries' | 'maxTasks' | 'cwd' | 'onProgress'>,
): Promise<{ package: ResolvedPackage; tasks: Task[] }> {
  const resolveOptions = {
    onInstall: (spec: string) => options.onProgress?.({ type: 'install', spec }),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  }
  const pkg = await resolvePackage(options.package, resolveOptions)
  const tasks =
    options.tasks ??
    tasksFromExports(
      extractExports(pkg.projectRoot, options.entries ?? [pkg.name]),
      options.maxTasks,
    )
  if (tasks.length === 0) {
    throw new Error(`${pkg.name} has no runtime exports to test. Pass custom tasks instead.`)
  }
  options.onProgress?.({ type: 'tasks', tasks, package: pkg })
  return { package: pkg, tasks }
}

export async function run(options: RunOptions): Promise<Report> {
  const models = options.models.map((m) => (typeof m === 'string' ? parseModel(m) : m))
  if (models.length === 0) throw new Error('No models given.')
  const { package: pkg, tasks } = await planTasks(options)

  const samples = Math.max(1, options.samples ?? 1)
  const cwd = resolve(options.cwd ?? process.cwd())
  const base = options.provider ?? createDefaultProvider()
  const provider =
    options.cacheDir === false
      ? base
      : withCache(base, resolve(cwd, options.cacheDir ?? join('.llmknows', 'cache')))

  const jobs = models.flatMap((model) =>
    tasks.flatMap((task) =>
      Array.from({ length: samples }, (_, sample) => ({ model, task, sample })),
    ),
  )

  let done = 0
  const answers = await mapLimit(jobs, options.concurrency ?? 4, async (job) => {
    const request = {
      ...buildRequest(job.task, {
        packageName: pkg.name,
        version: pkg.version,
        versionHint: options.versionHint ?? false,
      }),
      sample: job.sample,
    }
    const result = await provider.complete(job.model, request)
    options.onProgress?.({ type: 'sample', done: ++done, total: jobs.length })
    return { ...job, result }
  })

  options.onProgress?.({ type: 'grading' })
  const results: SampleResult[] = answers.map(({ model, task, sample, result }) => {
    const base = { model: model.id, taskId: task.id, sample, issues: [], otherErrors: 0 }
    if (!result.ok) return { ...base, status: result.reason, error: result.message }
    const code = extractCode(result.text)
    if (!code) return { ...base, status: 'no-code' }
    if (!usesPackage(code, pkg.name)) return { ...base, status: 'unused', code }
    return { ...base, status: 'pass', code }
  })

  const key = (r: SampleResult) => `${r.model}\u0000${r.taskId}\u0000${r.sample}`
  const toGrade = results.filter((r) => r.status === 'pass' && r.code)
  const graded = grade(
    toGrade.map((r) => ({ key: key(r), code: r.code ?? '' })),
    { packageName: pkg.name, packageDir: pkg.dir, projectRoot: pkg.projectRoot },
  )
  for (const result of toGrade) {
    const output = graded.get(key(result))
    if (!output) continue
    result.issues = output.issues
    result.otherErrors = output.otherErrors
    if (output.issues.length > 0) result.status = 'fail'
  }

  return {
    package: { name: pkg.name, version: pkg.version },
    createdAt: new Date().toISOString(),
    tasks,
    models: scoreModels(
      models.map((m) => m.id),
      results,
    ),
    hallucinations: collectHallucinations(results),
    samples: results,
  }
}
