import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { CompletionRequest, CompletionResult, ModelSpec, Provider } from './types.js'

/** Providers that speak the OpenAI Chat Completions API. */
const OPENAI_COMPATIBLE: Record<
  string,
  { baseURL?: string; apiKeyEnv: string; keyless?: boolean }
> = {
  openai: { apiKeyEnv: 'OPENAI_API_KEY' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
  google: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  ollama: { baseURL: 'http://localhost:11434/v1', apiKeyEnv: 'OLLAMA_API_KEY', keyless: true },
}

export const PROVIDERS = ['anthropic', ...Object.keys(OPENAI_COMPATIBLE)]

/** Parses `provider:model`. The model part may itself contain colons (`ollama:qwen3:8b`). */
export function parseModel(spec: string): ModelSpec {
  const colon = spec.indexOf(':')
  if (colon <= 0 || colon === spec.length - 1) {
    throw new Error(`Invalid model "${spec}". Use provider:model, e.g. anthropic:claude-opus-5-5.`)
  }
  return { provider: spec.slice(0, colon), model: spec.slice(colon + 1), id: spec }
}

const MAX_TOKENS = 16_000

function failure(error: unknown): CompletionResult {
  return {
    ok: false,
    reason: 'error',
    message: error instanceof Error ? error.message : String(error),
  }
}

/**
 * The built-in provider: Anthropic via the official SDK, everything else via the OpenAI SDK.
 * Clients are created lazily, so a missing key only matters for providers you actually use.
 */
export function createDefaultProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  let anthropic: Anthropic | undefined
  const openai = new Map<string, OpenAI>()

  const openaiClient = (provider: string): OpenAI => {
    const config = OPENAI_COMPATIBLE[provider]
    if (!config) {
      throw new Error(`Unknown provider "${provider}". Supported: ${PROVIDERS.join(', ')}.`)
    }
    let client = openai.get(provider)
    if (!client) {
      const baseURL = env[`${provider.toUpperCase()}_BASE_URL`] ?? config.baseURL
      const apiKey = env[config.apiKeyEnv] ?? (config.keyless ? provider : undefined)
      if (!apiKey) throw new Error(`Set ${config.apiKeyEnv} to use ${provider} models.`)
      client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })
      openai.set(provider, client)
    }
    return client
  }

  return {
    async complete(model: ModelSpec, request: CompletionRequest): Promise<CompletionResult> {
      try {
        if (model.provider === 'anthropic') {
          anthropic ??= new Anthropic()
          const response = await anthropic.messages.create({
            model: model.model,
            max_tokens: MAX_TOKENS,
            system: request.system,
            messages: [{ role: 'user', content: request.prompt }],
          })
          // No server-side fallbacks on purpose: the answer must come from the model being measured.
          if (response.stop_reason === 'refusal') {
            return { ok: false, reason: 'refused', message: 'The model declined the request.' }
          }
          const text = response.content
            .flatMap((block) => (block.type === 'text' ? [block.text] : []))
            .join('\n')
          return { ok: true, text }
        }

        const response = await openaiClient(model.provider).chat.completions.create({
          model: model.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        })
        const choice = response.choices[0]
        if (choice?.message.refusal || choice?.finish_reason === 'content_filter') {
          return {
            ok: false,
            reason: 'refused',
            message: choice.message.refusal ?? 'Content filtered.',
          }
        }
        return { ok: true, text: choice?.message.content ?? '' }
      } catch (error) {
        return failure(error)
      }
    },
  }
}
