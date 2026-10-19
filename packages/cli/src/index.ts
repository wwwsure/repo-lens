#!/usr/bin/env node
/**
 * repo-lens CLI entry point (bin: `repo-lens`).
 *
 * Commands:
 *   repo-lens analyze [dir=.] [--json] [--no-cache] [--no-gitignore]
 *   repo-lens map     [dir=.] [--max-depth N=4] [--no-cache]
 *
 * All failures print `repo-lens: <message>` to stderr and exit 1.
 */
import { createRequire } from 'node:module';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  analyzeRepo,
  formatSummary,
  formatTree,
  loadProfile,
  saveProfile,
} from '@repo-lens/core';
import type { DirEntry } from '@repo-lens/core';
import { CliError, parseArgs } from './args.js';
import type { AnalyzeOptions, MapOptions, ParsedCommand } from './args.js';

const HELP = `repo-lens — 帮 AI 编码助手省 token 地读仓库

用法:
  repo-lens analyze [dir] [options]   分析仓库，生成 profile 并缓存
  repo-lens map [dir] [options]       打印目录树地图
  repo-lens --help                    显示本帮助
  repo-lens --version                 显示版本

命令:
  analyze   分析 <dir>（缺省为当前目录），把结果缓存到 <dir>/.repo-lens/profile.json
  map       打印 <dir> 的目录树；优先读取已有缓存，无缓存时现算

选项:
  --json            (analyze) 以 JSON 输出 profile，而非可读摘要
  --no-cache        忽略缓存：analyze 不写入；map 不读取缓存
  --no-gitignore    (analyze) 不遵循 .gitignore，扫描全部目录
  --max-depth N     (map) 目录树最大深度，缺省 4
  -h, --help        显示帮助
  -v, --version     显示版本

示例:
  repo-lens analyze .
  repo-lens analyze ./packages/core --json
  repo-lens map ./packages/core --max-depth 3
`;

function readVersion(): string {
  // dist/index.js → ../package.json resolves to this package's manifest.
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as { version?: string };
  return pkg.version ?? '0.0.0';
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** stat() that maps "missing" (ENOENT / ENOTDIR) to null instead of throwing. */
async function statOrNull(absolute: string) {
  try {
    return await stat(absolute);
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve `input` against the cwd and verify it is a directory.
 *
 * @throws {CliError} with a user-facing message when missing / not a directory.
 */
async function ensureDirectory(input: string): Promise<string> {
  const absolute = resolve(input);
  const info = await statOrNull(absolute);
  if (info === null) {
    throw new CliError(`directory not found: ${input}`);
  }
  if (!info.isDirectory()) {
    throw new CliError(`not a directory: ${input}`);
  }
  return absolute;
}

async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  const root = await ensureDirectory(options.dir);
  const profile = await analyzeRepo(root, { gitignore: options.gitignore });
  if (options.cache) {
    await saveProfile(profile);
  }
  if (options.json) {
    console.log(JSON.stringify(profile, null, 2));
  } else {
    console.log(formatSummary(profile));
  }
}

async function runMap(options: MapOptions): Promise<void> {
  const root = await ensureDirectory(options.dir);
  let tree: DirEntry | null = null;
  if (options.cache) {
    const cached = await loadProfile(root);
    tree = cached ? cached.tree : null;
  }
  if (tree === null) {
    // Cache miss (or --no-cache): compute fresh. `map` only reads the cache,
    // `analyze` is the command that writes it.
    const profile = await analyzeRepo(root);
    tree = profile.tree;
  }
  console.log(formatTree(tree, { maxDepth: options.maxDepth }));
}

async function main(argv: string[]): Promise<void> {
  const parsed: ParsedCommand = parseArgs(argv);
  switch (parsed.kind) {
    case 'help':
      console.log(HELP);
      return;
    case 'version':
      console.log(readVersion());
      return;
    case 'analyze':
      await runAnalyze(parsed.options);
      return;
    case 'map':
      await runMap(parsed.options);
      return;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`repo-lens: ${message}`);
  process.exit(1);
});
