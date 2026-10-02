import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface ResolvedPackage {
  name: string
  version: string
  /** Real directory of the package itself. */
  dir: string
  /** Directory whose `node_modules` can resolve the package. Samples are placed here virtually. */
  projectRoot: string
}

export interface ResolveOptions {
  cwd?: string
  /** Where packages that are not installed locally get installed. */
  cacheDir?: string
  /** Called before a package has to be installed from the registry. */
  onInstall?: (spec: string) => void
}

/** Splits `zod`, `zod@4`, `@scope/pkg@^1.2` into name and version range. */
export function parsePackageSpec(spec: string): { name: string; range?: string } {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0)
  if (at === -1) return { name: spec }
  const range = spec.slice(at + 1)
  return range ? { name: spec.slice(0, at), range } : { name: spec.slice(0, at) }
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
}

function findInstalled(name: string, from: string): string | undefined {
  let dir = resolve(from)
  while (true) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function hasTypes(pkg: Record<string, unknown>, dir: string): boolean {
  if (pkg.types || pkg.typings) return true
  if (pkg.exports && JSON.stringify(pkg.exports).includes('.d.')) return true
  return existsSync(join(dir, 'index.d.ts'))
}

/** `@scope/name` → `scope__name`, the DefinitelyTyped naming scheme. */
export function typesPackageName(name: string): string {
  return `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`
}

async function npmInstall(dir: string, specs: string[]): Promise<void> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await run(
    npm,
    ['install', ...specs, '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'],
    { cwd: dir, shell: process.platform === 'win32' },
  )
}

/**
 * Finds a package to evaluate, in this order:
 * 1. the current project *is* the package (a maintainer running llmknows in their repo),
 * 2. the package is installed in the current project,
 * 3. otherwise it is installed into a cache directory from the registry.
 */
export async function resolvePackage(
  spec: string,
  options: ResolveOptions = {},
): Promise<ResolvedPackage> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const { name, range } = parsePackageSpec(spec)

  if (!range) {
    const ownManifest = join(cwd, 'package.json')
    if (existsSync(ownManifest)) {
      const own = await readJson(ownManifest)
      if (own.name === name) {
        // Link the project into a scratch dir so it resolves like an installed dependency.
        const projectRoot = join(tmpdir(), 'llmknows-self', name.replace('/', '__'))
        const link = join(projectRoot, 'node_modules', name)
        await mkdir(dirname(link), { recursive: true })
        if (!existsSync(link)) await symlink(cwd, link, 'junction')
        return { name, version: String(own.version ?? '0.0.0'), dir: cwd, projectRoot }
      }
    }

    const root = findInstalled(name, cwd)
    if (root) {
      const dir = join(root, 'node_modules', name)
      const pkg = await readJson(join(dir, 'package.json'))
      return { name, version: String(pkg.version), dir, projectRoot: root }
    }
  }

  const cacheDir = options.cacheDir ?? join(homedir(), '.cache', 'llmknows', 'packages')
  const projectRoot = join(cacheDir, `${name.replace('/', '__')}@${range ?? 'latest'}`)
  const dir = join(projectRoot, 'node_modules', name)
  if (!existsSync(join(dir, 'package.json'))) {
    options.onInstall?.(spec)
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(projectRoot, 'package.json'), '{"private":true}\n')
    await npmInstall(projectRoot, [`${name}@${range ?? 'latest'}`])
    const installed = await readJson(join(dir, 'package.json'))
    if (!hasTypes(installed, dir)) {
      await npmInstall(projectRoot, [typesPackageName(name)]).catch(() => {})
    }
  }
  const pkg = await readJson(join(dir, 'package.json'))
  return { name, version: String(pkg.version), dir, projectRoot }
}
