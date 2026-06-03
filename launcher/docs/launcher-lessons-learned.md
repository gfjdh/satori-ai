# Satori AI 启动器 — 踩坑全记录与重构方案

> 本文档记录从零搭建 Windows 端 AI 桌宠启动器的全过程经验，包含所有关键决策、失败原因、架构陷阱。目标是让下一版重构可以站在这些经验的肩膀上，不再重蹈覆辙。

---

## 一、顶层架构：产品形态与打包结构

### 1.1 最终交付物

```
pkg/Satori-AI/
├── Satori-Launcher.exe          ← Go 编译的单文件启动器（内嵌 Vue WebUI）
├── dist/                         ← TypeScript 后端 (esbuild bundle)
│   ├── index.js
│   └── ...
├── node_modules/
│   └── better-sqlite3/           ← 预编译的 C 扩展 .node 二进制
├── webui/                        ← Satori 前端 (Vue3)
│   ├── dist/                     ← Vite 构建产物
│   └── serve.cjs                 ← 零依赖静态文件服务器 (Node.js http 模块)
├── services/                     ← Python 微服务（源码，不含 venv/缓存）
│   ├── tts/        (Flask, 端口 5030)
│   ├── embedding/  (FastAPI+uvicorn, 端口 7860)
│   ├── image/      (FastAPI+uvicorn, 端口 8742)
│   ├── browser/    (Flask+Playwright, 端口 8743)
│   └── asr/        (Flask+SenseVoice ONNX, 端口 5032)
├── live2d-widget/                ← Live2D 桌宠 (PySide6 + QWebEngineView)
├── character-cards/              ← 角色卡目录（分发给用户后放入）
├── wheels/                       ← 预编译的 C 扩展轮子（无预编译 PyPI 包的依赖）
│   ├── pyopenjtalk-0.4.1-cp313-cp313-win_amd64.whl
│   └── jieba_fast-0.53-cp312-cp312-win_amd64.whl
│   └── jieba_fast-0.53-cp313-cp313-win_amd64.whl
├── package.json
└── .env.example
```

### 1.2 打包脚本职责链

```
build.ps1 (根目录)
├── Step 0: 构建 Backend → esbuild src/index.ts → dist/index.js
├── Step 1: 构建 Satori WebUI → Vite → webui/dist/
├── Step 2: 构建 Launcher
│   ├── 2a: Launcher WebUI → Vite → launcher/webui/dist/
│   └── 2b: Go build → Satori-Launcher.exe (内嵌 webui/dist/)
├── Step 3: 组装 pkg/Satori-AI/
│   ├── 复制 Launcher.exe
│   ├── 复制 dist/（清理 .d.ts/.map）
│   ├── 复制 better-sqlite3（清理 .obj/.lib/.pdb/src）
│   ├── 复制 webui/dist/ + serve.cjs
│   ├── 复制 services/（robocopy 排除 venv/__pycache__/pretrained_models/models/.lock/output/gpt_sovits）
│   ├── 复制 live2d-widget/
│   ├── 构建预编译 wheels → wheels/
│   └── 复制 package.json + .env.example
└── Step 4 (可选): Compress-Archive → zip
```

### 1.3 关键教训

**1.3.1 启动器不应该做「万能入口」**

启动器目前同时承担了：运行时环境安装（Node.js/Python/Git 检测和安装）、Python 虚拟环境创建和依赖安装、LLM API 配置管理、服务进程启停管理、Git 项目更新管理。这导致一个 Go 二进制文件变成了整个项目的"上帝对象"，任何一环出问题整个体验崩盘。

> **教训**：启动器职责应收缩为"服务编排 + 环境诊断"。运行时安装应该独立为一次性 setup 脚本（.bat/.ps1），pip 依赖安装应该在 init 脚本中处理，启动器只负责 start/stop/monitor。

**1.3.2 `os.Chdir` 必须在最早时机执行**

Go 代码中的 `init()` 函数将工作目录切换到 exe 所在目录。如果用户从其他目录启动（如双击），`os.Getwd()` 会返回错误的路径，导致所有相对路径的 `runtime/`、`services/`、`data/` 目录查找失败。

> **教训**：`os.Chdir(filepath.Dir(os.Executable()))` 是单文件分发型 Go 应用的必须操作，不能省略。而且必须在 `main()` 之前（即 `init()` 中）执行。

**1.3.3 Go embed 的路径前缀必须精确**

```go
//go:embed webui/dist/*
var webuiDist embed.FS
// 使用时需要 fs.Sub(webuiDist, "webui/dist")
```

如果少了 `fs.Sub` 剥离前缀，HTTP FileServer 会尝试在 `webui/dist/` 路径下查找文件，实际磁盘上不存在这个路径。

---

## 二、后端服务拓扑（端口、Python 版本、依赖矩阵）

### 2.1 服务清单

| 服务 | 端口 | 框架 | Python 版本要求 | 启动命令 | 特殊依赖 |
|------|------|------|----------------|----------|----------|
| TTS | 5030 | Flask | **3.13** | `venv\Scripts\python.exe app.py` | pyopenjtalk==0.4.1 (C扩展), torch, transformers==**4.36.0** |
| Embedding | 7860 | FastAPI+uvicorn | 3.12~3.13 | `venv\Scripts\python.exe -m uvicorn main:app` | torch>=2.0, transformers>=4.30 |
| Image | 8742 | FastAPI+uvicorn | 3.12~3.13 | `venv\Scripts\python.exe -m uvicorn app:app` | mss>=9.0 (截图库) |
| Browser | 8743 | Flask | 3.12~3.13 | `venv\Scripts\python.exe server.py` | playwright>=1.48 (需 install 浏览器) |
| ASR | 5032 | Flask | **3.12** | `venv\Scripts\python.exe app.py` | funasr-onnx>=0.3, modelscope (C扩展 jieba-fast) |
| WebUI | 5173 | Node.js serve.cjs | 无 | `node serve.cjs` | 零依赖静态服务器 |
| Backend | 3682 | Node.js | 无 | `node dist/index.js` | better-sqlite3 (C扩展 .node) |
| Live2D | 无端口 | Pythonw + PySide6 | **系统 Python** | `pythonw.exe live2d-launcher.py` | PySide6, PySide6-WebEngine |

### 2.2 Python 版本分裂：3.12 vs 3.13

这是整个项目最关键的依赖约束：

- **TTS 服务** 需要 Python **3.13**（GPT-SoVITS 的某些依赖对 3.12 有兼容问题）
- **ASR 服务** 需要 Python **3.12**（funasr-onnx 的 C 扩展在 3.13 上有兼容问题）
- 其他服务（Embedding/Image/Browser）两个版本都兼容

> **教训**：启动器必须同时提供 Python 3.12 和 3.13 两个嵌入式运行时。`InitEnvironment` 中需要根据每个服务的 `MinPythonMinor`/`MaxPythonMinor` 选择正确的 Python 版本。当前 `FindBestPython` 函数实现了这个逻辑，但 `setupEmbeddedPython` 在两个版本上都需要正确运行。

### 2.3 嵌入式 Python 的特殊限制

Python 官方嵌入式发行版（embed-amd64.zip）的设计初衷是作为应用程序的内嵌脚本引擎，因此：

- **不包含 pip**（需要手动通过 get-pip.py 安装）
- **不包含 venv 模块**（需要额外安装 virtualenv）
- **`._pth` 文件中 `import site` 默认被注释**（需要手动取消注释以启用 site-packages）
- **不包含 tkinter、IDLE 等 GUI 相关模块**

> **教训**：`setupEmbeddedPython` 必须依次执行：① 编辑 `._pth` 取消注释 `import site` → ② 下载 get-pip.py → ③ 运行 get-pip.py 安装 pip → ④ `pip install virtualenv`。**每一步都可能因网络问题失败，必须有重试机制和明确的完成标记。**

---

## 三、C 扩展 Wheels 问题（重中之重）

### 3.1 问题本质

pip 安装分为两种：
- **纯 Python 包**：下载 wheel → 直接安装（秒级）
- **含 C 扩展的包**：如果 PyPI 有预编译 wheel → 直接安装；如果没有 → 需要在本地用 C 编译器构建（需要 Visual Studio Build Tools + 数分钟）

痛点在于：**pyopenjtalk** 和 **jieba-fast** 在 PyPI 上没有 Windows 预编译 wheel。用户端 pip install 会触发本地编译，要求用户安装 VS Build Tools（数 GB），这对终端用户不可接受。

### 3.2 解决方案：预编译 Wheel 策略

在 CI/开发者环境中预先编译好 wheel 文件，放入 `wheels/` 目录。pip install 时通过 `--find-links wheels/` 参数指向该目录，pip 会优先使用本地 wheel：

```
pip install -r requirements.txt --find-links wheels/
```

### 3.3 关键约束

| 关键点 | 说明 |
|--------|------|
| Wheel 是 Python 版本绑定的 | cp312 的 wheel 不能在 cp313 上用，反之亦然 |
| Wheel 是平台绑定的 | win_amd64 的 wheel 不能在 Linux/Mac 上用 |
| 编译环境必须一致 | 用 Python 3.13 的 venv 编译，产出 cp313 的 wheel |
| TTS 用 3.13 | 需要 pyopenjtalk cp313 + jieba-fast cp313 |
| ASR 用 3.12 | 需要 jieba-fast cp312 |

### 3.4 当前 build.ps1 的 Wheel 构建逻辑

```powershell
# 用 TTS venv (Python 3.13) 构建 cp313 wheel
& $ttsVenv -m pip wheel pyopenjtalk==0.4.1 jieba-fast==0.53 -w $wheelsDir --no-deps

# 用 ASR venv (Python 3.12) 构建 cp312 wheel
& $asrVenv -m pip wheel jieba-fast==0.53 -w $wheelsDir --no-deps
```

> **教训**：这要求开发者的机器上已经正确配置了 TTS 和 ASR 的 venv（含正确的 Python 版本）。如果 venv 不存在，wheel 构建会跳过。**在新机器上首次构建前，必须先手动创建这些 venv 并安装依赖。** 这是 CI/开发环境依赖的隐性前提，必须在文档中明确记录。

---

## 四、启动器（Launcher）架构与历史遗留问题

### 4.1 技术栈

- **后端**：Go 1.24，标准库 HTTP Server（`http.ServeMux` 方法路由）
- **前端**：Vue 3 + Vue Router (Hash Mode) + Vite
- **进程管理**：Windows Job Objects (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`)
- **跨平台 Windows API**：`golang.org/x/sys/windows`

### 4.2 三次迭代的架构变更

#### v1：进程内下载 + SSE 进度推送

启动器直接从 python.org/nodejs.org 下载运行时压缩包，SSE 推送下载进度。

**失败原因**：Go 的 HTTP Client 在大文件下载时挂起；进度读取器在高并发下死锁；`Content-Length` 不可靠导致进度条永远不到 100%。

> **教训**：不要在 Go 进程内做 GB 级的文件下载。让用户用浏览器/下载工具自行下载，启动器只做本地安装。

#### v2：直链下载 + 本地安装 + PowerShell 文件对话框

用户从启动器 UI 点击下载链接（浏览器下载），然后在「环境」页面通过文件对话框选择 zip 文件，上传后本地安装。

**失败原因**：
1. PowerShell `System.Windows.Forms.OpenFileDialog` 需要 Windows message pump + STA 线程模型，PowerShell 不提供 message pump → 对话框创建但永不显示 → HTTP 请求永久挂起
2. `HideWindow: true` + `CREATE_NO_WINDOW` 可能影响子窗口的显示能力
3. 路由守卫每次导航调用 `/api/env`（触发 5-10 个子进程的磁盘/注册表探测），每次页面切换等待 1-3 秒

> **教训**：
> - 不要在服务端代码中调用需要 GUI 线程模型的 Windows 组件。文件选择应使用 HTML `<input type="file">`。
> - 路由守卫中不应有异步 I/O 操作。环境检测应缓存或预取。

#### v3：HTML File Input 上传 + 无阻塞路由

用隐藏 `<input type="file" accept=".zip">` + FormData upload 到 `/api/upload/temp`。完全移除路由守卫中的 env check。

**仍存在的问题**：`IsRuntimeReady` 仅检查目录是否非空 → `setupEmbeddedPython` 失败后无法重试 → 用户到 Setup 页面初始化时 `No module named virtualenv`。

> **教训**：Python 运行时的就绪检查必须包含 `virtualenv` 安装验证。`InstallRuntime` 必须有"已解压但 setup 失败"的恢复路径（不需要重新提供 zip 文件）。

### 4.3 Go 代码已知陷阱

**4.3.1 `context.WithTimeout` 的 cancel 必须调用**

```go
cmd, cancel := NewHiddenCommandTimeout(5*time.Minute, "git", "fetch", "gitee")
defer cancel()  // ← 必须！否则 goroutine 泄漏
```

有 3+ 处使用了 `NewHiddenCommandTimeout` 但没有调用 `cancel()`。

**4.3.2 `handleShutdown` 的竞态**

原代码在 goroutine 中调用 `os.Exit(0)`，HTTP 响应可能尚未发送完毕就终止进程。修复：改为同步执行 → Flush → Exit。

**4.3.3 路由守卫中 async fetch 的竞态**

Vue Router 的 `beforeEach` 如果是 async，多次快速导航的 fetch 会互相竞争，可能造成路由卡死。方案：要么缓存结果（不发起新请求），要么直接移除守卫。

**4.3.4 `os.FindProcess` 在 Windows 上的行为**

Windows 的 `os.FindProcess(pid)` 总是成功（不验证 PID 是否存在）。需要用 `tasklist /FI "PID eq xxx"` 验证。

**4.3.5 Windows Job Object 的初始化失败是静默的**

```go
func init() {
    h, err := windows.CreateJobObject(nil, nil)
    if err != nil {
        return  // ← 静默失败！后续 assignToJob 也静默失败
    }
}
```

如果 `CreateJobObject` 失败（权限不足等），整个子进程生命周期管理失效，关闭启动器会残留子进程。

---

## 五、前端 WebUI 架构与已知问题

### 5.1 路由结构

| 路径 | 页面 | 功能 |
|------|------|------|
| `/` | Dashboard | 运行环境概览、服务状态、版本信息、日志流 |
| `/setup` | Setup | 4 步初始化向导（环境→初始化→配置API→启动） |
| `/env` | Environment | 运行时安装管理（下载链接+本地文件选择+安装） |
| `/services` | Services | 服务启停管理（表格+单服务操作+日志流） |
| `/update` | Update | Git 仓库初始化 + 版本更新 + 依赖更新 |
| `/guide` | Guide | 安装指南 + 常见问题 |

### 5.2 已发现的 Vue 问题

**5.2.1 EventSource 连接泄漏**

Dashboard 和 Services 页面都在 `onMounted` 创建 EventSource 连接到 `/api/logs/stream`，如果 `onUnmounted` 未正确清理（快速切换页面时可能发生），会堆积大量 SSE 连接。

**5.2.2 定时器未清理**

Dashboard 每 5 秒、Services 每 3 秒轮询刷新。如果 `clearInterval` 未执行，后台会持续发送 HTTP 请求。

**5.2.3 `v-for` key 的稳定性**

Environment.vue 中系统 Python 列表使用 `py.path` 作为 key，如果路径相同但内容不同，Vue 不会重新渲染。

### 5.3 API 封装函数

```js
apiGet(path)        → GET  /api/{path}
apiPost(path, body) → POST /api/{path} (JSON body)
apiSSE(path, cb)    → GET  /api/{path} (EventSource 流)
apiSSEPost(path, body, cb) → POST /api/{path} (ReadableStream SSE 解析)
```

`apiSSEPost` 手动解析 SSE 流（因为 EventSource 不支持 POST），实现较为脆弱——依赖 `\n\n` 分割和 `data: ` 前缀。

---

## 六、配置与环境变量

### 6.1 .env 文件结构

```
# LLM API
LLM_API_KEY=xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4
LLM_TEMPERATURE=0.7

# Vision LLM
VISION_LLM_API_KEY=xxx
VISION_LLM_BASE_URL=https://api.openai.com/v1
VISION_LLM_MODEL=gpt-4-vision-preview
VISION_LLM_TEMPERATURE=0.7

# Server
PORT=3682

# Browser
BROWSER_HEADLESS=false

# Character
CURRENT_CHARACTER_ID=satori

# TTS / ASR
TTS_SERVICE_HOST=127.0.0.1
TTS_SERVICE_PORT=5030
ASR_SERVICE_HOST=127.0.0.1
ASR_SERVICE_PORT=5032
```

### 6.2 配置写入逻辑

位于 `api/config.go` 的 `handleConfigPost`：解析现有 .env 行 → 合并 LLM 相关 key → 保留其他行 → 追加未出现的 LLM key → 写回文件。**不会覆盖用户手动添加的非 LLM 配置。**

---

## 七、Go HTTP API 路由完整清单

| 方法+路径 | 功能 | 关键实现 |
|-----------|------|----------|
| `GET /api/env` | 检测 Node/Python/Git 环境 | `svc.DetectAll()` — 重！5-10 个子进程探测 |
| `GET /api/env/guide/{tool}` | 安装指南 | 静态文本 |
| `GET /api/runtime/status` | 查询运行时安装状态 | `IsRuntimeReady()` 每 key 检查 |
| `GET /api/runtime/info` | 运行时资产列表 | 名称+下载URL |
| `POST /api/runtime/install/{name}` | 安装运行时 | SSE 进度流 |
| `POST /api/upload/temp` | 上传 zip 到临时目录 | multipart form, 500MB 限制 |
| `POST /api/init` | 初始化项目环境 | SSE 进度流，按服务创建 venv+pip install |
| `GET /api/services` | 服务列表+状态 | 8 个服务定义 |
| `POST /api/services/start` | 全部启动 | 按 StartOrder 排序 |
| `POST /api/services/stop` | 全部停止 | taskkill + port cleanup |
| `POST /api/services/{name}/start` | 单服务启动 | killPortOccupant → start → assignToJob |
| `POST /api/services/{name}/stop` | 单服务停止 | killProcess (taskkill /F /T) |
| `GET /api/logs/stream` | SSE 日志流 | broadcast 模式，所有客户端收到相同日志 |
| `GET /api/project/status` | Git 仓库状态 | git branch + git remote |
| `POST /api/project/init` | Git 初始化 | git init + git remote add |
| `POST /api/update/check` | 检查更新 | git fetch + git rev-list |
| `POST /api/update/apply` | 应用更新 | git pull |
| `GET /api/config` | 读取 LLM 配置 | 解析 .env 文件 |
| `POST /api/config` | 保存 LLM 配置 | 合并写入 .env |
| `POST /api/update/deps/{name}` | 更新依赖 | npm install / pip install -r |
| `POST /api/shutdown` | 关闭启动器 | StopAll → os.Exit |

---

## 八、重构建议（基于所有踩坑经验）

### 8.1 启动器职责重定义

```
❌ 当前：万能入口（安装运行时 + 创建 venv + 装 pip 包 + 配置 LLM + 管理服务 + Git 更新）
✅ 建议：服务编排器（start/stop/monitor/log）+ 环境诊断（检测并报告缺失项）

一次性初始化交给 install.ps1 / setup.bat 脚本
依赖更新交给各服务的独立脚本
```

### 8.2 文件选择方案

**唯一正确的方案是 HTML `<input type="file">`**。不要尝试 PowerShell、VBS、ActiveX、COM 互操作。上传到临时目录后本地安装，虽然对大文件有上传开销，但是在 localhost 上速度极快（~100MB/s+）。

### 8.3 Python 环境初始化

**推荐方案**：
1. 在打包阶段预编译所有 C 扩展 wheel 放入 `wheels/`
2. 使用嵌入式 Python（embed zip），不要依赖系统 Python
3. `setupEmbeddedPython` 必须幂等——检查 virtualenv 是否存在，不存在就安装
4. 用 sentinel 文件标记 setup 完成状态（如 `.setup_done`），避免 `IsRuntimeReady` 仅靠目录非空判断

### 8.4 前端性能

1. **路由守卫不应有网络请求**。环境状态在 App mount 时预取一次即可
2. **SSE 连接应全局共享**，不要每个页面创建独立连接
3. **定时器应在 `onUnmounted` 中可靠清理**，可使用 `onBeforeUnmount` 作为双重保险

### 8.5 Go 代码规范

1. 所有 `exec.Command` 必须带 timeout（`context.WithTimeout`）
2. 所有 `context.WithTimeout` 返回的 cancel 必须 defer
3. Windows API 调用的错误不能静默吞掉——至少 log
4. `handleShutdown` 必须同步执行（先 Flush 响应，再 StopAll，最后 Exit）
5. PID 文件必须验证陈旧性（tasklist 检查 PID 是否仍存活）

### 8.6 最少可用交付物（MVP 重构目标）

```
pkg/Satori-AI/
├── Satori-Launcher.exe       ← Go 服务编排器（仅 start/stop/monitor/log）
├── install.ps1                ← 一次性初始化脚本（Python 运行时 + venv + pip install）
├── dist/                      ← Backend
├── webui/                     ← 前端
├── services/                  ← Python 微服务（含 requirements.txt）
├── wheels/                    ← 预编译 C 扩展
├── runtime/                   ← 嵌入式 Python 运行时（由 install.ps1 安装）
├── live2d-widget/
└── data/                      ← 运行时数据目录
```

---

## 九、文件清单与职责速查

| 文件 | 职责 | 备注 |
|------|------|------|
| `build.ps1` | 全项目构建+打包 | 4 步流水线，产出 pkg/Satori-AI/ |
| `launcher/build.ps1` | 启动器独立构建 | Go + Vite |
| `launcher/main.go` | 启动器入口 | init() 切换目录，Job Object，PID 文件 |
| `launcher/svc/cmd.go` | Windows 进程封装 | Job Object, HiddenCommand, killPortOccupant, CleanupOrphanPorts |
| `launcher/svc/detector.go` | 环境检测 | DetectAll, FindBestPython, 注册表/PATH/通用路径三层探测 |
| `launcher/svc/downloader.go` | 运行时安装 | InstallRuntime, extractZip, setupEmbeddedPython, IsRuntimeReady |
| `launcher/svc/manager.go` | 服务编排 | Start/Stop/StartAll/StopAll, InitEnvironment, UpdateDeps |
| `launcher/api/server.go` | HTTP 路由注册 | 25 个路由，CORS，SSE writer |
| `launcher/api/download.go` | 运行时 API | Runtime status/info/install + file upload |
| `launcher/api/env.go` | 环境 API | DetectAll 调用，安装指南 |
| `launcher/api/config.go` | 配置 API | LLM 配置读写，.env 合并，Shutdown |
| `launcher/api/update.go` | 更新 API | Git 操作（init/fetch/pull/rev-list），依赖更新 |
| `launcher/api/services.go` | 服务 API | 服务列表/启停，SSE 日志广播 |
| `launcher/api/init.go` | 初始化 API | 项目环境初始化 SSE 流 |
| `launcher/webui/src/main.js` | Vue 路由 | Hash mode，6 个路由 |
| `launcher/webui/src/views/*.vue` | 6 个页面组件 | Dashboard/Setup/Environment/Services/Update/Guide |
| `launcher/webui/src/components/*.vue` | 可复用组件 | GuideBlock, LogViewer, ProgressBar, InstallRow |
| `launcher/webui/src/api.js` | API 客户端 | GET/POST/SSE/SSEPost 封装 |
| `script/start.ps1` | 服务管理脚本 | PowerShell Jobs + TCP 端口检测 + 交互菜单 |
| `script/readme.md` | 脚本说明 | 所有 setup/start 脚本的使用文档 |
