# Releasing llmknows

Releases are automated with [Changesets](https://github.com/changesets/changesets) and published to
npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). There are no npm
tokens stored in this repository, and every release gets an npm provenance attestation.

## How a release happens

1. Contributors add a changeset (`pnpm changeset`) to each user-facing PR.
2. On every push to `main`, `.github/workflows/release.yml` runs `changesets/action/select-mode`:
   - **version**: unreleased changesets exist, so the `version` job opens or updates the
     `chore: version packages` PR (bumps `package.json`, writes `CHANGELOG.md`).
   - **publish**: the version in `package.json` is not on npm yet (the version PR was just merged),
     so the `publish` job builds, runs `changeset publish` with npm, pushes the `vX.Y.Z` tag and
     creates a GitHub Release.
   - **none**: nothing to do.
3. A maintainer reviews and merges the version PR when ready to ship.

Why npm and not pnpm for publishing: pnpm 10 cannot perform npm's OIDC token exchange, so the publish
job hides the pnpm markers in its throwaway checkout and `changeset publish` falls back to
`npm publish` (npm >= 11.5.1, bundled with Node 24). Provenance is generated automatically.

## One-time setup (repository owner)

### 1. GitHub repository settings

- **Settings > Actions > General > Workflow permissions**: enable
  **Allow GitHub Actions to create and approve pull requests** (needed for the version PR).
- **Settings > Code security**: enable **Private vulnerability reporting** (used by `SECURITY.md`),
  Dependabot alerts and security updates. CodeQL runs from `.github/workflows/codeql.yml`, so leave
  CodeQL "default setup" off.
- **Settings > General > Features**: enable **Discussions** (linked from the issue chooser).
- **Settings > General > Pull Requests**: allow **squash merging** only, with the PR title as the
  default commit message.
- **Branch protection / ruleset for `main`**: require a pull request, require the status checks
  **CI OK** and **Conventional PR title**, block force pushes.
- **Settings > Environments**: the `publish` job runs in an environment named `npm` (created
  automatically on first run). Optionally restrict it to the `main` branch or add a required reviewer.

### 2. First publish (manual, once)

npm trusted publishing can only be configured for a package that already exists, so the very first
version is published from your machine:

```sh
pnpm changeset            # describe the initial release (e.g. minor -> 0.1.0)
pnpm changeset version    # bumps package.json and writes CHANGELOG.md
pnpm install
pnpm build && pnpm check:package
npm login
npm publish --access public --provenance=false   # provenance only works from CI
git add -A && git commit -m "chore: release v0.1.0" && git tag v0.1.0
git push origin main --follow-tags
```

`--provenance=false` is required locally because `publishConfig.provenance` is `true` and provenance
can only be generated in a supported CI environment. Every later release will carry provenance.

If `main` is pushed before this step, the `publish` job will try to publish `0.0.0` and fail. That is
harmless: finish the setup below and re-run the workflow, or let the next release pick it up.

### 3. Configure the trusted publisher on npmjs.com

1. Open https://www.npmjs.com/package/llmknows/access (package **Settings**).
2. Under **Trusted Publisher**, choose **GitHub Actions** and enter:
   - Organization or user: `uemrey0`
   - Repository: `llmknows`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
3. Save. Then, under **Publishing access**, select
   **Require two-factor authentication and disallow tokens** so that only the trusted publisher (and
   you, with 2FA) can publish.
4. Revoke any automation or granular npm tokens you created for this package.

From now on, merging the `chore: version packages` PR publishes the release.

## Known caveat: CI on the version PR

Pull requests opened with the default `GITHUB_TOKEN` do not trigger other workflows, so **CI OK** will
not run on the `chore: version packages` PR automatically. To get the checks to run, either close and
reopen the PR (or push an empty commit to the `changeset-release/main` branch), or pass a GitHub App
token to the `version` job via the `github-token` input.

## Troubleshooting

- `ENEEDAUTH` / `E404` on publish: the trusted publisher settings on npmjs.com do not match
  (owner, repo, workflow filename `release.yml`, environment `npm`), or `id-token: write` is missing.
- `npm >= 11.5.1 is required`: the runner's Node 24 ships an older npm; bump `node-version` or add
  `npm install -g npm@latest` before publishing.
- Provenance errors: the repository must be public for provenance to be generated.
