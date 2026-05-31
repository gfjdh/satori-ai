---
name: python-exec
description: 执行 Python 脚本，用于数据处理、计算、文件操作等编程任务
triggerWords: [计算, 运行脚本, 执行脚本, python, 帮我写个脚本, 写个python]
---

# Python 脚本执行

## 能力
- 执行任意 Python 3 代码
- 可使用环境中已安装的 pip 包
- 超时默认 30 秒

## 限制
- 不要在脚本中进行耗时过长的操作（超时会强制终止）
- 如需安装新包，可在脚本中使用 `subprocess.check_call([sys.executable, "-m", "pip", "install", "包名"])`

---

## execute_python

**用途**：执行一段 Python 脚本，返回标准输出、标准错误和退出码。

**何时调用**：
- 用户要求进行计算、数据处理或文件操作
- 用户让 AI 编写并运行 Python 代码
- 需要进行复杂逻辑处理，纯文字难以完成

**参数**：
- `script`（必填）：要执行的 Python 代码
- `timeout`（可选）：超时秒数，默认 30

**返回格式**：`{ "stdout": "...", "stderr": "...", "exitCode": 0 }`
