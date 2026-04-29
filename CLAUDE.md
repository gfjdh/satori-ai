# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个AI桌宠项目的设计文档仓库。核心功能包括：
- 基于Live2D的桌面宠物形象
- 多模态AI交互（视觉、语言、语音）
- 分级记忆系统和用户画像
- 多维好感度和情绪状态系统
- Skill/MCP扩展系统

## 设计文档

主要的设计规范在 [todo.md](todo.md) 中，采用中文编写。实现代码时应严格遵循该文档中定义的系统架构和数据结构。

## 目录结构

```
satori-ai/
├── skills/                    # Skill扩展目录（空目录，等待填充）
├── character-cards/           # 角色卡目录
│   └── fake-neuro/           # 示例角色（含Live2D模型和动作文件）
│       ├── *.moc3           # Live2D模型文件
│       ├── *.model3.json   # 模型配置
│       ├── motions/         # 动作文件
│       └── libs/            # Live2D相关库
├── data/                      # 用户数据目录（运行时创建）
│   ├── database.sqlite       # SQLite数据库
│   ├── user_profile.json    # 用户画像
│   └── workspace/           # 桌宠工作区
├── .env                      # 配置文件（API密钥等）
└── todo.md                   # 设计文档
```

## 核心架构要点

**状态管理器**：中央协调器，维护好感度（多维）和情绪状态，协调Agent间通信。

**分析Agent**：多模态模型接入，核心职责是上下文管理和任务分解。LLM自行判断是否调用工具（screen_analysis、搜索等）。

**Skill系统**：Markdown格式的操作说明书，位于`skills/<skill-name>/SKILL.md`。启动时仅加载名称和描述，任务匹配时按需加载完整指令。

**记忆系统**：SQLite存储，分级结构（年→季→月→周→日→话题→单轮对话）。用户画像存放在JSON文件中。

**好感度系统**：多维独立数值，各维度平行插入上下文提示词，不互相覆盖。

**情绪状态**：多维独立数值，各维度平行插入上下文提示词，不互相覆盖，随时间向平静值回归。

## WebUI路由

| 路径 | 页面 |
|------|------|
| `/` | 欢迎页 |
| `/characters` | 角色卡管理 |
| `/memories` | 记忆管理 |
| `/knowledge` | 资料库管理 |
| `/settings` | 配置管理 |
| `/plugins` | 插件管理 |
| `/tasks` | 任务管理 |
| `/status` | 状态面板 |

## 数据库表

- `dialogues` - 原始对话（turn_index, user_content, ai_content）
- `memories` - 记忆表（granularity: year/season/month/week/day/topic）
- `tasks` - 定时任务（cron表达式）
- `system_state` - 系统状态（affinity/emotion，按character_id区分）
- `knowledge_base` - 资料库
- `logs` - 日志（达到500条时输出到文件）

## 环境配置

敏感配置使用`.env`文件管理，通过WebUI配置界面操作，不直接编辑文件。

# 行为准则

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.