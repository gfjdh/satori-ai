# Satori AI - AI桌宠

基于多模态Agent的智能桌面宠物，具备独立的情感和记忆系统。

## 功能特性

### 已完成

#### 核心后端 (Node.js + TypeScript) ✅
- **数据库层** (`src/db/database.ts`) - SQLite 实现，六张表：dialogues、memories、tasks、system_state、knowledge_base、logs
- **检索系统** ✅
  - `src/embedding/manager.ts` - 嵌入向量生成与管理
  - `src/retrieval/vector-search.ts` - 向量相似度搜索
  - `src/retrieval/bm25.ts` - BM25关键词检索
  - `src/retrieval/joint-search.ts` - 向量+关键词联合检索
  - `src/retrieval/reranker.ts` - 结果重排序
- **Agent 系统** ✅ (v6 ReAct 单Agent架构)
  - `src/agent/unified-agent.ts` - Unified ReAct Agent，单Agent+原生function calling，简单对话1次LLM调用，复杂对话2次
  - `src/agent/tool-registry.ts` - 可插拔工具注册中心，解耦Agent与Skill
  - `src/agent/tools.ts` - Skill→Tool桥接，渐进式披露（缓存预加载+触发词匹配+read_skill）
  - `src/agent/prompts.ts` - 提示词模板
  - `src/agent/segment-utils.ts` - 文本分段/解析工具
  - `src/agent/dialogue-stats.ts` - 对话统计（支持用户发言过滤和时间限制）
  - `src/agent/proactive-agent.ts` - 主动交互Agent
- **LLM API 层** (`src/api/llm.ts`) - 支持自定义BaseURL和Model，流式输出
- **状态管理器** (`src/state/manager.ts`) - 多维好感度/情绪系统，角色卡动态配置，情绪自动回归
- **记忆管理器** (`src/memory/manager.ts`) - 分级存储（年/季/月/周/日/话题七级），LLM自动话题识别，智能召回，用户状态提取
- **主动交互** (`src/agent/proactive-agent.ts`) - 基于屏幕分析+随机记忆召回的主动对话，SSE长连接推送，频率可配置
- **角色系统** ✅
  - `src/character/loader.ts` - 角色卡加载，支持Live2D配置
  - `src/character/knowledge.ts` - 知识库管理
- **TTS 客户端** (`src/tts/client.ts`) - 语音合成接口
- **Skill 引擎** (`src/skills/engine.ts`) - Markdown格式Skill执行，按需加载
  - 内置 `src/skills/search` - 记忆/资料库检索Skill
  - 内置 `src/skills/image-analysis` - 屏幕分析Skill

#### WebUI (Vue3 + TypeScript) 🔄 进行中
- `/` - 欢迎页 ✅
- `/chat` - 对话测试页面 ✅
- `/status` - 状态面板（日志、心跳状态）✅
- `/database` - 数据库管理 ✅
- `/characters` - 角色卡管理 ❌
- `/memories` - 记忆管理 ❌
- `/knowledge` - 资料库管理 ❌
- `/settings` - 配置管理 ❌
- `/plugins` - 插件管理 ❌
- `/tasks` - 任务管理 ❌

#### TTS 服务 (Python) 🔄 部分
- GPT-SoVITS 语音合成 ✅
- 参考音频克隆 ✅
- RESTful API 接口 ✅

#### 角色卡 ✅
- `character-cards/satori` - 默认角色（古明地觉）
- 包含 Live2D 模型、动作文件、TTS配置
- 好感度维度：信赖度、亲密度、占有欲
- 情绪维度：悲-喜、愤怒-平静、焦虑-放松

#### 桌宠界面 (Live2D) 🔄 进行中
- `live2d-widget/` - Live2D渲染组件，PIXI.js + Cubism SDK
- 动态加载角色卡对应的Live2D模型配置
- 模型位置偏移可配置，支持拖拽和滚轮缩放
- 字幕：多消息流式显示（最多3条），标点感知延迟，10秒自动清除
- 聊天输入框：鼠标悬停时显示，SSE流式对话
- 互动频率设置面板：范围滑块+开关，支持右键菜单触发
- 鼠标躲避：检测鼠标靠近自动移开，支持延迟和取消逻辑
- 右键菜单：打开管理页面、主动互动、设置互动频率（变装/隐藏/退出待实现）
- 错误提示遮罩：配置错误时显示红色遮罩

#### 启动脚本 ✅
- `script/start.ps1` - 一键启动，支持指定角色和运行模式
- `script/` - 分模块启动脚本（backend/embedding/live2d/tts/webui）

#### 嵌入服务 (Python) ✅
- `embedding-service/main.py` - 向量嵌入生成服务
- 支持批量生成和搜索功能

### 待完成

| 模块 | 功能 | 优先级 |
|------|------|--------|
| **桌宠窗口** | 变装、隐藏、退出功能，首次启动引导 | 中 |
| **WebUI页面** | 角色卡管理、资料库、插件管理、任务管理、设置 | 高 |
| **用户状态记忆** | 独立存储表、分级汇总、WebUI展示、主动交互集成 | 中 |
| **心跳任务** | 定时任务触发执行 | 中 |
| **角色卡导入导出** | ZIP打包/解压工具 | 中 |
| **日记功能** | 每日对话总结生成日记 | 低 |
| **游戏化元素** | 成就系统、迷你游戏、挂机收集、商店 | 低 |

## 环境部署

### 依赖

- **Node.js** >= 18
- **Python** >= 3.9 (用于TTS服务)
- **Git**

### 1. 克隆项目

```bash
git clone <repo-url>
cd satori-ai
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填入你的API密钥：

```bash
cp .env.example .env
```

编辑 `.env`:
```env
# LLM API
LLM_API_KEY=your_api_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4

# Vision LLM (图像识别)
VISION_LLM_API_KEY=your_api_key
VISION_LLM_BASE_URL=https://api.openai.com/v1
VISION_LLM_MODEL=gpt-4-vision-preview

# 默认角色
CURRENT_CHARACTER_ID=satori
```

### 3. 安装后端依赖

```bash
npm install
npm run build
```

### 4. 安装 TTS 服务依赖

```bash
cd tts-service
pip install -r requirements.txt
```

### 5. 启动 TTS 服务（可选，如需语音功能）

```bash
cd tts-service
python app.py
```

## 使用方法

### 启动

```powershell
# 启动全部服务（后端 + WebUI）
.\start.ps1 -character satori

# 仅启动后端API
.\start.ps1 -character satori -mode api

# 仅启动WebUI
.\start.ps1 -character satori -mode webui
```

启动后访问：
- 后端API: http://localhost:3682
- WebUI: http://localhost:5173

### 开发模式

```bash
# 后端热重载
npm run dev

# WebUI热重载
cd webui && npm run dev
```

### WebUI 功能

| 路径 | 页面 | 状态 |
|------|------|------|
| `/` | 欢迎页 | ✅ |
| `/chat` | 对话测试页面 | ✅ |
| `/status` | 状态面板（日志、心跳状态） | ✅ |
| `/database` | 数据库管理 | ✅ |
| `/characters` | 角色卡管理 | ❌ |
| `/memories` | 记忆管理 | ❌ |
| `/knowledge` | 资料库管理 | ❌ |
| `/settings` | 配置管理 | ❌ |
| `/plugins` | 插件管理 | ❌ |
| `/tasks` | 任务管理 | ❌ |

### 更换角色

```powershell
.\start.ps1 -character fake-neuro
```

## 项目结构

```
satori-ai/
├── src/                    # TypeScript后端源码
│   ├── agent/             # Agent模块（unified-agent/tool-registry/tools/prompts/segment-utils/dialogue-stats/proactive-agent）
│   ├── api/               # LLM API封装（支持原生function calling）
│   ├── character/         # 角色卡加载
│   ├── db/                # SQLite数据库
│   ├── embedding/         # 嵌入向量管理
│   ├── memory/            # 记忆管理
│   ├── retrieval/         # 检索系统（vector/bm25/reranker）
│   ├── skills/            # 内置Skill（search、image-analysis）
│   ├── state/             # 状态管理（好感度/情绪）
│   ├── tts/               # TTS客户端
│   ├── user/              # 用户画像
│   └── index.ts           # 入口（Express服务器）
├── webui/                  # Vue3前端
│   └── src/
│       ├── views/          # 页面组件
│       ├── router/         # 路由配置
│       ├── api/            # API调用封装
│       └── App.vue         # 根组件
├── character-cards/        # 角色卡目录
│   └── satori/            # 默认角色（古明地觉）
│       ├── live2d/        # Live2D模型和动作
│       ├── knowledge/     # 角色知识资料
│       ├── TTS/           # 语音合成配置
│       └── character.json # 角色配置
├── embedding-service/      # Python嵌入服务
│   └── main.py
├── live2d-widget/          # 桌宠Live2D渲染组件
├── tts-service/            # Python TTS服务
├── script/                 # 分模块启动脚本
│   ├── start.ps1           # 一键启动脚本
│   └── readme.md          # 启动说明
├── data/                   # 运行时数据
│   ├── database.sqlite    # SQLite数据库
│   ├── user_profile.json  # 用户画像
│   └── logs/              # 日志文件
├── skills/                 # Skill扩展目录
├── start.ps1               # 启动脚本
└── package.json
```

## 配置说明

### API服务商

支持国内模型（通义千问、智谱GLM等），只需修改`.env`中的BaseURL和Model。

### Skill扩展

在 `src/skills/<skill-name>/SKILL.md` 添加内置Skill，在 `skills/<skill-name>/SKILL.md` 添加用户扩展Skill。

## 许可证

MIT
