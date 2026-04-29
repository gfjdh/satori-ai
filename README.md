# Satori AI - AI桌宠

基于多模态Agent的智能桌面宠物，具备独立的情感和记忆系统。

## 功能特性

### 已完成

#### 核心后端 (Node.js + TypeScript)
- **数据库层** (`src/db/database.ts`) - SQLite 实现，支持对话、记忆、任务、状态、资料库、日志等表
- **Agent 系统**
  - `src/agent/analyzer.ts` - 分析Agent，多模态模型接入，上下文管理，工具调用决策
  - `src/agent/polisher.ts` - 润色Agent，生成带动作表情的回复
- **LLM API 层** (`src/api/llm.ts`) - 支持自定义BaseURL和Model
- **状态管理器** (`src/state/manager.ts`) - 多维好感度和情绪状态管理
- **记忆管理器** (`src/memory/manager.ts`) - 分级存储（年/季/月/周/日/话题），智能召回
- **角色系统**
  - `src/character/loader.ts` - 角色卡加载
  - `src/character/knowledge.ts` - 知识库管理
- **TTS 客户端** (`src/tts/client.ts`) - 语音合成接口
- **Skill 引擎** (`src/skills/engine.ts`) - Markdown格式Skill执行
  - 内置 `skills/search` - 记忆检索Skill
  - 内置 `skills/image-analysis` - 屏幕分析Skill（当前不可用）

#### WebUI (Vue3 + TypeScript)
- `/` - 欢迎页
- `/chat` - 对话测试页面
- `/status` - 状态面板（日志、心跳状态、Token计数）
- `/memories` - 数据库管理（长期记忆查看）

#### TTS 服务 (Python)
- GPT-SoVITS 语音合成
- 参考音频克隆
- RESTful API 接口

#### 角色卡
- `character-cards/satori` - 默认角色
- `character-cards/fake-neuro` - 示例角色
- 包含 Live2D 模型文件和动作

#### 启动脚本
- `start.ps1` - 一键启动，支持指定角色和运行模式

### 待完成

| 模块 | 功能 | 优先级 |
|------|------|--------|
| **桌宠界面** | 无边框悬浮窗口，Live2D渲染 | 高 |
| **WebUI** | 角色卡管理、资料库、插件管理、任务管理页面 | 高 |
| **心跳任务** | 定时任务检查、环境感知、主动交互、状态回归 | 中 |
| **好感度/情绪系统** | 状态更新Prompt完整实现 | 中 |
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
- 后端API: http://localhost:3000
- WebUI: http://localhost:5173

### 开发模式

```bash
# 后端热重载
npm run dev

# WebUI热重载
cd webui && npm run dev
```

### WebUI 功能

1. **状态面板** (`/status`) - 查看系统运行状态、日志、Token使用量
2. **数据库管理** (`/memories`) - 查看和管理记忆数据
3. **对话测试** (`/chat`) - 输入消息测试AI对话

### 更换角色

```powershell
.\start.ps1 -character fake-neuro
```

## 项目结构

```
satori-ai/
├── src/                    # TypeScript后端源码
│   ├── agent/             # Agent模块
│   ├── api/               # LLM API封装
│   ├── character/         # 角色卡加载
│   ├── db/                # 数据库
│   ├── memory/            # 记忆管理
│   ├── skills/            # Skill定义
│   ├── state/             # 状态管理
│   ├── tts/               # TTS客户端
│   ├── user/              # 用户画像
│   └── index.ts           # 入口
├── webui/                  # Vue3前端
│   └── src/views/          # 页面组件
├── character-cards/        # 角色卡
│   ├── satori/
│   └── fake-neuro/
├── tts-service/            # Python TTS服务
├── data/                   # 运行时数据
├── skills/                 # Skill扩展目录
├── start.ps1               # 启动脚本
└── package.json
```

## 配置说明

### API服务商

支持国内模型（通义千问、智谱GLM等），只需修改`.env`中的BaseURL和Model。

### Skill扩展

在 `skills/<skill-name>/SKILL.md` 添加Markdown格式指令即可扩展功能。

## 许可证

MIT
