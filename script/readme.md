# Satori AI - 服务脚本

```
script/
├── 00_setup_all.bat      # 初始化所有环境（首次运行）
├── start.ps1             # PowerShell 菜单（灵活启动/停止）
├── backend/              # Node.js 后端（端口 3000）
│   ├── 01_setup_env.bat
│   └── 02_start_service.bat
├── webui/                # Vue3 前端（端口 5173）
│   ├── 01_setup_env.bat
│   └── 02_start_service.bat
├── tts/                  # TTS 包装器（使用 tts-service/）
│   ├── 01_setup_env.bat  # 在 tts-service/venv 中创建虚拟环境
│   └── 02_start_service.bat
├── embedding/            # Embedding 包装器（使用 embedding-service/）
│   ├── 01_setup_env.bat  # 在 embedding-service/venv 中创建虚拟环境
│   └── 02_start_service.bat
└── live2d/               # Live2D 启动器（使用系统 Python）
    ├── 01_setup_env.bat  # 检查系统 PySide6
    └── 02_start_service.bat
```

## 服务位置

| 服务 | 代码位置 | 环境 |
|---------|--------------|-------------|
| 后端 | 项目根目录 | npm (node_modules) |
| WebUI | webui/ | npm (webui/node_modules) |
| TTS | tts-service/ | tts-service/venv |
| Embedding | embedding-service/ | embedding-service/venv |
| Live2D | live2d-widget/ | **系统 Python** (PySide6) |

## 使用方法

```batch
:: 首次运行：初始化所有环境
.\script\00_setup_all.bat

:: 启动所有服务（使用 PowerShell 菜单）
.\script\start.ps1
```

## 单独服务初始化

```batch
:: 单独初始化服务（需在 script/ 子目录下运行）
.\script\backend\01_setup_env.bat    :: 后端依赖 + 构建
.\script\webui\01_setup_env.bat      :: WebUI 依赖
.\script\tts\01_setup_env.bat        :: 在 tts-service/ 中创建 TTS 虚拟环境
.\script\embedding\01_setup_env.bat  :: 在 embedding-service/ 中创建 Embedding 虚拟环境
.\script\live2d\01_setup_env.bat     :: 检查系统 PySide6
```

## Live2D 注意事项

Live2D 使用**系统 Python**（基础环境）并需安装 PySide6。请确保 PySide6 可用：
```batch
python -c "from PySide6.QtWidgets import QApplication; print('OK')"
```
如果未安装，请执行：`pip install PySide6 PySide6-Addons`
```