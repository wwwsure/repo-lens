import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes, formatSummary, formatTree, type DirNode } from '../src/index.ts';

function makeTree(): DirNode {
  return {
    name: 'proj',
    path: '',
    type: 'dir',
    fileCount: 3,
    children: [
      {
        name: 'src',
        path: 'src',
        type: 'dir',
        fileCount: 2,
        children: [
          { name: 'index.ts', path: 'src/index.ts', type: 'file', size: 20, language: 'TypeScript' },
          {
            name: 'lib',
            path: 'src/lib',
            type: 'dir',
            fileCount: 1,
            children: [{ name: 'util.ts', path: 'src/lib/util.ts', type: 'file', size: 10, language: 'TypeScript' }],
          },
        ],
      },
      { name: 'README.md', path: 'README.md', type: 'file', size: 5, language: 'Markdown' },
    ],
  };
}

test('formatBytes: 单位与精度', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(1024 * 1024 * 1536), '1.5 GB');
});

test('formatTree: 默认完整展开', () => {
  const text = formatTree(makeTree());
  const lines = text.split('\n');
  assert.equal(lines[0], 'proj/');
  assert.ok(text.includes('├── src/'));
  assert.ok(text.includes('│   ├── index.ts'));
  assert.ok(text.includes('│   └── lib/'));
  assert.ok(text.includes('│       └── util.ts'));
  assert.ok(text.includes('└── README.md'));
});

test('formatTree: maxDepth 截断并标记 …', () => {
  const text = formatTree(makeTree(), { maxDepth: 1 });
  assert.ok(text.includes('│   ├── index.ts'));
  // lib 在深度 2，被截断
  assert.ok(text.includes('lib/'));
  assert.ok(!text.includes('util.ts'));
  assert.ok(text.includes('…'));
});

test('formatSummary: 包含关键信息', () => {
  const summary = formatSummary({
    schemaVersion: 1,
    root: 'D:/x/proj',
    name: 'proj',
    generatedAt: '2026-10-19T00:00:00.000Z',
    files: 3,
    dirs: 2,
    bytes: 1536,
    languages: [
      { name: 'TypeScript', files: 2, bytes: 1400 },
      { name: 'Markdown', files: 1, bytes: 136 },
    ],
    manifests: [
      {
        type: 'npm',
        path: 'package.json',
        name: 'proj',
        version: '1.0.0',
        dependencies: 2,
        devDependencies: 1,
        scripts: ['build', 'test'],
        entryPoints: ['dist/index.js'],
      },
    ],
    tree: makeTree(),
  });
  assert.ok(summary.includes('proj'));
  assert.ok(summary.includes('Files: 3'));
  assert.ok(summary.includes('TypeScript'));
  assert.ok(summary.includes('npm'));
  assert.ok(summary.includes('.repo-lens/profile.json'));
});
