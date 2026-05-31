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
├── src/                      # TypeScript后端源码
│   ├── agent/               # Agent模块（unified-agent ReAct单Agent、tool-registry、tools Skill桥接）
│   ├── api/                 # LLM API封装（支持原生function calling）
│   ├── character/           # 角色卡加载
│   ├── db/                  # SQLite数据库
│   ├── embedding/           # 嵌入向量管理
│   ├── memory/              # 记忆管理
│   ├── retrieval/           # 检索系统（vector/bm25/reranker）
│   ├── skills/              # 内置Skill（search、image-analysis、python-exec、web-surfing）
│   ├── mcp/                 # MCP客户端管理
│   ├── state/               # 状态管理（好感度/情绪）
│   ├── tts/                 # TTS客户端
│   ├── user/                # 用户画像
│   └── index.ts             # 入口
├── services/                 # Python微服务
│   ├── tts/                 # TTS语音合成 (port 5030)
│   ├── image/               # 图像分析 (port 8742)
│   ├── embedding/           # 文本向量化 (port 7860)
│   └── browser/             # 浏览器自动化 (port 8743)
├── script/                   # 安装和启动脚本（详见script/readme.md）
├── webui/                    # Vue3前端
│   └── src/
│       ├── views/            # 页面组件
│       ├── router/           # 路由配置
│       └── api/              # API调用封装
├── character-cards/          # 角色卡目录
│   └── satori/              # 默认角色（古明地觉）
│       ├── live2d/          # Live2D模型和动作
│       ├── knowledge/       # 角色知识资料
│       ├── TTS/             # 语音合成配置
│       └── character.json   # 角色配置
├── live2d-widget/            # 桌宠Live2D渲染组件
├── data/                     # 运行时数据
│   ├── database.sqlite     # SQLite数据库
│   ├── user_profile.json   # 用户画像
│   ├── mcp.json            # MCP服务器配置
│   └── logs/                # 日志文件
├── .env                      # 配置文件（API密钥等）
├── todo.md                   # 设计文档
└── README.md                 # 项目说明
```

## 核心架构要点 ✅

**状态管理器** (`src/state/manager.ts`)：中央协调器，维护多维好感度和情绪状态，协调Agent间通信。情绪随时间自动回归平静。

**Unified ReAct Agent** (`src/agent/unified-agent.ts`)：v6单Agent架构（Polisher+Analyzer合并），原生function calling驱动工具调用。简单对话1次LLM调用，复杂对话2次（tool call → text generation）。ReAct循环最多6轮迭代。

**ToolRegistry** (`src/agent/tool-registry.ts`)：可插拔工具注册中心，解耦Agent与Skill。Skill通过桥接函数注册为Tool，外部插件可直接register()/unregister()。

**渐进式披露** (`src/agent/tools.ts`)：Skill→Tool桥接，永久可见Skill列表（名称+简介），动态披露工具完整参数schema（缓存预加载+触发词匹配+read_skill显式加载）。

**Skill系统** (`src/skills/engine.ts`)：Markdown格式操作说明书，位于`src/skills/<skill-name>/SKILL.md`。启动时仅加载名称和描述，任务匹配时按需加载完整指令。

**记忆系统** (`src/memory/manager.ts`)：SQLite存储，分级结构（年→季→月→周→日→话题七级）。LLM自动识别话题切换，用户画像存放在JSON文件中。

**好感度系统**：多维独立数值（信赖度、亲密度、占有欲），各维度平行插入上下文提示词，不互相覆盖。

**情绪状态**：多维独立数值（悲-喜、愤怒-平静、焦虑-放松），各维度平行插入上下文提示词，不互相覆盖，随时间向平静值回归。

## WebUI路由

| 路径 | 页面 | 状态 |
|------|------|------|
| `/` | 欢迎页 | ✅ 已实现 |
| `/chat` | 对话测试页面 | ✅ 已实现 |
| `/status` | 状态面板 | ✅ 已实现 |
| `/database` | 数据库管理 | ✅ 已实现 |
| `/characters` | 角色卡管理 | ❌ 未实现 |
| `/memories` | 记忆管理 | ❌ 未实现 |
| `/knowledge` | 资料库管理 | ❌ 未实现 |
| `/settings` | 配置管理 | ❌ 未实现 |
| `/plugins` | 插件管理 | ❌ 未实现 |
| `/tasks` | 任务管理 | ❌ 未实现 |

## 数据库表

- `dialogues` - 原始对话（turn_index, user_content, ai_content）
- `memories` - 记忆表（granularity: year/season/month/week/day/topic）
- `tasks` - 定时任务（cron表达式）
- `system_state` - 系统状态（affinity/emotion，按character_id区分）
- `knowledge_base` - 资料库
- `logs` - 日志（达到500条时输出到文件）

## 环境配置

敏感配置使用`.env`文件管理，通过WebUI配置界面操作，不直接编辑文件。

## 当前进度

| 模块 | 状态 |
|------|------|
| 核心后端（Agent/状态/记忆/Skill） | ✅ 完成 |
| 数据库 | ✅ 完成 |
| WebUI基础（首页/状态/对话/数据库） | ✅ 完成 |
| WebUI扩展（角色卡/记忆/资料库/插件/任务/设置） | ❌ 待完成 |
| 桌宠窗口 | 🔄 进行中 |
| 角色卡导入导出 | ❌ 待完成 |

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

- 动态加载当前角色卡对应的Live2D模型等配置，不允许使用默认硬编码。
- 遵从let it crash原则，不允许使用任何缺省值或者守卫语句来规避错误，任何错误都必须在界面上有明显提示，指导用户修正。
- 对齐后端已有的API设计，确保前后端协作顺畅。

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
