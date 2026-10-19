import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeRepo } from '../src/index.ts';
import { makeTempRepo, removeDir } from './helpers.ts';

test('analyzeRepo: 端到端产出完整画像', async () => {
  const root = await makeTempRepo({
    'package.json': JSON.stringify({ name: 'e2e-fixture', version: '0.1.0' }),
    'src/index.ts': 'export const answer = 42;\n',
    'src/cli.ts': 'console.log("hi");\n',
    'README.md': '# e2e\n',
  });
  try {
    const profile = await analyzeRepo(root);
    assert.equal(profile.schemaVersion, 1);
    assert.equal(profile.root, path.resolve(root));
    // 名称优先取 manifest 的 name
    assert.equal(profile.name, 'e2e-fixture');
    assert.equal(profile.files, 4); // package.json + src/*2 + README.md
    assert.ok(profile.dirs >= 1);
    assert.ok(profile.bytes > 0);
    assert.ok(!Number.isNaN(Date.parse(profile.generatedAt)));
    assert.equal(profile.manifests.length, 1);
    assert.equal(profile.manifests[0]!.type, 'npm');
    assert.equal(profile.tree.type, 'dir');
    assert.equal(profile.tree.name, path.basename(root));
    const tsStat = profile.languages.find((l) => l.name === 'TypeScript');
    assert.ok(tsStat);
    assert.equal(tsStat.files, 2);
  } finally {
    await removeDir(root);
  }
});

test('analyzeRepo: 无 manifest 时名称回退为目录名', async () => {
  const root = await makeTempRepo({ 'a.py': 'print(1)\n' });
  try {
    const profile = await analyzeRepo(root);
    assert.equal(profile.name, path.basename(root));
    assert.deepEqual(profile.manifests, []);
  } finally {
    await removeDir(root);
  }
});

test('analyzeRepo: 目录不存在时抛错', async () => {
  await assert.rejects(() => analyzeRepo('no-such-repo-lens-dir'), /directory not found/);
});

test('analyzeRepo: 传入文件时抛错', async () => {
  const root = await makeTempRepo({ 'file.txt': 'x\n' });
  try {
    await assert.rejects(() => analyzeRepo(path.join(root, 'file.txt')), /not a directory/);
  } finally {
    await removeDir(root);
  }
});
