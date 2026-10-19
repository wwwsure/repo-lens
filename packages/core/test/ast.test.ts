import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeCallGraph, resolveChain } from '../src/index.ts';
import { makeTempRepo, removeDir } from './helpers.ts';

/**
 * Fixture covering every edge-resolution rule:
 * - main.ts → foo.ts      cross-file via imported local name
 * - foo.ts  → bar.ts      cross-file chain
 * - helper  outer→inner   same-file top-level declaration
 * - lin.ts  step1→…→step4 linear chain for depth truncation
 * - external.ts           node: import must NOT create an edge
 * - quiet.ts              no calls at all → empty chain
 */
const FIXTURE: Record<string, string> = {
  'main.ts': `import { foo } from './foo';

export function run(): void {
  foo();
}
`,
  'foo.ts': `import { bar } from './bar';

export function foo(): void {
  bar();
}
`,
  'bar.ts': `export function bar(): void {
  console.log('bar');
}
`,
  'helper.ts': `export function inner(): void {}

export function outer(): void {
  inner();
}
`,
  'lin.ts': `function step4(): void {}

function step3(): void {
  step4();
}

function step2(): void {
  step3();
}

function step1(): void {
  step2();
}
`,
  'external.ts': `import { readFileSync } from 'node:fs';

export function load(path: string): void {
  readFileSync(path);
}
`,
  'quiet.ts': `export const VERSION = '1.0.0';
`,
};

test('cross-file call edges resolve through relative imports', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const graph = await analyzeCallGraph(root);

    // foo.ts foo() calls bar() → edge into bar.ts with a line number.
    const fooEdge = graph.edges.find((e) => e.from.file === 'foo.ts' && e.from.name === 'foo');
    assert.ok(fooEdge);
    assert.equal(fooEdge.to.file, 'bar.ts');
    assert.equal(fooEdge.to.name, 'bar');
    assert.equal(typeof fooEdge.line, 'number');

    // main.ts run() calls the imported name foo → edge into foo.ts.
    const mainEdge = graph.edges.find((e) => e.from.file === 'main.ts' && e.from.name === 'run');
    assert.ok(mainEdge);
    assert.equal(mainEdge.to.file, 'foo.ts');
    assert.equal(mainEdge.to.name, 'foo');

    // The chain spans files: run → foo → bar.
    const chain = resolveChain(graph, 'main.ts:run', 10);
    assert.deepEqual(
      chain.steps.map((s) => `${s.symbol.file} ${s.symbol.name}`),
      ['foo.ts foo', 'bar.ts bar'],
    );
    assert.equal(chain.truncated, false);
  } finally {
    await removeDir(root);
  }
});

test('same-file call edge via top-level declaration', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const graph = await analyzeCallGraph(root);
    const edge = graph.edges.find(
      (e) => e.from.file === 'helper.ts' && e.from.name === 'outer',
    );
    assert.ok(edge);
    assert.equal(edge.to.file, 'helper.ts');
    assert.equal(edge.to.name, 'inner');
    assert.equal(edge.line, 4);
  } finally {
    await removeDir(root);
  }
});

test('unresolvable external imports create no edges', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const graph = await analyzeCallGraph(root);
    const external = graph.files.find((f) => f.file === 'external.ts');
    assert.ok(external);
    assert.equal(external.imports[0]?.resolved, null);
    assert.equal(
      graph.edges.some((e) => e.from.file === 'external.ts'),
      false,
    );
    // Member calls (console.log in bar.ts) are skipped entirely.
    assert.equal(
      graph.edges.some((e) => e.from.name === 'bar'),
      false,
    );
  } finally {
    await removeDir(root);
  }
});

test('resolveChain truncates at maxDepth', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const graph = await analyzeCallGraph(root);

    const shallow = resolveChain(graph, 'lin.ts:step1', 2);
    assert.equal(shallow.entry.name, 'step1');
    assert.deepEqual(
      shallow.steps.map((s) => s.symbol.name),
      ['step2', 'step3'],
    );
    assert.deepEqual(
      shallow.steps.map((s) => s.depth),
      [1, 2],
    );
    assert.equal(shallow.truncated, true);

    // Deep enough → full chain, not truncated.
    const deep = resolveChain(graph, 'lin.ts:step1', 5);
    assert.deepEqual(
      deep.steps.map((s) => s.symbol.name),
      ['step2', 'step3', 'step4'],
    );
    assert.equal(deep.truncated, false);
  } finally {
    await removeDir(root);
  }
});

test('file:Symbol entry seeds exactly that symbol', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const graph = await analyzeCallGraph(root);

    const bySymbol = resolveChain(graph, 'helper.ts:outer');
    assert.equal(bySymbol.entry.file, 'helper.ts');
    assert.equal(bySymbol.entry.name, 'outer');
    assert.equal(bySymbol.steps.length, 1);
    assert.equal(bySymbol.steps[0]?.symbol.name, 'inner');
    assert.equal(bySymbol.steps[0]?.depth, 1);
    assert.equal(bySymbol.steps[0]?.line, 4);
    assert.equal(bySymbol.truncated, false);

    // Bare file entry seeds every top-level symbol of that file.
    const byFile = resolveChain(graph, 'helper.ts');
    assert.equal(byFile.entry.name, null);
    assert.ok(byFile.steps.some((s) => s.symbol.name === 'inner'));

    // Unknown entry file / symbol are reported as errors.
    assert.throws(() => resolveChain(graph, 'nope.ts'), /entry file not found in call graph/);
    assert.throws(() => resolveChain(graph, 'helper.ts:missing'), /entry symbol not found/);
  } finally {
    await removeDir(root);
  }
});

test('file without calls yields an empty chain', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const graph = await analyzeCallGraph(root);
    const result = resolveChain(graph, 'quiet.ts');
    assert.deepEqual(result.steps, []);
    assert.equal(result.truncated, false);
    assert.equal(result.entry.file, 'quiet.ts');
  } finally {
    await removeDir(root);
  }
});
