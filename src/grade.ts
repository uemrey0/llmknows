import { join } from 'node:path'
import ts from 'typescript'
import { createVirtualProgram, findNode, packageMatcher, resolveAlias } from './compiler.js'
import { looksLikeJsx } from './prompt.js'
import type { Issue, IssueKind } from './types.js'
import { closest, slug } from './util.js'

export interface GradeInput {
  key: string
  code: string
}

export interface GradeContext {
  packageName: string
  packageDir: string
  projectRoot: string
}

export interface GradeOutput {
  issues: Issue[]
  otherErrors: number
}

const MODULE_NOT_FOUND = new Set([2307, 2792])
const MISSING_EXPORT = new Set([2305, 2459, 2460, 2614, 2724])
const MISSING_PROPERTY = new Set([2339, 2551])
const UNKNOWN_OBJECT_PROPERTY = new Set([2353, 2561])
const BAD_CALL = new Set([2345, 2554, 2555, 2556, 2559, 2575, 2769, 2322, 2739, 2740, 2741])

/**
 * Typechecks every snippet in one program against the real package and returns,
 * per snippet, the type errors caused by misusing the package's API.
 */
export function grade(inputs: GradeInput[], context: GradeContext): Map<string, GradeOutput> {
  const files = new Map<string, string>()
  const keyByFile = new Map<string, string>()
  inputs.forEach((input, i) => {
    const ext = looksLikeJsx(input.code) ? 'tsx' : 'ts'
    const file = join(context.projectRoot, '__llmknows__', `${i}-${slug(input.key)}.${ext}`)
    // `export {}` keeps every snippet a module so their top-level names cannot collide.
    files.set(file, `${input.code}\nexport {}\n`)
    keyByFile.set(ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(), input.key)
  })

  const program = createVirtualProgram(files)
  const attributor = new Attributor(program.getTypeChecker(), context)
  const results = new Map<string, GradeOutput>()

  for (const [file] of files) {
    const sourceFile = program.getSourceFile(file)
    const key = keyByFile.get(ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase())
    if (!sourceFile || key === undefined) continue

    const output: GradeOutput = { issues: [], otherErrors: 0 }
    output.otherErrors += program.getSyntacticDiagnostics(sourceFile).length
    const seen = new Set<string>()
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
      const issue = attributor.attribute(sourceFile, diagnostic)
      if (!issue) {
        output.otherErrors++
        continue
      }
      const id = `${issue.kind}:${issue.symbol}`
      if (seen.has(id)) continue
      seen.add(id)
      output.issues.push(issue)
    }
    results.set(key, output)
  }
  return results
}

class Attributor {
  private readonly inPackage: (fileName: string) => boolean

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly context: GradeContext,
  ) {
    this.inPackage = packageMatcher(context.packageDir)
  }

  attribute(sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): Issue | undefined {
    if (diagnostic.start === undefined) return undefined
    const node = findNode(sourceFile, diagnostic.start)
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const code = diagnostic.code
    const make = (kind: IssueKind, symbol: string, suggestion?: string): Issue => {
      const issue: Issue = {
        kind,
        symbol,
        message: message.split('\n')[0] ?? message,
        code,
        line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
      }
      const tsHint = /Did you mean (?:to (?:use|write) )?'([^']+)'/.exec(message)?.[1]
      // Only keep identifier-like hints; TS also suggests rewrites like `import x from "pkg"`.
      const hint = (tsHint && /^[\w$.]+$/.test(tsHint) ? tsHint : undefined) ?? suggestion
      if (hint) issue.suggestion = hint
      return issue
    }

    if (MODULE_NOT_FOUND.has(code)) {
      const spec = /'([^']+)'/.exec(message)?.[1]
      return spec && this.isPackageSpecifier(spec) ? make('missing-module', spec) : undefined
    }

    if (MISSING_EXPORT.has(code)) {
      const declaration = ancestor(node, ts.isImportDeclaration)
      if (!declaration || !ts.isStringLiteral(declaration.moduleSpecifier)) return undefined
      const spec = declaration.moduleSpecifier.text
      if (!this.isPackageSpecifier(spec) || !ts.isIdentifier(node)) return undefined
      const name = node.text
      const moduleSymbol = this.checker.getSymbolAtLocation(declaration.moduleSpecifier)
      const exports = moduleSymbol
        ? this.checker.getExportsOfModule(moduleSymbol).map((s) => s.getName())
        : []
      return make('missing-export', `${spec}.${name}`, closest(name, exports))
    }

    if (MISSING_PROPERTY.has(code)) {
      const access = node.parent
      if (access && ts.isPropertyAccessExpression(access) && access.name === node) {
        const owner = this.ownerOf(access.expression)
        if (!owner) return undefined
        const name = access.name.text
        const members = owner.type
          ? this.checker.getPropertiesOfType(owner.type).map((p) => p.getName())
          : []
        return make('missing-member', `${owner.label}.${name}`, closest(name, members))
      }
      return this.fallback(node, make)
    }

    if (UNKNOWN_OBJECT_PROPERTY.has(code)) {
      const literal = ancestor(node, ts.isObjectLiteralExpression)
      const property = /'([^']+)' does not exist in type/.exec(message)?.[1]
      if (literal && property) {
        const contextual = this.checker.getContextualType(literal)
        let label = contextual && this.packageTypeLabel(contextual)
        // Anonymous option types read badly; name them after the call instead: `z.object({ x })`.
        if (label && !/^[\w$.]+$/.test(label)) {
          const call = this.packageCall(literal)
          label = call ? `${call}({ ${property} })` : undefined
          if (label) return make('missing-member', label)
        }
        if (label && contextual) {
          const members = this.checker.getPropertiesOfType(contextual).map((p) => p.getName())
          return make('missing-member', `${label}.${property}`, closest(property, members))
        }
      }
    }

    if (BAD_CALL.has(code) || UNKNOWN_OBJECT_PROPERTY.has(code)) {
      const call = this.packageCall(node)
      if (call) return make('wrong-signature', call)
    }

    return this.fallback(node, make)
  }

  private isPackageSpecifier(spec: string): boolean {
    const name = this.context.packageName
    return spec === name || spec.startsWith(`${name}/`)
  }

  private declaredInPackage(symbol: ts.Symbol | undefined): boolean {
    return !!symbol?.declarations?.some((d) => this.inPackage(d.getSourceFile().fileName))
  }

  /** The name a package value was imported under: `z` for `import { z }`, the package for `* as`. */
  private importedLabel(identifier: ts.Identifier): string | undefined {
    const symbol = this.checker.getSymbolAtLocation(identifier)
    if (!symbol || !(symbol.flags & ts.SymbolFlags.Alias)) return undefined
    if (!this.declaredInPackage(resolveAlias(this.checker, symbol))) return undefined
    const declaration = symbol.declarations?.[0]
    if (declaration && ts.isImportSpecifier(declaration)) {
      return (declaration.propertyName ?? declaration.name).text
    }
    if (declaration && ts.isNamespaceImport(declaration)) return this.context.packageName
    if (declaration && ts.isImportClause(declaration)) return `${this.context.packageName}.default`
    return identifier.text
  }

  private packageTypeLabel(type: ts.Type): string | undefined {
    const candidates = [type.aliasSymbol, type.getSymbol()]
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) candidates.push(part.aliasSymbol, part.getSymbol())
    }
    for (const symbol of candidates) {
      if (!symbol || !this.declaredInPackage(symbol)) continue
      const name = symbol.getName()
      if (!name.startsWith('__')) return name
      const text = this.checker.typeToString(type)
      return text.length > 40 ? `${text.slice(0, 37)}...` : text
    }
    return undefined
  }

  /** Describes the receiver of a property access, if its type comes from the package. */
  private ownerOf(expression: ts.Expression): { label: string; type?: ts.Type } | undefined {
    const type = this.checker.getTypeAtLocation(expression)
    if (ts.isIdentifier(expression)) {
      const label = this.importedLabel(expression)
      if (label) return { label, type }
    }
    const label = this.packageTypeLabel(type)
    return label ? { label, type } : undefined
  }

  /** Label of the nearest enclosing call whose callee is a package API. */
  private packageCall(node: ts.Node): string | undefined {
    let current: ts.Node | undefined = node
    while (current && !ts.isSourceFile(current)) {
      if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
        const label = this.calleeLabel(current.expression)
        if (label) return label
      }
      if (ts.isStatement(current) || ts.isFunctionLike(current)) break
      current = current.parent
    }
    return undefined
  }

  private calleeLabel(callee: ts.Expression): string | undefined {
    if (ts.isIdentifier(callee)) return this.importedLabel(callee)
    if (ts.isPropertyAccessExpression(callee)) {
      const target = this.checker.getSymbolAtLocation(callee.name)
      if (!this.declaredInPackage(target && resolveAlias(this.checker, target))) return undefined
      const owner = this.ownerOf(callee.expression)
      return `${owner?.label ?? callee.expression.getText()}.${callee.name.text}`
    }
    return undefined
  }

  private fallback(
    node: ts.Node,
    make: (kind: IssueKind, symbol: string) => Issue,
  ): Issue | undefined {
    if (ts.isIdentifier(node)) {
      const label = this.importedLabel(node)
      if (label) return make('type-error', label)
    }
    const call = this.packageCall(node)
    return call ? make('wrong-signature', call) : undefined
  }
}

function ancestor<T extends ts.Node>(node: ts.Node, test: (n: ts.Node) => n is T): T | undefined {
  let current: ts.Node | undefined = node
  while (current) {
    if (test(current)) return current
    current = current.parent
  }
  return undefined
}
