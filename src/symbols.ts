import { join } from 'node:path'
import ts from 'typescript'
import { createVirtualProgram, resolveAlias } from './compiler.js'
import type { ExportedSymbol, ExportKind } from './types.js'

function kindOf(symbol: ts.Symbol): ExportKind | undefined {
  const flags = symbol.flags
  if (flags & ts.SymbolFlags.Class) return 'class'
  if (flags & ts.SymbolFlags.Function) return 'function'
  if (flags & ts.SymbolFlags.Enum) return 'enum'
  if (flags & ts.SymbolFlags.ValueModule) return 'namespace'
  if (flags & ts.SymbolFlags.Variable) return 'variable'
  return undefined
}

function isDeprecated(symbol: ts.Symbol): boolean {
  return symbol.getJsDocTags().some((tag) => tag.name === 'deprecated')
}

/**
 * Lists the runtime (value) exports of each entry point, as TypeScript sees them.
 * Type-only, deprecated and underscore-prefixed exports are skipped.
 */
export function extractExports(projectRoot: string, entries: string[]): ExportedSymbol[] {
  const files = new Map<string, string>()
  entries.forEach((entry, i) => {
    files.set(join(projectRoot, `__llmknows_entry_${i}.ts`), `import * as m from '${entry}'\n`)
  })
  const program = createVirtualProgram(files)
  const checker = program.getTypeChecker()
  const result: ExportedSymbol[] = []

  entries.forEach((entry, i) => {
    const source = program.getSourceFile(join(projectRoot, `__llmknows_entry_${i}.ts`))
    const statement = source?.statements[0]
    if (!statement || !ts.isImportDeclaration(statement)) return
    const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier)
    if (!moduleSymbol) {
      throw new Error(`Could not load type declarations for "${entry}".`)
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const name = exported.getName()
      if (name.startsWith('_')) continue
      const target = resolveAlias(checker, exported)
      const kind = kindOf(target)
      if (!kind || isDeprecated(target)) continue
      result.push({ name, kind, entry })
    }
  })

  return result
}
