import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CACHE_DIR_NAME, PROFILE_FILE_NAME, analyzeRepo, loadProfile, saveProfile } from '../src/index.ts';
import { makeTempRepo, removeDir } from './helpers.ts';

test('cache: saveProfile → loadProfile 往返一致', async () => {
  const root = await makeTempRepo({
    'package.json': JSON.stringify({ name: 'cache-fixture', version: '1.0.0' }),
    'src/index.ts': 'export {};\n',
  });
  try {
    const profile = await analyzeRepo(root);
    const filePath = await saveProfile(profile);
    assert.equal(filePath, path.join(root, CACHE_DIR_NAME, PROFILE_FILE_NAME));
    const loaded = await loadProfile(root);
    assert.ok(loaded);
    assert.equal(loaded.name, profile.name);
    assert.equal(loaded.files, profile.files);
    assert.equal(loaded.bytes, profile.bytes);
    assert.equal(loaded.tree.type, 'dir');
    assert.equal(loaded.schemaVersion, 1);
  } finally {
    await removeDir(root);
  }
});

test('cache: 无缓存文件返回 null', async () => {
  const root = await makeTempRepo({ 'README.md': '# empty\n' });
  try {
    assert.equal(await loadProfile(root), null);
  } finally {
    await removeDir(root);
  }
});

test('cache: 损坏 JSON 返回 null', async () => {
  const root = await makeTempRepo({ [`${CACHE_DIR_NAME}/${PROFILE_FILE_NAME}`]: '{ broken' });
  try {
    assert.equal(await loadProfile(root), null);
  } finally {
    await removeDir(root);
  }
});

test('cache: schemaVersion 不匹配返回 null', async () => {
  const root = await makeTempRepo({ [`${CACHE_DIR_NAME}/${PROFILE_FILE_NAME}`]: '{"schemaVersion": 99}' });
  try {
    assert.equal(await loadProfile(root), null);
  } finally {
    await removeDir(root);
  }
});

test('cache: saveProfile 写出的文件是合法 JSON', async () => {
  const root = await makeTempRepo({ 'src/a.ts': 'export {};\n' });
  try {
    const profile = await analyzeRepo(root);
    const filePath = await saveProfile(profile);
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(text) as { schemaVersion: number };
    assert.equal(parsed.schemaVersion, 1);
  } finally {
    await removeDir(root);
  }
});
