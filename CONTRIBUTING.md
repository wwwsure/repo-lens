# Contributing to RepoLens

感谢你对 RepoLens 的兴趣！本文档说明开发环境搭建、代码规范和 PR 流程。

## 开发环境

- Node.js >= 22.18（与根 `package.json` 的 `engines` 一致）
- pnpm

```bash
git clone <repo-url>
cd repo-lens
pnpm install
```

## 项目结构

- `packages/core` — 分析内核（目录树扫描、manifest 解析、语言识别、profile 缓存、AST 调用图）
- `packages/cli` — 命令行壳（`repo-lens analyze` / `map` / `chain`，bin 名 `repo-lens`）
- `packages/mcp-server` — MCP 壳（stdio 传输，`repo_lens_analyze` / `repo_lens_map` /
  `repo_lens_profile` 三工具，bin 名 `repo-lens-mcp`）

## Workspace 命令

在仓库根目录运行。本仓库使用 TypeScript project references，`tsc -b` 增量构建：

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖并链接 workspace 包 |
| `pnpm build` | `tsc -b`，增量构建 `packages/core`、`packages/cli` 与 `packages/mcp-server` |
| `pnpm test` | `node --test "packages/core/test/*.test.ts"`，运行全部单测（34 个用例） |
| `pnpm clean` | `tsc -b --clean`，清理构建产物 |
| `pnpm --filter @repo-lens/mcp-server smoke` | MCP server 冒烟：握手 → tools/list → 错误路径 |

架构与扩展方式见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 代码规范

- TypeScript strict 模式，禁止 `any`（除非有注释说明）
- 所有导出函数必须有 JSDoc 注释
- 提交信息遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:`）

## PR 流程

1. Fork 并创建 feature 分支（`feat/xxx` 或 `fix/xxx`）
2. 确保 `pnpm build` 和 `pnpm test` 通过
3. 更新相关文档
4. 提交 PR，描述清楚动机和改动范围

## 测试

单测基于 Node 内置的 `node:test`（34 个用例），无额外测试框架依赖：

```bash
pnpm test          # 运行全部测试（packages/core/test/*.test.ts）
pnpm test --watch  # 监听模式
```

改动 `packages/mcp-server` 时另跑冒烟脚本（不依赖 LLM，直接以 JSON-RPC 走 stdio）：

```bash
pnpm --filter @repo-lens/mcp-server smoke
```

新增分析能力时，请同时新增对应的测试用例。
