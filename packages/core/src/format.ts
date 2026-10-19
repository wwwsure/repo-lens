import type { DirNode, RepoProfile } from './types.ts';

/** 字节数的可读表示：B / KB / MB / GB。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export interface FormatTreeOptions {
  /** 目录树最大深度（根目录为 0，不限制传 Infinity）。默认不限制。 */
  maxDepth?: number;
}

/**
 * 把目录树渲染为 ASCII 文本树（├── / └──）。
 * @param tree 目录树根节点。
 * @param options maxDepth：超出深度的子目录以 … 标记不再展开。
 * @returns 多行文本。
 */
export function formatTree(tree: DirNode, options: FormatTreeOptions = {}): string {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const lines: string[] = [`${tree.name}/`];

  function walk(node: DirNode, prefix: string, depth: number): void {
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const isLast = i === children.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      if (child.type === 'file') {
        lines.push(prefix + connector + child.name);
      } else {
        lines.push(prefix + connector + `${child.name}/`);
        if (depth + 1 <= maxDepth) {
          walk(child, nextPrefix, depth + 1);
        } else {
          lines.push(`${nextPrefix}…`);
        }
      }
    }
  }

  walk(tree, '', 0);
  return lines.join('\n');
}

/**
 * 仓库画像的紧凑文本摘要：基本信息、文件统计、语言分布、依赖清单。
 * @param profile 仓库画像。
 * @returns 多行文本。
 */
export function formatSummary(profile: RepoProfile): string {
  const lines: string[] = [];
  lines.push(`repo-lens profile — ${profile.name}`);
  lines.push(`  root:      ${profile.root}`);
  lines.push(`  generated: ${profile.generatedAt}`);
  lines.push('');
  lines.push(`Files: ${profile.files}   Dirs: ${profile.dirs}   Size: ${formatBytes(profile.bytes)}`);

  if (profile.languages.length > 0) {
    lines.push('');
    lines.push('Languages (top by size):');
    const total = profile.bytes || 1;
    for (const lang of profile.languages.slice(0, 8)) {
      const pct = ((lang.bytes / total) * 100).toFixed(1);
      lines.push(
        `  ${lang.name.padEnd(12)} ${String(lang.files).padStart(5)} files  ${formatBytes(lang.bytes).padStart(10)}  ${pct.padStart(5)}%`,
      );
    }
  }

  if (profile.manifests.length > 0) {
    lines.push('');
    lines.push('Manifests:');
    for (const m of profile.manifests) {
      const title = [m.name, m.version].filter(Boolean).join('@') || m.path;
      const depInfo =
        m.devDependencies !== undefined ? `deps ${m.dependencies}, dev ${m.devDependencies}` : `deps ${m.dependencies}`;
      lines.push(`  ${m.type.padEnd(7)} ${m.path} — ${title} (${depInfo})`);
      if (m.entryPoints && m.entryPoints.length > 0) {
        lines.push(`          entry: ${m.entryPoints.join(', ')}`);
      }
      if (m.scripts && m.scripts.length > 0) {
        lines.push(`          scripts: ${m.scripts.join(', ')}`);
      }
      if (m.workspace && m.workspace.length > 0) {
        lines.push(`          workspace: ${m.workspace.join(', ')}`);
      }
    }
  }

  lines.push('');
  lines.push('Cache: .repo-lens/profile.json');
  return lines.join('\n');
}
