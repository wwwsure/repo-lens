import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RepoProfile } from './types.ts';

/** 缓存目录名（位于仓库根目录下）。 */
export const CACHE_DIR_NAME = '.repo-lens';

/** profile 缓存文件名。 */
export const PROFILE_FILE_NAME = 'profile.json';

/**
 * 将分析结果持久化到 <root>/.repo-lens/profile.json。
 * @param profile 分析得到的仓库画像。
 * @returns 写入的缓存文件绝对路径。
 */
export async function saveProfile(profile: RepoProfile): Promise<string> {
  const dir = path.join(profile.root, CACHE_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, PROFILE_FILE_NAME);
  await fs.writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  return filePath;
}

/**
 * 读取仓库根目录下的 profile 缓存。
 * 文件不存在、损坏或 schema 不匹配时返回 null，不抛错。
 * @param root 仓库根目录。
 * @returns 缓存的仓库画像，无有效缓存则为 null。
 */
export async function loadProfile(root: string): Promise<RepoProfile | null> {
  const filePath = path.join(path.resolve(root), CACHE_DIR_NAME, PROFILE_FILE_NAME);
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(text) as RepoProfile;
    if (data?.schemaVersion !== 1 || data?.tree?.type !== 'dir' || !Array.isArray(data.languages)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
