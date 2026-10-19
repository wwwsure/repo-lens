import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ManifestInfo } from './types.ts';

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 极简 TOML section 读取器：提取指定 section 的顶层 `key = value`。
 * 支持跨行数组（以 [ 开头、] 结尾的值整体收集）。
 */
function parseTomlSection(text: string, section: string): Map<string, string> {
  const result = new Map<string, string>();
  let current = '';
  let multilineKey: string | null = null;
  let multilineBuf: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (multilineKey !== null) {
      multilineBuf.push(line);
      if (line.includes(']')) {
        result.set(multilineKey, multilineBuf.join('\n'));
        multilineKey = null;
        multilineBuf = [];
      }
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1]!;
      continue;
    }
    if (current !== section) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    if (value.startsWith('[') && !value.includes(']')) {
      multilineKey = key;
      multilineBuf = [value];
      continue;
    }
    result.set(key, value);
  }
  return result;
}

/** 统计 TOML 数组值中的字符串条目数（依赖数组计数用）。 */
function countTomlArrayItems(value: string | undefined): number {
  if (!value) return 0;
  const matches = value.match(/"[^"]*"|'[^']*'/g);
  return matches ? matches.length : 0;
}

/** 去掉 TOML/JSON 字符串值的引号。 */
function unquote(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = value.match(/^"([^"]*)"'?$|^'([^']*)'$/);
  return m ? (m[1] ?? m[2]) : value;
}

async function parseNpmManifest(root: string): Promise<ManifestInfo | null> {
  const text = await readTextIfExists(path.join(root, 'package.json'));
  if (text === null) return null;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null; // package.json 损坏：跳过
  }
  const deps = Object.keys((pkg['dependencies'] as Record<string, string>) ?? {});
  const devDeps = Object.keys((pkg['devDependencies'] as Record<string, string>) ?? {});

  const entryPoints: string[] = [];
  for (const key of ['main', 'module'] as const) {
    if (typeof pkg[key] === 'string') entryPoints.push(pkg[key]);
  }
  if (typeof pkg['exports'] === 'string') entryPoints.push(pkg['exports']);
  if (typeof pkg['bin'] === 'string') entryPoints.push(pkg['bin']);
  else if (pkg['bin'] && typeof pkg['bin'] === 'object') {
    for (const v of Object.values(pkg['bin'] as Record<string, unknown>)) {
      if (typeof v === 'string') entryPoints.push(v);
    }
  }

  let workspace: string[] | undefined;
  const ws = pkg['workspaces'];
  if (Array.isArray(ws)) {
    workspace = ws.filter((w): w is string => typeof w === 'string');
  } else if (ws && typeof ws === 'object' && Array.isArray((ws as Record<string, unknown>)['packages'])) {
    workspace = ((ws as Record<string, unknown>)['packages'] as unknown[]).filter(
      (w): w is string => typeof w === 'string',
    );
  }

  return {
    type: 'npm',
    path: 'package.json',
    name: typeof pkg['name'] === 'string' ? pkg['name'] : undefined,
    version: typeof pkg['version'] === 'string' ? pkg['version'] : undefined,
    description: typeof pkg['description'] === 'string' ? pkg['description'] : undefined,
    dependencies: deps.length,
    devDependencies: devDeps.length,
    scripts: Object.keys((pkg['scripts'] as Record<string, string>) ?? {}),
    entryPoints: entryPoints.length > 0 ? entryPoints : undefined,
    workspace,
    dependencyList: [...deps, ...devDeps].slice(0, 100),
  };
}

async function parsePyprojectManifest(root: string): Promise<ManifestInfo | null> {
  const text = await readTextIfExists(path.join(root, 'pyproject.toml'));
  if (text === null) return null;
  const project = parseTomlSection(text, 'project');
  const poetry = parseTomlSection(text, 'tool.poetry');
  const poetryDeps = parseTomlSection(text, 'tool.poetry.dependencies');

  const name = unquote(project.get('name')) ?? unquote(poetry.get('name'));
  const version = unquote(project.get('version')) ?? unquote(poetry.get('version'));
  const description = unquote(project.get('description')) ?? unquote(poetry.get('description'));

  let depCount = countTomlArrayItems(project.get('dependencies'));
  if (depCount === 0 && poetryDeps.size > 0) {
    depCount = [...poetryDeps.keys()].filter((k) => k !== 'python').length;
  }

  return {
    type: 'python',
    path: 'pyproject.toml',
    name,
    version,
    description,
    dependencies: depCount,
  };
}

async function parseCargoManifest(root: string): Promise<ManifestInfo | null> {
  const text = await readTextIfExists(path.join(root, 'Cargo.toml'));
  if (text === null) return null;
  const pkg = parseTomlSection(text, 'package');
  const deps = parseTomlSection(text, 'dependencies');
  const devDeps = parseTomlSection(text, 'dev-dependencies');
  return {
    type: 'rust',
    path: 'Cargo.toml',
    name: unquote(pkg.get('name')),
    version: unquote(pkg.get('version')),
    description: unquote(pkg.get('description')),
    dependencies: deps.size,
    devDependencies: devDeps.size,
    dependencyList: [...deps.keys()].slice(0, 100),
  };
}

async function parseGoManifest(root: string): Promise<ManifestInfo | null> {
  const text = await readTextIfExists(path.join(root, 'go.mod'));
  if (text === null) return null;
  let name: string | undefined;
  let depCount = 0;
  const dependencyList: string[] = [];
  let inRequireBlock = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (inRequireBlock) {
      if (line === ')') {
        inRequireBlock = false;
        continue;
      }
      if (!line || line.startsWith('//')) continue;
      depCount++;
      const mod = line.split(/\s+/)[0];
      if (mod) dependencyList.push(mod);
      continue;
    }
    if (line.startsWith('module ')) {
      name = line.slice('module '.length).trim();
      continue;
    }
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (line.startsWith('require ')) {
      depCount++;
      const parts = line.split(/\s+/);
      if (parts[1]) dependencyList.push(parts[1]);
    }
  }
  return {
    type: 'go',
    path: 'go.mod',
    name,
    dependencies: depCount,
    dependencyList: dependencyList.slice(0, 100),
  };
}

/**
 * 解析仓库根目录下的所有已支持依赖清单。
 * @returns 解析成功的清单列表（npm / python / rust / go，顺序固定）。
 */
export async function parseManifests(root: string): Promise<ManifestInfo[]> {
  const absRoot = path.resolve(root);
  const results = await Promise.all([
    parseNpmManifest(absRoot),
    parsePyprojectManifest(absRoot),
    parseCargoManifest(absRoot),
    parseGoManifest(absRoot),
  ]);
  return results.filter((m): m is ManifestInfo => m !== null);
}
