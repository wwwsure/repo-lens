import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanTree } from '../src/index.ts';
import { makeTempRepo, removeDir } from './helpers.ts';

const FIXTURE: Record<string, string> = {
  'src/index.ts': 'export const x = 1;\n',
  'src/util.js': 'module.exports = {};\n',
  'README.md': '# fixture\n',
  '.gitignore': 'secret.txt\n*.log\n',
  'secret.txt': 'top secret\n',
  'debug.log': 'log line\n',
  'build/bundle.js': 'minified\n',
  'node_modules/dep/index.js': 'should be excluded\n',
};

test('scanTree: 统计文件数/字节数/语言分布', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const result = await scanTree(root);
    // src/index.ts + src/util.js + README.md + .gitignore（secret.txt、*.log 被 gitignore，build/ 与 node_modules/ 被默认忽略）
    assert.equal(result.fileCount, 4);
    assert.ok(result.totalBytes > 0);
    const langNames = result.languages.map((l) => l.name);
    assert.ok(langNames.includes('TypeScript'));
    assert.ok(langNames.includes('JavaScript'));
    assert.ok(langNames.includes('Markdown'));
    // 按字节降序
    for (let i = 1; i < result.languages.length; i++) {
      assert.ok(result.languages[i - 1]!.bytes >= result.languages[i]!.bytes);
    }
  } finally {
    await removeDir(root);
  }
});

test('scanTree: 默认忽略目录不出现在树中', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const result = await scanTree(root);
    const topNames = result.tree.children.map((c) => c.name);
    assert.ok(!topNames.includes('node_modules'));
    assert.ok(!topNames.includes('build'));
    const srcDir = result.tree.children.find((c) => c.name === 'src');
    assert.ok(srcDir && srcDir.type === 'dir');
    assert.equal(srcDir.fileCount, 2);
  } finally {
    await removeDir(root);
  }
});

test('scanTree: --no-gitignore 时忽略 .gitignore', async () => {
  const root = await makeTempRepo(FIXTURE);
  try {
    const result = await scanTree(root, { gitignore: false });
    // secret.txt 与 debug.log 不再被忽略（build/node_modules 仍被默认忽略）
    assert.equal(result.fileCount, 6);
    const topNames = result.tree.children.map((c) => c.name);
    assert.ok(topNames.includes('secret.txt'));
    assert.ok(topNames.includes('debug.log'));
  } finally {
    await removeDir(root);
  }
});

test('scanTree: 树节点目录优先排序', async () => {
  const root = await makeTempRepo({
    'zz.txt': 'z\n',
    'aa/index.ts': 'a\n',
    'mm.md': 'm\n',
  });
  try {
    const result = await scanTree(root);
    const order = result.tree.children.map((c) => `${c.type}:${c.name}`);
    assert.deepEqual(order, ['dir:aa', 'file:mm.md', 'file:zz.txt']);
  } finally {
    await removeDir(root);
  }
});

test('scanTree: 不存在的目录返回空结果（容错，校验在 analyzeRepo）', async () => {
  const result = await scanTree('definitely-not-exists-repo-lens');
  assert.equal(result.fileCount, 0);
  assert.equal(result.totalBytes, 0);
  assert.deepEqual(result.languages, []);
});
