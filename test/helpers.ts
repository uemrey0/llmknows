import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const fakelibDir = resolve(import.meta.dirname, 'fixtures/fakelib')

/** A scratch project with `fakelib` linked into node_modules. */
export function fakeProject(): { projectRoot: string; packageDir: string; packageName: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'llmknows-test-'))
  mkdirSync(join(projectRoot, 'node_modules'))
  symlinkSync(fakelibDir, join(projectRoot, 'node_modules', 'fakelib'), 'junction')
  return {
    projectRoot,
    packageDir: join(projectRoot, 'node_modules', 'fakelib'),
    packageName: 'fakelib',
  }
}
