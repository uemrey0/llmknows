import { realpathSync } from 'node:fs'
import ts from 'typescript'

export const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  jsx: ts.JsxEmit.ReactJSX,
  // Generated snippets are judged on API correctness, not on their own type hygiene.
  strict: false,
  noImplicitAny: false,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  noEmit: true,
  allowJs: false,
}

export const toPosix = (path: string): string => path.replaceAll('\\', '/')

/** Builds a program where `files` exist only in memory but resolve modules from disk. */
export function createVirtualProgram(files: Map<string, string>): ts.Program {
  const host = ts.createCompilerHost(compilerOptions, true)
  const virtual = new Map([...files].map(([path, text]) => [toPosix(path), text]))
  const { getSourceFile, fileExists, readFile } = host

  host.fileExists = (name) => virtual.has(toPosix(name)) || fileExists.call(host, name)
  host.readFile = (name) => virtual.get(toPosix(name)) ?? readFile.call(host, name)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const text = virtual.get(toPosix(name))
    if (text !== undefined) return ts.createSourceFile(name, text, languageVersion, true)
    return getSourceFile.call(host, name, languageVersion, onError, shouldCreate)
  }

  return ts.createProgram({ rootNames: [...virtual.keys()], options: compilerOptions, host })
}

/** Returns a predicate telling whether a file path belongs to the package directory. */
export function packageMatcher(packageDir: string): (fileName: string) => boolean {
  const roots = new Set([toPosix(packageDir)])
  try {
    roots.add(toPosix(realpathSync(packageDir)))
  } catch {}
  const prefixes = [...roots].map((root) => (root.endsWith('/') ? root : `${root}/`))
  return (fileName) => {
    const file = toPosix(fileName)
    return prefixes.some((prefix) => file.startsWith(prefix))
  }
}

/** Deepest node whose span contains `position`. */
export function findNode(sourceFile: ts.SourceFile, position: number): ts.Node {
  let found: ts.Node = sourceFile
  const visit = (node: ts.Node): void => {
    if (position >= node.getStart(sourceFile) && position < node.getEnd()) {
      found = node
      ts.forEachChild(node, visit)
    }
  }
  ts.forEachChild(sourceFile, visit)
  return found
}

export function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}
