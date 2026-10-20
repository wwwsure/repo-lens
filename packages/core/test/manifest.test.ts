import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseManifests } from '../src/index.ts';
import { makeTempRepo, removeDir } from './helpers.ts';

const NPM_PKG = JSON.stringify(
  {
    name: 'fixture-pkg',
    version: '2.3.4',
    description: 'a fixture package',
    main: 'dist/index.js',
    scripts: { build: 'tsc', test: 'node --test' },
    dependencies: { '@1mper-labs/core': 'workspace:*' },
    devDependencies: { typescript: '^5.7.0', '@types/node': '^22.0.0' },
    workspaces: ['packages/*'],
  },
  null,
  2,
);

const PYPROJECT = `
[project]
name = "fixture-py"
version = "0.1.0"
description = "python fixture"
dependencies = [
    "httpx>=0.27",
    "rich>=13",
]

[build-system]
requires = ["hatchling"]
`;

const CARGO_TOML = `
[package]
name = "fixture-rs"
version = "0.3.0"
description = "rust fixture"

[dependencies]
serde = { version = "1", features = ["derive"] }

[dev-dependencies]
criterion = "0.5"
`;

const GO_MOD = `module example.com/fixture

go 1.22

require (
	github.com/pkg/errors v0.9.1
	golang.org/x/sync v0.7.0
)
`;

test('parseManifests: npm 清单', async () => {
  const root = await makeTempRepo({ 'package.json': NPM_PKG });
  try {
    const [npm] = await parseManifests(root);
    assert.ok(npm);
    assert.equal(npm.type, 'npm');
    assert.equal(npm.name, 'fixture-pkg');
    assert.equal(npm.version, '2.3.4');
    assert.equal(npm.dependencies, 1);
    assert.equal(npm.devDependencies, 2);
    assert.deepEqual(npm.entryPoints, ['dist/index.js']);
    assert.deepEqual(npm.workspace, ['packages/*']);
    assert.ok(npm.scripts?.includes('build'));
  } finally {
    await removeDir(root);
  }
});

test('parseManifests: python 清单（多行依赖数组）', async () => {
  const root = await makeTempRepo({ 'pyproject.toml': PYPROJECT });
  try {
    const [py] = await parseManifests(root);
    assert.ok(py);
    assert.equal(py.type, 'python');
    assert.equal(py.name, 'fixture-py');
    assert.equal(py.version, '0.1.0');
    assert.equal(py.dependencies, 2);
  } finally {
    await removeDir(root);
  }
});

test('parseManifests: rust 清单', async () => {
  const root = await makeTempRepo({ 'Cargo.toml': CARGO_TOML });
  try {
    const [cargo] = await parseManifests(root);
    assert.ok(cargo);
    assert.equal(cargo.type, 'rust');
    assert.equal(cargo.name, 'fixture-rs');
    assert.equal(cargo.dependencies, 1);
    assert.equal(cargo.devDependencies, 1);
  } finally {
    await removeDir(root);
  }
});

test('parseManifests: go 清单（require 块）', async () => {
  const root = await makeTempRepo({ 'go.mod': GO_MOD });
  try {
    const [go] = await parseManifests(root);
    assert.ok(go);
    assert.equal(go.type, 'go');
    assert.equal(go.name, 'example.com/fixture');
    assert.equal(go.dependencies, 2);
  } finally {
    await removeDir(root);
  }
});

test('parseManifests: 多清单共存时顺序固定 npm/python/rust/go', async () => {
  const root = await makeTempRepo({
    'package.json': NPM_PKG,
    'pyproject.toml': PYPROJECT,
    'Cargo.toml': CARGO_TOML,
    'go.mod': GO_MOD,
  });
  try {
    const manifests = await parseManifests(root);
    assert.deepEqual(
      manifests.map((m) => m.type),
      ['npm', 'python', 'rust', 'go'],
    );
  } finally {
    await removeDir(root);
  }
});

test('parseManifests: 无清单返回空数组，损坏 JSON 跳过', async () => {
  const empty = await makeTempRepo({ 'README.md': '# no manifest\n' });
  try {
    assert.deepEqual(await parseManifests(empty), []);
  } finally {
    await removeDir(empty);
  }
  const broken = await makeTempRepo({ 'package.json': '{ not valid json' });
  try {
    assert.deepEqual(await parseManifests(broken), []);
  } finally {
    await removeDir(broken);
  }
});
