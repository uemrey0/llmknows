# Contributing to llmknows

Thanks for your interest in improving llmknows. This guide covers everything you need to get a change
merged.

## Development setup

Requirements:

- Node.js 20 or newer (CI tests 20, 22 and 24)
- [pnpm](https://pnpm.io) 10 (the exact version is pinned in `package.json` under `packageManager`;
  run `corepack enable` and it will be picked up automatically)

```sh
git clone https://github.com/uemrey0/llmknows.git
cd llmknows
pnpm install
```

### Scripts

| Command               | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `pnpm build`          | Build `dist/` with tsdown                                  |
| `pnpm dev`            | Rebuild on change                                          |
| `pnpm test`           | Run the test suite once (Vitest)                           |
| `pnpm test:watch`     | Run tests in watch mode                                    |
| `pnpm test:coverage`  | Run tests with V8 coverage                                 |
| `pnpm typecheck`      | Type-check with `tsc --noEmit`                             |
| `pnpm lint`           | Lint and check formatting with Biome                       |
| `pnpm lint:fix`       | Apply safe lint fixes and format                           |
| `pnpm check:package`  | Validate the published package (publint + arethetypeswrong)|
| `pnpm changeset`      | Add a changeset describing your change                     |

Before opening a pull request, run:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm check:package
```

## Running llmknows locally for free (Ollama)

You do not need a paid API key to work on llmknows. [Ollama](https://ollama.com) runs open models on
your machine and exposes an OpenAI-compatible API.

```sh
# 1. Install Ollama, then pull a small coding model
ollama pull qwen2.5-coder:7b

# 2. Build the CLI
pnpm build

# 3. Run it against any npm package
node dist/cli.js zod --models ollama:qwen2.5-coder:7b
```

Ollama listens on `http://localhost:11434` by default. Run `node dist/cli.js --help` for the full list
of providers and options. Small local models hallucinate a lot more than frontier models, which makes
them handy for exercising the reporting code paths.

## Branches

Create a branch from `main` named after the kind of change:

- `feat/<short-description>` for new features
- `fix/<short-description>` for bug fixes
- `docs/…`, `chore/…`, `refactor/…`, `test/…`, `ci/…` for everything else

## Commit messages and PR titles

We use [Conventional Commits](https://www.conventionalcommits.org):

```
feat: add Gemini provider
fix(typecheck): resolve types from package exports map
docs: explain the badge snippet
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`. Mark breaking changes with `!` (for example `feat!: rename --models to --model`).

Pull requests are squash-merged, so **the PR title becomes the commit on `main`**. The PR title is
validated against Conventional Commits in CI and the check must pass before merging.

## Changesets

Every user-facing change needs a changeset:

```sh
pnpm changeset
```

Choose the bump type and write a short summary for the changelog, then commit the generated file in
`.changeset/`. Internal-only changes (CI, tests, refactors with no behavior change) can skip it.

## How releases work

Releases are fully automated with [Changesets](https://github.com/changesets/changesets):

1. Merged PRs with changesets accumulate on `main`.
2. A bot keeps a `chore: version packages` PR open that bumps the version and updates `CHANGELOG.md`.
3. When a maintainer merges that PR, CI publishes the new version to npm with provenance (npm trusted
   publishing, no long-lived tokens) and creates a GitHub Release.

See [RELEASING.md](./RELEASING.md) for details.

## Pull request checklist

- Tests added or updated for the change
- `pnpm lint`, `pnpm typecheck`, `pnpm test` pass locally
- A changeset is included for user-facing changes
- Docs (README, CLI `--help`) updated where relevant

## Reporting bugs and security issues

Open a [bug report](https://github.com/uemrey0/llmknows/issues/new/choose) for bugs. For security
vulnerabilities, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

By participating you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).
