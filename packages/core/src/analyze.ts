import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { parseManifests } from './manifest.ts';
import { scanTree, type ScanOptions } from './scan.ts';
import type { RepoProfile } from './types.ts';

/**
 * 分析一个仓库目录：扫描目录树、统计语言分布、解析依赖清单。
 * @param root 仓库根目录（绝对或相对路径）。
 * @param options 扫描选项（是否解析 .gitignore 等）。
 * @returns 完整的仓库画像（RepoProfile，schemaVersion 1）。
 * @throws 目录不存在或不是目录时抛错。
 */
export async function analyzeRepo(root: string, options: ScanOptions = {}): Promise<RepoProfile> {
  const absRoot = path.resolve(root);
  let stat: Stats;
  try {
    stat = await fs.stat(absRoot);
  } catch {
    throw new Error(`directory not found: ${absRoot}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`not a directory: ${absRoot}`);
  }

  const [scan, manifests] = await Promise.all([scanTree(absRoot, options), parseManifests(absRoot)]);
  const name = manifests.find((m) => m.name !== undefined)?.name ?? path.basename(absRoot);

  return {
    schemaVersion: 1,
    root: absRoot,
    name,
    generatedAt: new Date().toISOString(),
    files: scan.fileCount,
    dirs: scan.dirCount,
    bytes: scan.totalBytes,
    languages: scan.languages,
    manifests,
    tree: scan.tree,
  };
}
