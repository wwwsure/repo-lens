import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { detectLanguage } from './languages.ts';
import type { DirNode, FileNode, LanguageStat, ScanResult } from './types.ts';

export interface ScanOptions {
  /** 是否解析仓库根目录的 .gitignore（默认 true）。仅支持基础模式，negation 暂不支持。 */
  gitignore?: boolean;
  /** 额外要跳过的目录名（与默认集合合并）。 */
  ignoreDirs?: string[];
}

/** 默认跳过的目录名。 */
export const DEFAULT_IGNORE_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  'target',
  '.idea',
  '.vscode',
  '.repo-lens',
]);

/** 从 .gitignore 文本提取的基础规则。 */
interface GitignoreRules {
  /** 精确匹配的文件/目录名。 */
  names: Set<string>;
  /** 仅匹配目录名（pattern 以 / 结尾）。 */
  dirs: Set<string>;
  /** 匹配扩展名（*.ext）。 */
  exts: Set<string>;
  /** 含 / 的相对路径前缀。 */
  paths: string[];
}

function parseGitignore(content: string): GitignoreRules {
  const rules: GitignoreRules = { names: new Set(), dirs: new Set(), exts: new Set(), paths: [] };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    // negation（!pattern）暂不支持，直接跳过
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    if (line.startsWith('*.')) {
      rules.exts.add(line.slice(2).toLowerCase());
      continue;
    }
    if (line.endsWith('/')) {
      rules.dirs.add(line.slice(0, -1).replace(/^\/+/, '').toLowerCase());
      continue;
    }
    if (line.includes('/')) {
      rules.paths.push(line.replace(/^\/+/, '').toLowerCase());
      continue;
    }
    rules.names.add(line.toLowerCase());
  }
  return rules;
}

/**
 * 递归扫描目录树，统计文件数、字节数和语言分布。
 * @param root 仓库根目录（绝对或相对路径）。
 * @param options 扫描选项。
 * @returns 扫描结果（含完整目录树）。
 */
export async function scanTree(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const absRoot = path.resolve(root);
  const ignoreDirs = new Set(DEFAULT_IGNORE_DIRS);
  for (const d of options.ignoreDirs ?? []) ignoreDirs.add(d);

  let rules: GitignoreRules | null = null;
  if (options.gitignore !== false) {
    try {
      const content = await fs.readFile(path.join(absRoot, '.gitignore'), 'utf8');
      rules = parseGitignore(content);
    } catch {
      // 无 .gitignore：不应用规则
    }
  }

  const languages = new Map<string, LanguageStat>();
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;

  async function walkDir(dirAbs: string, relPath: string, name: string): Promise<DirNode> {
    const node: DirNode = { name, path: relPath, type: 'dir', children: [], fileCount: 0 };
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return node; // 读取失败（无权限等）：跳过该目录
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const lower = entry.name.toLowerCase();
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (ignoreDirs.has(lower)) continue;
        if (rules) {
          if (rules.dirs.has(lower) || rules.names.has(lower)) continue;
          const rel = childRel.toLowerCase();
          if (rules.paths.some((p) => rel === p || rel.startsWith(p + '/'))) continue;
        }
        dirCount++;
        const child = await walkDir(path.join(dirAbs, entry.name), childRel, entry.name);
        node.fileCount += child.fileCount;
        node.children.push(child);
      } else if (entry.isFile()) {
        if (rules) {
          if (rules.names.has(lower)) continue;
          const dot = entry.name.lastIndexOf('.');
          if (dot > 0 && rules.exts.has(entry.name.slice(dot + 1).toLowerCase())) continue;
          if (rules.paths.some((p) => childRel.toLowerCase() === p)) continue;
        }
        let size = 0;
        try {
          size = (await fs.stat(path.join(dirAbs, entry.name))).size;
        } catch {
          continue;
        }
        const language = detectLanguage(entry.name);
        const fileNode: FileNode = { name: entry.name, path: childRel, type: 'file', size, language };
        node.children.push(fileNode);
        fileCount++;
        totalBytes += size;
        node.fileCount++;
        if (language) {
          const stat = languages.get(language) ?? { name: language, files: 0, bytes: 0 };
          stat.files++;
          stat.bytes += size;
          languages.set(language, stat);
        }
      }
    }
    return node;
  }

  const tree = await walkDir(absRoot, '', path.basename(absRoot) || absRoot);
  const langStats = [...languages.values()].sort((a, b) => b.bytes - a.bytes);
  return { tree, fileCount, dirCount, totalBytes, languages: langStats };
}
