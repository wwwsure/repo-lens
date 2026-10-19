# Contributing to RepoLens

感谢你对 RepoLens 的兴趣！本文档说明开发环境搭建、代码规范和 PR 流程。

## 开发环境

- Node.js >= 18
- pnpm（推荐）或 npm

```bash
git clone <repo-url>
cd repo-lens
pnpm install
```

## 项目结构

- `packages/core` — 核心分析引擎（结构提取、调用链、架构地图）
- `packages/mcp-server` — MCP server 壳
- `packages/skills/` — 各 harness 的 SKILL.md 壳
- `packages/cli` — 命令行入口

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

```bash
pnpm test          # 运行全部测试
pnpm test --watch  # 监听模式
```

新增分析能力时，请同时新增对应的测试用例。
