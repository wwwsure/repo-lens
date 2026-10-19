# RepoLens 🔍

> 帮 AI 编码助手更省、更准地读懂 GitHub 项目 —— Claude Code / Codex CLI / DSH 的仓库理解插件。

## 这是什么

RepoLens 是一个面向 AI CLI（Claude Code、Codex CLI、DeepSeek Harness 等）的插件：
它用确定性的 AST 分析预先计算仓库的架构地图、调用链和阅读顺序，并缓存在
`.repo-lens/` 目录中，让 agent 无需反复 grep 盲摸，一次调用拿到结论。

**核心价值主张：帮 agent 省 token 地读仓库。**

- ⚡ **省 token**：预计算架构地图，agent 一次调用替代盲目探索
- 🧠 **跨会话持久**：分析结果缓存在仓库内，团队可共享提交
- 🎯 **确定性 > 臆测**：AST 级调用链分析，而非 LLM 猜测

## 架构

```
┌─ Skill 壳（每家 harness 一个薄 SKILL.md，教 agent 何时/如何触发）
├─ MCP 壳（跨平台工具接口：get_repo_map / trace_callchain / get_reading_order）
└─ 内核 CLI（结构提取 → 调用链 → 架构地图 → .repo-lens/ 缓存）
```

## 快速开始

```bash
# 分析当前仓库（生成 .repo-lens/ 缓存）
npx repo-lens analyze .

# 查看架构地图
npx repo-lens map
```

### 在 Claude Code / DSH 中使用

将 `packages/skills/repo-lens` 复制到你的 skills 目录，然后对话中让 agent
"用 repo-lens 分析这个仓库"。

### 在 Codex CLI / Cursor 中使用

配置 MCP server：

```bash
claude mcp add repo-lens -- npx repo-lens mcp
```

## 路线图

- [x] 项目初始化
- [ ] 核心内核：目录树 + 依赖清单解析
- [ ] AST 结构提取（TS/JS 先行）
- [ ] 调用链追踪
- [ ] 架构地图生成
- [ ] MCP server
- [ ] Claude Code / DSH skill 壳
- [ ] Codex CLI 适配
- [ ] Marketplace 上架

## License

MIT
