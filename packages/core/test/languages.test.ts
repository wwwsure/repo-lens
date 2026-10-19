import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLanguage } from '../src/index.ts';

test('detectLanguage: 扩展名映射', () => {
  assert.equal(detectLanguage('index.ts'), 'TypeScript');
  assert.equal(detectLanguage('App.tsx'), 'TypeScript');
  assert.equal(detectLanguage('script.mjs'), 'JavaScript');
  assert.equal(detectLanguage('main.py'), 'Python');
  assert.equal(detectLanguage('lib.rs'), 'Rust');
  assert.equal(detectLanguage('main.go'), 'Go');
  assert.equal(detectLanguage('style.module.scss'), 'SCSS');
  assert.equal(detectLanguage('data.yml'), 'YAML');
  assert.equal(detectLanguage('README.md'), 'Markdown');
});

test('detectLanguage: 文件名映射', () => {
  assert.equal(detectLanguage('Dockerfile'), 'Dockerfile');
  assert.equal(detectLanguage('dockerfile'), 'Dockerfile');
  assert.equal(detectLanguage('Makefile'), 'Makefile');
  assert.equal(detectLanguage('go.mod'), 'Go');
  assert.equal(detectLanguage('CMakeLists.txt'), 'CMake');
});

test('detectLanguage: 带路径与大小写', () => {
  assert.equal(detectLanguage('src/lib/util.rs'), 'Rust');
  assert.equal(detectLanguage('SRC/LIB/UTIL.RS'), 'Rust');
  assert.equal(detectLanguage('src\\win\\path.py'), 'Python');
});

test('detectLanguage: 未知扩展与特殊文件返回 null', () => {
  assert.equal(detectLanguage('unknown.xyz'), null);
  assert.equal(detectLanguage('.gitignore'), null);
  assert.equal(detectLanguage('noext'), null);
  assert.equal(detectLanguage('trailing.'), null);
});
