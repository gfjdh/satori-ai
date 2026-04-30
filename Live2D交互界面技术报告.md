# Live2D 交互界面技术报告

> 项目路径：`d:\dev\cyber-wife\my-neuro`
> 生成日期：2026-04-30
> 负责人：my-neuro 开发团队

---

## 一、架构总览

Live2D 桌宠系统基于 **Electron** + **PIXI.js** + **pixi-live2d-display** 构建，运行于全屏透明 BrowserWindow（`type: 'desktop'`），实现"永远置顶、鼠标穿透"的桌面宠物效果。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Main Process                          │
│  main.js — 创建透明置顶窗口 / HTTP API / IPC / 全局快捷键         │
└─────────────────────────────────────────────────────────────────┘
                               │
                          index.html
                               │
       ┌────────────────────────┼────────────────────────┐
   Live2D Libs              app.js (renderer)        CSS
   (live2d.min.js)      ┌─────────────────────┐   styles.css
   (live2dcubismcore)  │   AppInitializer     │
   (pixi.min.js)       │  (10阶段初始化流程)  │
   (pixi-live2d-       │                     │
    display.min.js)    │  ┌───────────────┐  │
                       │  │ ModelSetup    │  │  UIController
                       │  │ (PIXI+模型加载)│  │  (字幕/气泡/
                       │  └───────────────┘  │   聊天框)
                       │  ┌───────────────┐  │
                       │  │ModelInteraction│ │
                       │  │ Controller    │  │
                       │  └───────────────┘  │
                       │  ┌───────────────┐  │
                       │  │EmotionMotion  │  │
                       │  │ Mapper        │  │
                       │  └───────────────┘  │
                       └─────────────────────┘
```

---

## 二、渲染层

### 2.1 透明窗口创建

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\main.js`

```javascript
// main.js 第22-72行
const win = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    transparent: true,       // 核心：透明背景
    frame: false,             // 无边框
    alwaysOnTop: true,       // 始终置顶
    backgroundColor: '#00000000',
    hasShadow: false,
    type: 'desktop',          // desktop 类型实现鼠标穿透
    skipTaskbar: true,
    webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
    }
});
win.setIgnoreMouseEvents(true, { forward: true }); // 穿透鼠标事件
```

> **关键点：** `type: 'desktop'` 使窗口成为桌面背景层级，`setIgnoreMouseEvents` 配合 `forward: true` 将鼠标事件透传给下层应用。

---

### 2.2 PIXI 应用初始化

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\model\model-setup.js`

```javascript
// model-setup.js 第7-66行（核心片段）
const app = new PIXI.Application({
    view: document.getElementById("canvas"),
    autoStart: true,
    transparent: true,
    width: window.innerWidth * 2,
    height: window.innerHeight * 2
});
app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

// 加载 Live2D 模型
const model = await PIXI.live2d.Live2DModel.from("2D/肥牛/hiyori_pro_mic.model3.json");
app.stage.addChild(model);
```

---

### 2.3 依赖库链路

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\index.html`

```html
<!-- index.html 第46-51行 -->
<script src="libs/live2d.min.js"></script>
<script src="libs/live2dcubismcore.min.js"></script>
<script src="libs/pixi.min.js"></script>
<script src="libs/pixi-live2d-display.min.js"></script>
<script src="libs/pixi-live2d-display-extra.min.js"></script>
```

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\package.json`

```json
"dependencies": {
    "pixi-live2d-display": "^0.3.1",
    "pixi.js": "^6.5.2"
}
```

依赖链路：
```
live2d.min.js           → Cubism Core SDK（底层渲染内核）
live2dcubismcore.min.js → Cubism Core 绑定
pixi.min.js             → WebGL 2D 渲染引擎
pixi-live2d-display.min.js → Live2D × PIXI 官方绑定
pixi-live2d-display-extra.min.js → 扩展功能（拖拽等）
```

---

## 三、交互系统

### 3.1 鼠标穿透与命中检测

透明窗口默认穿透鼠标事件，模型区域通过 `setIgnoreMouseEvents(false)` 临时"抓住"鼠标实现交互。

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\main.js`

```javascript
// main.js 第48行
win.setIgnoreMouseEvents(true, { forward: true });
```

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\model\model-interaction.js`

```javascript
// model-interaction.js 第88-98行（鼠标捕获）
model.on('mousedown', (e) => {
    if (this.model.containsPoint(e.data.global)) {
        this.isDragging = true;
        this.dragOffset.x = e.data.global.x - this.model.x;
        this.dragOffset.y = e.data.global.y - this.model.y;
        ipcRenderer.send('set-ignore-mouse-events', { ignore: false });
    }
});

// model-interaction.js 第199-206行（鼠标释放恢复穿透）
model.on('mouseout', () => {
    if (!this.isDragging) {
        ipcRenderer.send('set-ignore-mouse-events', {
            ignore: true, options: { forward: true }
        });
    }
});
```

---

### 3.2 自定义命中区域

覆盖 `containsPoint` 方法，在模型中心 1/3 宽、70% 高范围内响应交互，排除边缘透明区域。

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\model\model-interaction.js`

```javascript
// model-interaction.js 第29-36行（计算命中区域）
updateInteractionArea() {
    if (!this.model) return;
    this.interactionWidth = this.model.width / 3;
    this.interactionHeight = this.model.height * 0.7;
    this.interactionX = this.model.x + (this.model.width - this.interactionWidth) / 2;
    this.interactionY = this.model.y + (this.model.height - this.interactionHeight) / 2;
}

// model-interaction.js 第44-85行（自定义命中检测）
const originalContainsPoint = this.model.containsPoint;
this.model.containsPoint = (point) => {
    const isOverModel = (
        point.x >= this.interactionX &&
        point.x <= this.interactionX + this.interactionWidth &&
        point.y >= this.interactionY &&
        point.y <= this.interactionY + this.interactionHeight
    );
    // ... 聊天框命中检测 ...
    return isOverModel || isOverChat;
};
```

---

### 3.3 拖拽移动

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\model\model-interaction.js`

```javascript
// model-interaction.js 第102-109行
this.model.on('mousemove', (e) => {
    if (this.isDragging) {
        const newX = e.data.global.x - this.dragOffset.x;
        const newY = e.data.global.y - this.dragOffset.y;
        this.model.position.set(newX, newY);
        this.updateInteractionArea();
    }
});

// model-interaction.js 第113-127行（拖拽结束，保存位置）
window.addEventListener('mouseup', () => {
    if (this.isDragging) {
        this.isDragging = false;
        this.saveModelPosition();
        setTimeout(() => {
            if (!this.model.containsPoint(...)) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true, options: { forward: true }
                });
            }
        }, 100);
    }
});

// model-interaction.js 第328-351行（位置持久化）
saveModelPosition() {
    const relativeX = this.model.x / window.innerWidth;
    const relativeY = this.model.y / window.innerHeight;
    ipcRenderer.send('save-model-position', { x: relativeX, y: relativeY });
}
```

---

### 3.4 滚轮缩放

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\model\model-interaction.js`

```javascript
// model-interaction.js 第218-242行
window.addEventListener('wheel', (e) => {
    if (this.model.containsPoint(this.app.renderer.plugins.interaction.mouse.global)) {
        e.preventDefault();
        const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = this.model.scale.x * scaleChange;
        const minScale = this.model.scale.x * 0.3;
        const maxScale = this.model.scale.x * 3.0;
        if (newScale >= minScale && newScale <= maxScale) {
            this.model.scale.set(newScale);
            // ... 调整位置保持中心点 ...
            this.updateInteractionArea();
        }
    }
}, { passive: false });
```

---

### 3.5 点击触发动作

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\model\model-interaction.js`

```javascript
// model-interaction.js 第209-215行
this.model.on('click', () => {
    if (this.model.containsPoint(...) && this.model.internalModel) {
        this.model.motion("Tap");     // 播放 Tap 动作组
        this.model.expression();       // 随机表情
    }
});
```

---

## 四、情绪动作映射系统

### 4.1 EmotionMotionMapper

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\ui\emotion-motion-mapper.js`

核心职责：将 AI 返回的 `<开心>`、`<生气>`、`<难过>`、`<惊讶>`、`<害羞>`、`<俏皮>` 等情绪标签映射为 `.motion3.json` 动作文件，在 TTS 播报过程中按文本位置触发对应动画。

**情绪解析流程：**

```javascript
// 第246-261行 — 提取文本中的情绪标签及位置
parseEmotionTagsWithPosition(text) {
    const pattern = /<([^>]+)>/g;
    const emotions = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
        emotions.push({
            emotion: match[1],
            startIndex: match.index,
            endIndex: match.index + match[0].length,
            fullTag: match[0]
        });
    }
    return emotions;
}

// 第263-302行 — 预处理文本，移除标签，生成情绪标记
prepareTextForTTS(text) {
    const emotionTags = this.parseEmotionTagsWithPosition(text);
    // 移除标签，生成 purifiedText + emotionMarkers[]
    return { text: purifiedText, emotionMarkers };
}

// 第304-325行 — TTS 播报过程中按文本进度触发动作
triggerEmotionByTextPosition(position, textLength, emotionMarkers) {
    for (let i = emotionMarkers.length - 1; i >= 0; i--) {
        const marker = emotionMarkers[i];
        if (position >= marker.position && position <= marker.position + 2) {
            this.playConfiguredEmotion(marker.emotion);
            emotionMarkers.splice(i, 1);
            break;
        }
    }
    // 文本结束时强制触发剩余标记
    if (position >= textLength - 1 && emotionMarkers.length > 0) {
        for (const marker of emotionMarkers) {
            this.playConfiguredEmotion(marker.emotion);
        }
    }
}

// 第338-362行 — 播放配置的情绪动作
playConfiguredEmotion(emotion) {
    const motionFiles = this.emotionConfig[emotion];
    const selectedFile = motionFiles[Math.floor(Math.random() * motionFiles.length)];
    const motionIndex = this.findMotionIndexByFileName(selectedFile);
    if (motionIndex !== -1) this.playMotion(motionIndex);
}

// 第381-407行 — 执行 PIXI Live2D 动作播放
playMotion(index) {
    this.model.motion(this.currentMotionGroup, motionIndex);
}
```

---

### 4.2 情绪配置文件

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\emotion_actions.json`

```json
{
  "肥牛": {
    "emotion_actions": {
      "开心": [
        "motions/Hiyori_m02.motion3.json",
        "motions/Hiyori_m05.motion3.json",
        "motions/Hiyori_m06.motion3.json",
        "motions/Hiyori_m08.motion3.json"
      ],
      "生气": ["motions/Hiyori_m09.motion3.json"],
      "难过": ["motions/Hiyori_m10.motion3.json"],
      "惊讶": ["motions/Hiyori_m07.motion3.json"],
      "害羞": ["motions/Hiyori_m04.motion3.json"],
      "俏皮": ["motions/Hiyori_m03.motion3.json"],
      "动作1": ["motions/Hiyori_m01.motion3.json"],
      "动作11": ["motions/micoff.motion3.json"],
      "动作12": ["motions/micon.motion3.json"],
      "动作13": ["motions/singing.motion3.json"]
    }
  }
}
```

---

## 五、模型自动切换

### 5.1 ModelPathUpdater

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\model\model-path-updater.js`

启动时扫描 `2D/` 下所有 `.model3.json`，按 `priorityFolders = ['肥牛', 'Hiyouri', 'Default', 'Main']` 优先级选择模型，并回写 `model-setup.js` 中的路径字符串。

```javascript
// model-path-updater.js 第20-49行（update 方法）
update() {
    const modelFiles = this._scanModelFiles();      // 递归扫描 .model3.json
    const selectedModelFile = this._selectPriorityModel(modelFiles);
    this._updateAppJs(selectedModelFile);           // 替换 model-setup.js 里的路径
}

// model-path-updater.js 第56-78行（递归扫描）
_scanModelFiles() {
    const scanForModels = (dir, basePath = '') => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                scanForModels(fullPath, relativePath);
            } else if (item.endsWith('.model3.json')) {
                modelFiles.push(path.join('2D', relativePath).replace(/\\/g, '/'));
            }
        }
    };
}

// model-path-updater.js 第85-100行（优先级选择）
_selectPriorityModel(modelFiles) {
    for (const priority of this.priorityFolders) {
        const found = modelFiles.find(file => file.includes(`2D/${priority}/`));
        if (found) return found;
    }
    modelFiles.sort();
    return modelFiles[0];
}

// model-path-updater.js 第106-124行（回写路径）
_updateAppJs(modelPath) {
    let jsContent = fs.readFileSync(this.modelSetupJsPath, 'utf8');
    const pattern = /const model = await PIXI\.live2d\.Live2DModel\.from\("([^"]*)"\);/;
    const replacement = `const model = await PIXI.live2d.Live2DModel.from("${modelPath}");`;
    jsContent = jsContent.replace(pattern, replacement);
    fs.writeFileSync(this.modelSetupJsPath, jsContent, 'utf8');
}
```

---

### 5.2 IPC 动态切换

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\main.js`

```javascript
// main.js 第233-286行
ipcMain.handle('switch-live2d-model', async (event, modelName) => {
    const index = priorityFolders.indexOf(modelName);
    if (index > 0) {
        priorityFolders.splice(index, 1);
        priorityFolders.unshift(modelName);
    } else if (index === -1) {
        priorityFolders.unshift(modelName);
    }
    // 保存 priorityFolders 到 main.js 文件自身
    const mainJsPath = path.join(app.getAppPath(), 'main.js');
    let mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
    mainJsContent = mainJsContent.replace(
        /const priorityFolders = \[.*?\];/,
        `const priorityFolders = ['${priorityFolders.join("', '")}'];`
    );
    fs.writeFileSync(mainJsPath, mainJsContent, 'utf8');
    const modelPathUpdater = new ModelPathUpdater(app.getAppPath(), priorityFolders);
    modelPathUpdater.update();
    BrowserWindow.fromWebContents(event.sender).reload();
    return { success: true };
});
```

---

## 六、模型数据格式

### 6.1 Cubism 3 模型文件

角色"肥牛"位于 `d:\dev\cyber-wife\my-neuro\live-2d\2D\肥牛\`：

| 文件名 | 用途 |
|--------|------|
| `hiyori_pro_mic.moc3` | 模型二进制数据（Cubism 3 核心格式） |
| `hiyori_pro_mic.model3.json` | 模型主配置（纹理/物理/姿势/动作引用/HitArea） |
| `hiyori_pro_mic.pose3.json` | 身体姿态定义 |
| `hiyori_pro_mic.physics3.json` | 物理模拟参数（重力/风等） |
| `hiyori_pro_mic.cdi3.json` | Display Info 配置 |
| `hiyori_pro_mic.userdata3.json` | 用户数据 |
| `hiyori_pro_mic.2048/texture_00.png` | 纹理图集 0 |
| `hiyori_pro_mic.2048/texture_01.png` | 纹理图集 1 |
| `motions/*.motion3.json` | 共 13 个动画文件 |

---

### 6.2 motion3.json 嘴巴曲线剔除

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\AI_set_live2d.py`

自动扫描所有 `.motion3.json`，删除 `Curves` 中 `Id` 包含 "mouth" 的条目，并同步更新 `Meta.CurveCount`，避免 TTS 驱动嘴型时与 Live2D 自动口型产生冲突。

```python
# AI_set_live2d.py 第87-129行
def process_single_motion_file(motion_file_path):
    with open(motion_file_path, 'r', encoding='utf-8') as f:
        motion_data = json.load(f)

    original_count = len(motion_data["Curves"])
    filtered_curves = []

    for curve in motion_data["Curves"]:
        if "Id" in curve and "mouth" in curve["Id"].lower():
            continue  # 跳过 mouth 相关曲线
        filtered_curves.append(curve)

    if filtered_curves != motion_data["Curves"]:
        motion_data["Curves"] = filtered_curves
        motion_data["Meta"]["CurveCount"] = len(filtered_curves)
        with open(motion_file_path, 'w', encoding='utf-8') as f:
            json.dump(motion_data, f, ensure_ascii=False, indent=2)
```

同时，该脚本批量重构 `.model3.json` 的 Motions 结构，添加 `Idle` 和 `TapBody` 动作组，并将所有 motion 文件按序号映射为"动作1"~"动作N"写入 `emotion_actions.json`。

---

## 七、插件系统接口

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\core\plugin-context.js`

插件通过 `this.context` 访问核心能力，实现安全隔离。

```javascript
// plugin-context.js 第156-161行 — 情绪触发
triggerEmotion(emotion) {
    if (global.currentModel && global.currentModel.triggerEmotion) {
        global.currentModel.triggerEmotion(emotion);
    }
}
```

**插件可用 API 全览：**

| API | 说明 |
|-----|------|
| `getMessages()` | 获取当前对话历史 |
| `addSystemPromptPatch(id, text)` | 注入系统提示词片段 |
| `callLLM(prompt, options)` | 插件独立调用 LLM（不进入对话） |
| `showSubtitle(text, duration)` | 显示字幕 |
| `triggerEmotion(emotion)` | 触发 Live2D 情绪动作 |
| `sendMessage(text)` | 让 AI 主动说话（走完整 TTS） |
| `getConfig()` | 获取全局 config.json |
| `getPluginFileConfig()` | 获取插件自身 plugin_config.json |
| `registerTool(toolDef)` | 动态注册工具 |
| `getPlugin(name)` | 获取其他插件实例 |
| `on/emit/off` | 事件总线 |

---

## 八、初始化流程

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\js\app-initializer.js`

10 阶段顺序初始化：

| 阶段 | 模块 | 关键操作 |
|:---:|------|---------|
| 0 | 插件系统 | `PluginManager.loadAll()` — 扫描并加载所有插件 |
| 1 | MCP | `MCPManager.initialize()` — 初始化 Model Context Protocol |
| 2 | UI | `UIController.initialize()` — 字幕/气泡/聊天框初始化 |
| 3 | 语音 | `VoiceChatFacade` — 创建语音聊天接口 |
| 4 | TTS | `TTSFactory.create()` — 创建 TTS 处理器 |
| **5** | **Live2D** | **`ModelSetup.initialize()`** — PIXI 应用 + 模型加载 |
| 6 | System Prompt | `enhanceSystemPrompt()` — 增强 AI 系统提示词 |
| 7 | 工具管理 | `LocalToolManager` — 加载 Function Call 工具 |
| 8 | 弹幕/直播 | `BarrageManager` — 弹幕接收与 TTS 播报 |
| 9 | 聊天界面/IPC | `IPCHandlers.registerAll()` — 注册所有 IPC 通信 |

---

## 九、配置文件

**文件路径：** `d:\dev\cyber-wife\my-neuro\live-2d\config.json`

```json
{
  "ui": {
    "intro_text": "你好啊",
    "model_scale": 2.3,
    "show_model": true,
    "model_position": {
      "x": 1.3173444652557373,
      "y": 0.7958061406587621,
      "remember_position": true
    }
  }
}
```

---

## 十、关键设计总结

| 设计点 | 实现方式 | 涉及文件 |
|--------|---------|---------|
| 透明穿透窗口 | `BrowserWindow type: 'desktop'` + `setIgnoreMouseEvents(true, {forward: true})` | `main.js` |
| 鼠标捕获/释放 | `setIgnoreMouseEvents(false/true)` + IPC 消息传递 | `main.js`、`model-interaction.js` |
| 情绪驱动动画 | `<情绪>` 标签 → EmotionMotionMapper → `model.motion(TapBody, idx)` | `emotion-motion-mapper.js` |
| 嘴型冲突规避 | 自动删除 `.motion3.json` 中 Id 含 "mouth" 的 Curves | `AI_set_live2d.py` |
| 多角色抽象 | 从模型路径提取角色名，加载对应 `emotion_actions.json` | `emotion-motion-mapper.js`、`model-path-updater.js` |
| 位置记忆 | 相对比例（0-1）存储，跨分辨率自适应 | `model-interaction.js`、`config.json` |
| 插件情绪触发 | `global.currentModel.triggerEmotion()` via `plugin-context.js` | `plugin-context.js`、`model-setup.js` |
