export { analyzeRepo } from './analyze.ts';
export {
  analyzeCallGraph,
  resolveChain,
  type CallEdge,
  type CallGraph,
  type ChainResult,
  type ChainStep,
  type FileAst,
  type SymbolRef,
} from './ast.ts';
export { loadProfile, saveProfile, CACHE_DIR_NAME, PROFILE_FILE_NAME } from './cache.ts';
export { formatBytes, formatSummary, formatTree, type FormatTreeOptions } from './format.ts';
export { detectLanguage, NAME_LANGUAGES, EXTENSION_LANGUAGES } from './languages.ts';
export { parseManifests } from './manifest.ts';
export { DEFAULT_IGNORE_DIRS, scanTree, type ScanOptions } from './scan.ts';
export type {
  DirEntry,
  DirNode,
  FileNode,
  LanguageStat,
  ManifestInfo,
  RepoProfile,
  ScanResult,
  TreeNode,
} from './types.ts';
