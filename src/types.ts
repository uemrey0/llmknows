/** A model to evaluate, e.g. `anthropic:claude-opus-5-5` or `ollama:qwen3`. */
export interface ModelSpec {
  /** Provider id: `anthropic`, `openai`, `openrouter`, `google`, `ollama`, or a custom one. */
  provider: string
  /** Model id passed to the provider. */
  model: string
  /** The original `provider:model` string, used as a stable label. */
  id: string
}

export interface CompletionRequest {
  system: string
  prompt: string
  /** Index of the repeated sample, so repeated asks are cached separately. */
  sample?: number
}

export type CompletionResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'refused' | 'error'; message: string }

/** Anything that can turn a prompt into text. Implement this to plug in your own provider. */
export interface Provider {
  complete(model: ModelSpec, request: CompletionRequest): Promise<CompletionResult>
}

export type ExportKind = 'function' | 'class' | 'namespace' | 'variable' | 'enum'

export interface ExportedSymbol {
  name: string
  kind: ExportKind
  /** Import path the symbol is exported from (`zod`, `zod/mini`, ...). */
  entry: string
}

export interface Task {
  id: string
  prompt: string
  /** Symbol this task was generated for, when auto-generated. */
  symbol?: string
}

export type IssueKind =
  /** Imports a name the package does not export. */
  | 'missing-export'
  /** Accesses a property or method that does not exist on a package type. */
  | 'missing-member'
  /** Calls a package API with the wrong arguments. */
  | 'wrong-signature'
  /** Imports a subpath that does not exist (`pkg/utils`). */
  | 'missing-module'
  /** Any other type error involving a package type. */
  | 'type-error'

export interface Issue {
  kind: IssueKind
  /** Stable key used to aggregate issues across samples, e.g. `zod.nativeEnum`. */
  symbol: string
  message: string
  /** TypeScript's or llmknows' suggestion for the real API, if any. */
  suggestion?: string
  code: number
  line: number
}

export type SampleStatus = 'pass' | 'fail' | 'no-code' | 'unused' | 'refused' | 'error'

export interface SampleResult {
  model: string
  taskId: string
  sample: number
  status: SampleStatus
  issues: Issue[]
  /** Number of type errors not attributed to the package (ignored for scoring). */
  otherErrors: number
  code?: string
  error?: string
}

export interface HallucinatedSymbol {
  symbol: string
  kind: IssueKind
  count: number
  models: string[]
  suggestion?: string
  example: string
}

export interface ModelScore {
  model: string
  total: number
  passed: number
  /** passed / graded, 0..1. Refusals and provider errors are excluded from the denominator. */
  score: number
  graded: number
  byStatus: Record<SampleStatus, number>
}

export interface Report {
  package: { name: string; version: string }
  createdAt: string
  tasks: Task[]
  models: ModelScore[]
  hallucinations: HallucinatedSymbol[]
  samples: SampleResult[]
}
