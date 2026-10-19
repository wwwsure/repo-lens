/** 单个文件节点。 */
export interface FileNode {
  name: string;
  /** 相对仓库根目录的路径，使用 `/` 分隔。 */
  path: string;
  type: 'file';
  /** 文件大小（字节）。 */
  size: number;
  /** 识别出的编程语言，无法识别为 null。 */
  language: string | null;
}

/** 目录节点（也用作树根节点）。 */
export interface DirNode {
  name: string;
  /** 相对仓库根目录的路径，根节点为 ''。 */
  path: string;
  type: 'dir';
  children: TreeNode[];
  /** 该目录及其子目录下的文件总数。 */
  fileCount: number;
}

export type TreeNode = FileNode | DirNode;

/** 目录树根节点的别名（CLI 契约兼容）。 */
export type DirEntry = DirNode;

/** 按语言聚合的统计。 */
export interface LanguageStat {
  name: string;
  files: number;
  bytes: number;
}

/** 依赖清单（manifest）解析结果。 */
export interface ManifestInfo {
  type: 'npm' | 'python' | 'rust' | 'go';
  /** 清单文件相对仓库根目录的路径。 */
  path: string;
  name?: string;
  version?: string;
  description?: string;
  /** 直接依赖数量。 */
  dependencies: number;
  /** 开发依赖数量（仅 npm/rust）。 */
  devDependencies?: number;
  /** 脚本/任务名（仅 npm）。 */
  scripts?: string[];
  /** 入口文件（如 main/module/bin/exports）。 */
  entryPoints?: string[];
  /** workspace 配置（monorepo 包 glob）。 */
  workspace?: string[];
  /** 依赖名列表（截断至 100 个）。 */
  dependencyList?: string[];
}

/** 一次分析的完整产物，可缓存为 .repo-lens/profile.json。 */
export interface RepoProfile {
  /** schema 版本，缓存校验用。 */
  schemaVersion: 1;
  /** 仓库根目录绝对路径。 */
  root: string;
  /** 项目名（优先取 manifest 的 name，否则取目录名）。 */
  name: string;
  /** ISO 时间戳。 */
  generatedAt: string;
  files: number;
  dirs: number;
  bytes: number;
  /** 按字节数降序。 */
  languages: LanguageStat[];
  manifests: ManifestInfo[];
  /** 完整目录树。 */
  tree: DirNode;
}

/** scanTree 的汇总结果。 */
export interface ScanResult {
  tree: DirNode;
  fileCount: number;
  dirCount: number;
  totalBytes: number;
  languages: LanguageStat[];
}
