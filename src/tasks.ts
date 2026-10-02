import { readFile } from 'node:fs/promises'
import type { ExportedSymbol, ExportKind, Task } from './types.js'

const templates: Record<ExportKind, (name: string, entry: string) => string> = {
  function: (name, entry) =>
    `Write a short TypeScript example that calls \`${name}\` from "${entry}" with realistic arguments and uses its result.`,
  class: (name, entry) =>
    `Write a short TypeScript example that creates an instance of \`${name}\` from "${entry}" and uses its main methods.`,
  namespace: (name, entry) =>
    `Write a short TypeScript example that shows typical usage of the \`${name}\` namespace from "${entry}".`,
  variable: (name, entry) =>
    `Write a short TypeScript example that shows typical usage of \`${name}\` from "${entry}".`,
  enum: (name, entry) =>
    `Write a short TypeScript example that uses the \`${name}\` enum from "${entry}".`,
}

const priority: Record<ExportKind, number> = {
  function: 0,
  class: 0,
  namespace: 1,
  variable: 2,
  enum: 3,
}

function describe(symbol: ExportedSymbol): string {
  if (symbol.name === 'default') {
    return `Write a short TypeScript example that shows typical usage of the default export of "${symbol.entry}".`
  }
  return templates[symbol.kind](symbol.name, symbol.entry)
}

/** Picks `max` symbols spread evenly over the list, so large APIs are sampled, not truncated. */
function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const step = items.length / max
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)] as T)
}

export function tasksFromExports(symbols: ExportedSymbol[], max = 25): Task[] {
  const ordered = [...symbols].sort(
    (a, b) => priority[a.kind] - priority[b.kind] || a.name.localeCompare(b.name),
  )
  const preferred = ordered.filter((s) => priority[s.kind] <= 1)
  const pool = preferred.length >= max ? preferred : ordered
  const multipleEntries = new Set(symbols.map((s) => s.entry)).size > 1
  return spread(pool, max)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((symbol) => ({
      id: multipleEntries ? `${symbol.entry}#${symbol.name}` : symbol.name,
      prompt: describe(symbol),
      symbol: symbol.name,
    }))
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/**
 * Parses a custom task file: a JSON array of strings or `{ id, prompt }` objects,
 * or a text file with one task per line (blank lines and `#` comments ignored).
 */
export function parseTasks(content: string, fileName = 'tasks.json'): Task[] {
  const raw: Array<string | { id?: string; prompt: string }> = fileName.endsWith('.json')
    ? JSON.parse(content)
    : content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))

  if (!Array.isArray(raw)) throw new Error(`${fileName}: expected a JSON array of tasks.`)
  const seen = new Set<string>()
  return raw.map((item, i) => {
    const prompt = typeof item === 'string' ? item : item.prompt
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error(`${fileName}: task ${i + 1} has no prompt.`)
    }
    let id = (typeof item === 'object' && item.id) || slug(prompt) || `task-${i + 1}`
    while (seen.has(id)) id = `${id}-${i + 1}`
    seen.add(id)
    return { id, prompt: prompt.trim() }
  })
}

export async function loadTasks(file: string): Promise<Task[]> {
  return parseTasks(await readFile(file, 'utf8'), file)
}
