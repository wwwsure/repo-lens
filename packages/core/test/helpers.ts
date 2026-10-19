import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 在系统临时目录下创建一个 fixture 仓库。
 * @param files 相对路径 → 文件内容的映射（'/' 分隔）。
 * @returns fixture 根目录绝对路径。
 */
export async function makeTempRepo(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-lens-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return root;
}

/** 递归删除目录（不存在时静默）。 */
export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
