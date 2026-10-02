# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

Every pull request that changes user-facing behavior (CLI output, flags, exports, types, defaults)
needs a changeset. Create one with:

```sh
pnpm changeset
```

Pick the bump type (`patch` for fixes, `minor` for features, `major` for breaking changes) and write a
one or two sentence summary for the changelog. Commit the generated Markdown file with your PR.

Internal-only changes (CI, tests, refactors with no behavior change) do not need a changeset.

See [RELEASING.md](../RELEASING.md) for how changesets turn into npm releases.
