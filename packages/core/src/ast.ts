/**
 * AST-level lightweight call-graph analysis.
 *
 * Uses the TypeScript compiler API (createSourceFile + manual traversal, no
 * program/type-checker) to extract per-file imports / top-level declarations /
 * exports / identifier calls, then resolves same-repository call edges and
 * BFS-expands entry call chains.
 *
 * Resolution rules (deliberately shallow — no type information involved):
 * - Only relative import specifiers ('./x', '../x') can resolve to in-repo
 *   files; bare specifiers (aliases, node_modules packages) are external and
 *   never produce edges.
 * - Only identifier calls `foo()` are considered; member calls `x.foo()` are
 *   skipped.
 * - A call becomes an edge when the callee matches (a) a top-level declaration
 *   of the same file, or (b) a local import binding whose target file
 *   declares/exports the same symbol.
 * - An edge is attributed to the enclosing top-level declaration (functions,
 *   classes, top-level consts); calls directly in module scope have no
 *   attributable caller and produce no edge.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { scanTree, type ScanOptions } from './scan.ts';
import type { TreeNode } from './types.ts';

/** File extensions parsed as source. */
const AST_FILE_RE = /\.(?:tsx|jsx|mts|mjs|ts|js)$/;

/** Extension probe order for extension-less import specifiers. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

/** An import binding of one file. */
export interface ImportInfo {
  /** Local binding name as written in the importing file. */
  local: string;
  /** Name in the source module: `'default'`, `'*'` (namespace) or the original named export. */
  imported: string;
  /** Raw module specifier text as written in source. */
  specifier: string;
  /** Repo-relative POSIX path of the target file, or null when external/unresolved. */
  resolved: string | null;
}

/** One identifier call site found in a file. */
export interface CallSite {
  /** Callee identifier text (member calls are skipped entirely). */
  name: string;
  /** 1-based line of the call. */
  line: number;
  /** Enclosing top-level declaration name, or null for module-scope calls. */
  scope: string | null;
}

/** File-level AST extraction result (repo-relative POSIX paths). */
export interface FileAst {
  file: string;
  imports: ImportInfo[];
  /** Top-level function/class/const names (deduplicated, source order). */
  declarations: string[];
  /** Exported symbol names (deduplicated, source order). */
  exports: string[];
  calls: CallSite[];
}

/** A reference to a symbol inside a file. */
export interface SymbolRef {
  file: string;
  name: string;
}

/** A resolved call edge: `from.name` calls `to.name` at `line` (in `from.file`). */
export interface CallEdge {
  from: SymbolRef;
  to: SymbolRef;
  line: number;
}

/** The call graph of a repository. */
export interface CallGraph {
  /** Absolute repository root the graph was computed from. */
  root: string;
  /** Every analyzed source file (sorted by path). */
  files: FileAst[];
  /** All resolved same-repository call edges. */
  edges: CallEdge[];
}

/** One discovered node of a resolved chain (BFS order). */
export interface ChainStep {
  /** The called symbol. */
  symbol: SymbolRef;
  /** Distance from the entry (1-based). */
  depth: number;
  /** The caller that first discovered this symbol. */
  via: SymbolRef;
  /** Line of the call site inside `via.file`, when known. */
  line?: number;
}

/** Result of `resolveChain`. */
export interface ChainResult {
  entry: { file: string; name: string | null };
  steps: ChainStep[];
  /** True when at least one edge would have exceeded `maxDepth`. */
  truncated: boolean;
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function normalizeRel(p: string): string {
  let s = p.replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

/**
 * Resolve a relative import specifier against the importing file.
 * @returns Repo-relative POSIX path of the first candidate that exists in
 *   `fileSet`, or null (external / alias / out-of-repo / unresolved).
 */
function resolveImport(
  fromFile: string,
  specifier: string,
  fileSet: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const base = normalizeRel(path.posix.join(path.posix.dirname(fromFile), specifier));
  const candidates: string[] = [base];
  const hasKnownExt = RESOLVE_EXTENSIONS.some((ext) => base.endsWith(ext));
  if (!hasKnownExt) {
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(base + ext);
  }
  // NodeNext style: source written as './x.js' while the file on disk is x.ts.
  if (base.endsWith('.js')) {
    candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  } else if (base.endsWith('.mjs')) {
    candidates.push(base.slice(0, -4) + '.mts');
  }
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(base + '/index' + ext);
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === kind) ?? false;
}

/** Recursively collect call sites, inheriting `scope` through nested functions. */
function walkCalls(
  node: ts.Node,
  scope: string | null,
  out: CallSite[],
  source: ts.SourceFile,
): void {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      out.push({ name: callee.text, line, scope });
    }
  }
  ts.forEachChild(node, (child) => walkCalls(child, scope, out, source));
}

/** Parse one source file into its `FileAst`. */
function extractFileAst(
  file: string,
  text: string,
  fileSet: ReadonlySet<string>,
): FileAst {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const imports: ImportInfo[] = [];
  const declarations = new Set<string>();
  const exports = new Set<string>();
  const calls: CallSite[] = [];

  const pushImport = (local: string, imported: string, specifier: string): void => {
    imports.push({ local, imported, specifier, resolved: resolveImport(file, specifier, fileSet) });
  };

  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (clause?.name) pushImport(clause.name.text, 'default', specifier);
      if (clause?.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            pushImport(el.name.text, el.propertyName?.text ?? el.name.text, specifier);
          }
        } else if (ts.isNamespaceImport(clause.namedBindings)) {
          pushImport(clause.namedBindings.name.text, '*', specifier);
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      // `export { a, b as c }` / `export { a } from './x'` — record exported names.
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) exports.add(el.name.text);
      }
      // `export * from './x'` cannot be enumerated statically — skipped.
      continue;
    }

    if (ts.isExportAssignment(stmt)) {
      exports.add('default');
      continue;
    }

    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      const name = stmt.name?.text;
      if (name) {
        declarations.add(name);
        if (hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) exports.add(name);
      }
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) exports.add('default');
      walkCalls(stmt, name ?? null, calls, source);
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      for (const decl of stmt.declarationList.declarations) {
        const name = ts.isIdentifier(decl.name) ? decl.name.text : null;
        if (name !== null) {
          declarations.add(name);
          if (exported) exports.add(name);
        }
        if (decl.initializer) walkCalls(decl.initializer, name, calls, source);
      }
      continue;
    }

    // Everything else lives in module scope (interfaces/types contain no calls).
    walkCalls(stmt, null, calls, source);
  }

  return {
    file,
    imports,
    declarations: [...declarations],
    exports: [...exports],
    calls,
  };
}

/** Collect source-file paths (repo-relative POSIX) from a scan tree. */
function collectSourceFiles(node: TreeNode, out: string[]): void {
  if (node.type === 'file') {
    if (AST_FILE_RE.test(node.path)) out.push(node.path);
    return;
  }
  for (const child of node.children) collectSourceFiles(child, out);
}

/**
 * Build the same-repository call graph of a repository.
 *
 * File inventory comes from `scanTree` (same ignore rules as profiling), each
 * source file is parsed with the TypeScript compiler API, relative imports are
 * resolved to in-repo files, and identifier calls are matched to their
 * callees (same-file top-level declaration or imported symbol).
 *
 * @param root Repository root (absolute or relative path).
 * @param options Scan options (forwarded to `scanTree`).
 * @throws when `root` does not exist (propagated from `scanTree`).
 */
export async function analyzeCallGraph(
  root: string,
  options: ScanOptions = {},
): Promise<CallGraph> {
  const absRoot = path.resolve(root);
  const { tree } = await scanTree(absRoot, options);

  const files: string[] = [];
  collectSourceFiles(tree, files);
  files.sort();
  const fileSet = new Set(files);

  // Pass 1: parse every file (import resolution only needs the file inventory).
  const asts = new Map<string, FileAst>();
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(path.join(absRoot, file), 'utf8');
    } catch {
      continue; // vanished between scan and read — skip
    }
    asts.set(file, extractFileAst(file, text, fileSet));
  }

  // Pass 2: resolve call sites to edges.
  const edges: CallEdge[] = [];
  for (const file of files) {
    const ast = asts.get(file);
    if (!ast) continue;
    const declSet = new Set(ast.declarations);
    for (const call of ast.calls) {
      // Module-scope calls have no attributable caller → no edge.
      if (call.scope === null) continue;
      const from: SymbolRef = { file: ast.file, name: call.scope };

      // (a) same-file top-level declaration
      if (declSet.has(call.name)) {
        edges.push({ from, to: { file: ast.file, name: call.name }, line: call.line });
        continue;
      }

      // (b) imported local name whose target declares/exports the symbol
      const binding = ast.imports.find((i) => i.local === call.name);
      if (!binding || binding.resolved === null) continue;
      const target = asts.get(binding.resolved);
      if (!target) continue;
      const targetDecl = new Set([...target.declarations, ...target.exports]);
      const targetName = targetDecl.has(binding.imported)
        ? binding.imported
        : targetDecl.has(call.name)
          ? call.name
          : null;
      if (targetName !== null) {
        edges.push({ from, to: { file: target.file, name: targetName }, line: call.line });
      }
    }
  }

  return {
    root: absRoot,
    files: [...asts.values()],
    edges,
  };
}

/**
 * Split an entry string into file + optional symbol.
 * Accepts `file` or `file:Symbol`; a colon belonging to a Windows drive
 * (`C:/x.ts`) is never treated as a symbol separator.
 */
function splitEntry(entry: string): { file: string; name: string | null } {
  for (let i = entry.length - 1; i >= 0; i--) {
    if (entry[i] !== ':') continue;
    const tail = entry.slice(i + 1);
    if (tail.includes('/') || tail.includes('\\')) continue; // drive colon
    const file = entry.slice(0, i);
    if (file === '' || tail === '') {
      throw new Error(`invalid entry: ${entry} (expected <file> or <file>:<symbol>)`);
    }
    return { file, name: tail };
  }
  if (entry === '') {
    throw new Error(`invalid entry: ${entry} (expected <file> or <file>:<symbol>)`);
  }
  return { file: entry, name: null };
}

const edgeKey = (ref: SymbolRef): string => `${ref.file}::${ref.name}`;

/**
 * BFS a call chain out of an entry point.
 *
 * @param graph Call graph from `analyzeCallGraph`.
 * @param entry `"file"` (seed every top-level symbol of the file) or
 *   `"file:SymbolName"` (seed that symbol). May be absolute (must lie under
 *   `graph.root`) or repo-relative.
 * @param maxDepth Maximum distance from the entry (default 3).
 * @throws {Error} on malformed entry, unknown file or unknown symbol.
 */
export function resolveChain(graph: CallGraph, entry: string, maxDepth = 3): ChainResult {
  const parsed = splitEntry(entry);

  // Normalize the file: backslashes → POSIX, absolute under root → relative.
  const rootPosix = normalizeRel(graph.root);
  let file = normalizeRel(parsed.file);
  if (file.startsWith(rootPosix + '/')) file = file.slice(rootPosix.length + 1);

  const byFile = new Map(graph.files.map((f) => [f.file, f] as const));
  const ast = byFile.get(file);
  if (!ast) {
    throw new Error(`entry file not found in call graph: ${parsed.file}`);
  }

  const depthLimit = Math.max(0, Math.trunc(maxDepth));
  const declared = new Set([...ast.declarations, ...ast.exports]);

  let roots: SymbolRef[];
  if (parsed.name !== null) {
    if (!declared.has(parsed.name)) {
      throw new Error(`entry symbol not found: ${parsed.name} in ${file}`);
    }
    roots = [{ file, name: parsed.name }];
  } else {
    roots = [...declared].map((name) => ({ file, name }));
  }

  const adjacency = new Map<string, CallEdge[]>();
  for (const edge of graph.edges) {
    const key = edgeKey(edge.from);
    const list = adjacency.get(key);
    if (list) list.push(edge);
    else adjacency.set(key, [edge]);
  }

  // Roots are seeds, not visited nodes: an edge between two seeds (a file
  // entry seeds every top-level symbol) must still surface as a step.
  const visited = new Set<string>();
  const queue: Array<{ ref: SymbolRef; depth: number }> = roots.map((ref) => ({ ref, depth: 0 }));
  const steps: ChainStep[] = [];
  let truncated = false;

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const outgoing = adjacency.get(edgeKey(cur.ref));
    if (!outgoing) continue;
    for (const edge of outgoing) {
      const key = edgeKey(edge.to);
      if (visited.has(key)) continue;
      visited.add(key); // BFS ⇒ first discovery is the shallowest path
      const depth = cur.depth + 1;
      if (depth > depthLimit) {
        truncated = true;
        continue;
      }
      steps.push({ symbol: edge.to, depth, via: cur.ref, line: edge.line });
      queue.push({ ref: edge.to, depth });
    }
  }

  return { entry: { file, name: parsed.name }, steps, truncated };
}