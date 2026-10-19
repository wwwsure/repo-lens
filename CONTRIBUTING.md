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

- `packages/core` — 分析内核（目录树扫描、manifest 解析、语言检测、profile 缓存与格式化）
- `packages/cli` — 命令行壳（`repo-lens analyze` / `repo-lens map`，bin 名 `repo-lens`）

> MCP server 壳与各 harness 的 SKILL.md 壳尚未实现，见 [README 路线图](README.md#路线图)。

## Workspace 命令

在仓库根目录运行。本仓库使用 TypeScript project references，`tsc -b` 增量构建：

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖并链接 workspace 包 |
| `pnpm build` | `tsc -b`，增量构建 `packages/core` 与 `packages/cli` |
| `pnpm test` | `node --test packages/core/test/`，运行全部单测 |
| `pnpm clean` | `tsc -b --clean`，清理构建产物 |

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

测试基于 Node 内置的 `node:test`，无额外测试框架依赖：

```bash
pnpm test          # 运行全部测试（packages/core/test/）
pnpm test --watch  # 监听模式
```

新增分析能力时，请同时新增对应的测试用例。
