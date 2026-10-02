import type { CompletionRequest, Task } from './types.js'

export const SYSTEM_PROMPT =
  'You are an expert TypeScript developer. Answer with exactly one ```ts code block that ' +
  'contains a complete, self-contained example module, and nothing else. Import the real ' +
  'package; never stub, mock or re-implement it.'

export interface PromptContext {
  packageName: string
  version: string
  /** Tell the model which version to target. Off by default: real users rarely do. */
  versionHint?: boolean
}

export function buildRequest(task: Task, context: PromptContext): CompletionRequest {
  const lines = [
    task.prompt,
    '',
    `The code must import from the npm package "${context.packageName}".`,
  ]
  if (context.versionHint) lines.push(`Target version ${context.version} of the package.`)
  return { system: SYSTEM_PROMPT, prompt: lines.join('\n') }
}

const FENCE = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g
const CODE_LANGS = new Set(['', 'ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx', 'mjs'])

/** Pulls the code out of a model answer: the longest TS/JS fenced block, or the raw text. */
export function extractCode(answer: string): string | undefined {
  const blocks = [...answer.matchAll(FENCE)]
    .filter((m) => CODE_LANGS.has((m[1] ?? '').toLowerCase()))
    .map((m) => m[2] ?? '')
  if (blocks.length > 0) {
    const longest = blocks.reduce((a, b) => (b.length > a.length ? b : a))
    return longest.trim() || undefined
  }
  const text = answer.trim()
  return /^\s*(import|export|const|let|function|async|class)\b/m.test(text) ? text : undefined
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when the code imports or requires the package (or one of its subpaths). */
export function usesPackage(code: string, packageName: string): boolean {
  const name = escapeRegExp(packageName)
  const spec = `['"]${name}(?:/[^'"]*)?['"]`
  return new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)${spec}`).test(code)
}

export function looksLikeJsx(code: string): boolean {
  return /<\/[A-Za-z]|\/>/.test(code)
}
