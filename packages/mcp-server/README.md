# @repo-lens/mcp-server

repo-lens 的 MCP 壳：通过 stdio 暴露仓库分析工具，供 DSH / Claude Code / Codex 等 MCP 宿主调用。

## 工具（v1）

| 工具 | 入参 | 行为 |
| --- | --- | --- |
| `repo_lens_analyze` | `dir?`（默认 server cwd）、`json?` | `analyzeRepo` 现场分析；`json=true` 返回 RepoProfile JSON，否则 `formatSummary` 文本。**不写缓存，无副作用** |
| `repo_lens_map` | `dir?`、`maxDepth?` | 优先 `loadProfile`（`.repo-lens/profile.json`），缺失则 `analyzeRepo`；返回 `formatTree(profile.tree, {maxDepth})` |
| `repo_lens_profile` | `dir?` | `loadProfile`；有缓存返回 JSON，无缓存返回提示文本 `no cached profile, run repo_lens_analyze first` |

错误（目录不存在、非目录等）一律返回 `isError: true` + 错误消息文本，server 不崩溃。

## 宿主接入（stdio）

Claude Code / DSH 配置示例：

```json
{
  "mcpServers": {
    "repo-lens": {
      "command": "node",
      "args": ["D:/vibe-coding/repo-lens/packages/mcp-server/dist/index.js"]
    }
  }
}
```

发布后可直接用 bin 名：`"command": "repo-lens-mcp"`。

## 构建与冒烟验证

```bash
pnpm build                 # 或在本包内 tsc -b（需要先构建 packages/core）
node scripts/smoke.mjs     # 冒烟：initialize 握手 → tools/list 校验三工具 → 错误路径校验
```

`scripts/smoke.mjs` 不依赖任何 LLM / SDK 测试框架：直接 spawn `dist/index.js`，用换行分隔的 JSON-RPC 走一遍 initialize / initialized / tools/list / tools/call，校验：

1. initialize 返回 `serverInfo`；
2. tools/list 恰好包含 `repo_lens_analyze`、`repo_lens_map`、`repo_lens_profile`；
3. 对不存在目录调 `repo_lens_profile` 得到 `isError: true`（证明错误被捕获且 server 存活）。

最小手工验证：`node dist/index.js` 启动 stdio server，stderr 打印 `[repo-lens-mcp] v0.1.0 listening on stdio`，stdout 保持干净（仅 JSON-RPC），等待 stdin 输入不退出、不崩溃。

## 说明

- 依赖 `@modelcontextprotocol/sdk ^1.x` + `zod ^3.23` + `@repo-lens/core workspace:*`。
- 相对导入带 `.ts` 扩展名（项目开启 `rewriteRelativeImportExtensions`，dist 中重写为 `.js`）。
- `repo_lens_analyze` 有意不调用 `saveProfile`：MCP 工具保持无副作用；需要写缓存请用 CLI `repo-lens analyze`。
