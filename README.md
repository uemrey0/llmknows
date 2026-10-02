# llmknows

**Does AI know your library?**

[![npm](https://img.shields.io/npm/v/llmknows.svg)](https://www.npmjs.com/package/llmknows)
[![CI](https://github.com/uemrey0/llmknows/actions/workflows/ci.yml/badge.svg)](https://github.com/uemrey0/llmknows/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/llmknows.svg)](./LICENSE)

Most code that uses your package is now written by an AI model, and it happily calls functions
that don't exist, options you renamed two majors ago, and methods from a different library.

`llmknows` measures it. It asks models to write code against your package, then **typechecks
that code against your package's real type declarations**. No LLM-as-judge, no vibes: if
TypeScript says `z.string().trimmed()` doesn't exist, it doesn't.

```sh
npx llmknows zod -m anthropic:claude-opus-5-5,openai:<model>
```

```
  llmknows · zod@4.6.5 · 25 tasks × 2 models × 1 sample

  API accuracy
  anthropic:claude-opus-5-5  ██████████████████░░   88%  22/25
  openai:<model>             ███████████████░░░░░   76%  19/25

  Most hallucinated APIs
  ✗ ZodString.trimmed      no such member   ×3 · 2 models  → trim
  ✗ ZodError.errors        no such member   ×2 · openai:<model>
  ✗ z.object({ strict })   no such member   ×1 · anthropic:claude-opus-5-5
  ✗ zod/lib/helpers        no such module   ×1 · openai:<model>
```

<sub>Illustrative output. Run it yourself to get real numbers for your package.</sub>

## Why

- **Maintainers** find out which APIs models get wrong, before users file confused issues.
- **Docs teams** get a ready-made correction list for `AGENTS.md` / `llms.txt`
  (`--fix`) and can measure whether it helped.
- **Everyone** gets a badge that says how well AI tools know the package.

## How it works

1. **Plan.** Reads the runtime exports of the package from its `.d.ts` files (functions, classes,
   namespaces, …) and turns each into a task such as *"write an example that calls `connect`
   from `my-db`"*. Bring your own tasks with `--tasks`.
2. **Ask.** Sends every task to every model, as a user would, without telling it the version
   (unless you pass `--version-hint`). Answers are cached in `.llmknows/cache`, so re-runs are
   free.
3. **Typecheck.** Compiles all answers in one TypeScript program against the installed package.
4. **Attribute.** Errors are only counted when they involve the package: importing an export
   that doesn't exist, using a member that isn't there, calling an API with the wrong arguments,
   inventing an option or a subpath. Unrelated mistakes in the snippet are ignored. When
   possible, `llmknows` names the real API the model probably meant.

A sample **passes** when it imports the package and has no package-related type errors.
Refusals and provider errors are reported but not scored.

## Usage

```sh
# A published package (installed into a cache, nothing touches your project)
npx llmknows date-fns

# A specific version
npx llmknows zod@3 -m anthropic:claude-opus-5-5

# Your own package, from its repo (uses the built types in the working tree)
npx llmknows . --badge llmknows.svg --fix docs/ai-notes.md

# Free and local, with Ollama
npx llmknows my-lib -m ollama:qwen3

# Several samples per task for steadier numbers, and fail CI below 80%
npx llmknows my-lib -n 3 --min-score 0.8
```

| Option | Description |
| --- | --- |
| `-m, --models <list>` | Comma-separated `provider:model` list. Default `anthropic:claude-opus-5-5`. |
| `-n, --samples <n>` | Answers per task per model. Default `1`. |
| `-t, --max-tasks <n>` | Maximum number of generated tasks. Default `25`. |
| `--tasks <file>` | Your own tasks: a JSON array, or one task per line. |
| `--entry <path>` | Import path to read exports from (repeatable), e.g. `--entry zod/mini`. |
| `--version-hint` | Tell the models which version to target. |
| `-c, --concurrency <n>` | Parallel requests. Default `4`. |
| `--json <file>` | Full report with every answer and error. |
| `--badge <file>` | SVG badge with the average score. |
| `--fix <file>` | Markdown corrections for `AGENTS.md` / `llms.txt`. |
| `--min-score <0-1>` | Exit with code `1` if any model scores lower. |
| `--dry-run` | Print the planned tasks without calling a model. |
| `--no-cache` | Ignore cached answers. |

### Providers

| Provider | Example | Credentials |
| --- | --- | --- |
| `anthropic` | `anthropic:claude-opus-5-5` | `ANTHROPIC_API_KEY` |
| `openai` | `openai:<model>` | `OPENAI_API_KEY` |
| `google` | `google:<gemini-model>` | `GEMINI_API_KEY` |
| `openrouter` | `openrouter:<vendor>/<model>` | `OPENROUTER_API_KEY` |
| `ollama` | `ollama:qwen3` | none (local) |

Any OpenAI-compatible endpoint works by overriding the base URL, e.g.
`OPENAI_BASE_URL=https://my-gateway/v1`. Each provider reads `<PROVIDER>_BASE_URL`.

### Custom tasks

Generated tasks name the API they test. To check whether models find the *right* API on their
own, describe goals instead:

```json
[
  "Validate that a string is an email address and print the error message if not.",
  { "id": "nested", "prompt": "Parse a nested config object with optional fields and defaults." }
]
```

```sh
npx llmknows zod --tasks tasks.json
```

### The fix snippet

`--fix` writes notes you can paste into `AGENTS.md`, `CLAUDE.md` or `llms.txt`:

```md
## Using zod (v4.6.5)

AI models often get these `zod` APIs wrong. They do not exist or are used incorrectly in v4.6.5:

- `ZodString.trimmed` does not exist — use `trim` instead.
- `ZodError.errors` does not exist.
```

Run `llmknows` again with the notes in your prompt or docs to see whether they help.

## Programmatic API

```ts
import { formatReport, run } from 'llmknows'

const report = await run({
  package: 'zod',
  models: ['anthropic:claude-opus-5-5'],
  samples: 2,
})

console.log(formatReport(report, { color: true }))
console.log(report.hallucinations[0])
// { symbol: 'ZodString.trimmed', kind: 'missing-member', count: 3, suggestion: 'trim', ... }
```

Plug in any model by passing a `provider` with a `complete(model, { system, prompt })` method.
The grader is exported too: `grade(snippets, { packageName, packageDir, projectRoot })`.

## Good to know

- Model calls cost money. A default run is `25 tasks × models × samples` requests; use
  `--dry-run` to see the plan and `-t` to keep it small.
- Packages without bundled types fall back to `@types/*` when it exists. Plain JavaScript
  packages without any types can't be graded yet.
- Scores depend on the tasks. Publish your task file next to your badge so others can
  reproduce it.

## Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
