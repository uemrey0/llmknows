#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import manifest from '../package.json' with { type: 'json' }
import { formatFix, formatReport, overallScore, percent, renderBadge } from './format.js'
import { PROVIDERS } from './providers.js'
import { type ProgressEvent, planTasks, run } from './run.js'
import { loadTasks } from './tasks.js'

const DEFAULT_MODEL = 'anthropic:claude-opus-5-5'

const HELP = `
llmknows — does AI know your library?

Asks LLMs to write code against an npm package, then typechecks that code
against the package's real type declarations.

Usage
  npx llmknows <package> [options]

Examples
  npx llmknows zod
  npx llmknows zod@3 -m anthropic:claude-opus-5-5,openai:gpt-5.1 -n 3
  npx llmknows my-lib -m ollama:qwen3 --badge llmknows.svg --fix AGENTS.llmknows.md
  npx llmknows . --min-score 0.8          # run in your package's repo, fail CI below 80%

Options
  -m, --models <list>     Comma-separated provider:model list (default: ${DEFAULT_MODEL})
                          Providers: ${PROVIDERS.join(', ')}
  -n, --samples <n>       Answers per task per model (default: 1)
  -t, --max-tasks <n>     Maximum generated tasks, one per export (default: 25)
      --tasks <file>      Use your own tasks (.json array or one task per line)
      --entry <path>      Import path to read exports from; repeatable (default: package root)
      --version-hint      Tell models which version to target
  -c, --concurrency <n>   Parallel requests (default: 4)
      --json <file>       Write the full report as JSON
      --badge <file>      Write an SVG badge with the average score
      --fix <file>        Write Markdown notes for AGENTS.md / llms.txt
      --min-score <0-1>   Exit with code 1 if any model scores lower
      --dry-run           Print the tasks without calling any model
      --no-cache          Do not reuse cached answers (.llmknows/cache)
      --no-color          Disable colors
  -h, --help              Show help
  -v, --version           Show version

API keys are read from ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY and
GEMINI_API_KEY. Ollama needs no key. Override endpoints with <PROVIDER>_BASE_URL.
`

function fail(message: string): never {
  process.stderr.write(`llmknows: ${message}\n`)
  process.exit(2)
}

function toInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) fail(`--${name} must be a positive integer.`)
  return n
}

async function write(file: string, content: string): Promise<void> {
  const path = resolve(file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    allowNegative: true,
    options: {
      models: { type: 'string', short: 'm' },
      samples: { type: 'string', short: 'n' },
      'max-tasks': { type: 'string', short: 't' },
      tasks: { type: 'string' },
      entry: { type: 'string', multiple: true },
      'version-hint': { type: 'boolean' },
      concurrency: { type: 'string', short: 'c' },
      json: { type: 'string' },
      badge: { type: 'string' },
      fix: { type: 'string' },
      'min-score': { type: 'string' },
      'dry-run': { type: 'boolean' },
      cache: { type: 'boolean', default: true },
      color: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

  if (values.help) return void process.stdout.write(HELP)
  if (values.version) return void process.stdout.write(`${manifest.version}\n`)

  let spec = positionals[0]
  if (!spec) fail('missing package name. Run `llmknows --help`.')
  if (spec === '.') {
    const own = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { name?: string }
    if (!own.name) fail('no package name found in ./package.json.')
    spec = own.name
  }

  const color = values.color ?? (process.stdout.isTTY === true && !process.env.NO_COLOR)
  const minScore = values['min-score'] === undefined ? undefined : Number(values['min-score'])
  if (minScore !== undefined && !(minScore >= 0 && minScore <= 1)) {
    fail('--min-score must be between 0 and 1.')
  }

  const interactive = process.stderr.isTTY === true
  const onProgress = (event: ProgressEvent): void => {
    if (event.type === 'install') process.stderr.write(`Installing ${event.spec}…\n`)
    if (event.type === 'tasks') {
      process.stderr.write(
        `Testing ${event.package.name}@${event.package.version} with ${event.tasks.length} tasks\n`,
      )
    }
    if (event.type === 'sample' && interactive) {
      process.stderr.write(`\r  asking models ${event.done}/${event.total}`)
      if (event.done === event.total) process.stderr.write('\n')
    }
    if (event.type === 'grading') process.stderr.write('  typechecking answers…\n')
  }

  const tasks = values.tasks ? await loadTasks(values.tasks) : undefined
  const common = {
    package: spec,
    maxTasks: toInt(values['max-tasks'], 'max-tasks', 25),
    onProgress,
    ...(tasks ? { tasks } : {}),
    ...(values.entry ? { entries: values.entry } : {}),
  }

  if (values['dry-run']) {
    const plan = await planTasks(common)
    for (const task of plan.tasks) process.stdout.write(`${task.id}\n  ${task.prompt}\n`)
    return
  }

  const report = await run({
    ...common,
    models: (values.models ?? DEFAULT_MODEL)
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    samples: toInt(values.samples, 'samples', 1),
    concurrency: toInt(values.concurrency, 'concurrency', 4),
    versionHint: values['version-hint'] ?? false,
    ...(values.cache ? {} : { cacheDir: false as const }),
  })

  process.stdout.write(formatReport(report, { color }))
  const outputs: string[] = []
  if (values.json) {
    await write(values.json, `${JSON.stringify(report, null, 2)}\n`)
    outputs.push(values.json)
  }
  if (values.badge) {
    await write(values.badge, renderBadge(overallScore(report)))
    outputs.push(values.badge)
  }
  if (values.fix) {
    await write(values.fix, formatFix(report))
    outputs.push(values.fix)
  }
  if (outputs.length) process.stdout.write(`  wrote ${outputs.join(', ')}\n\n`)

  const errors = report.samples.filter((s) => s.status === 'error')
  if (errors.length === report.samples.length && errors[0]) {
    fail(`every request failed. First error: ${errors[0].error}`)
  }
  if (minScore !== undefined) {
    const below = report.models.filter((m) => m.score < minScore)
    if (below.length) {
      process.stderr.write(
        `llmknows: below --min-score ${percent(minScore)}: ${below.map((m) => `${m.model} (${percent(m.score)})`).join(', ')}\n`,
      )
      process.exit(1)
    }
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
