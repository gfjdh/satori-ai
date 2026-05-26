---
name: image-analysis
description: 图像分析技能 - 通过Vision LLM分析屏幕截图或图片，支持快速/详细两种模式
triggerWords: [看, 观察, 屏幕, 截图, 识别, 图像, 图片, 显示, 桌面, 窗口]
---

## 请求格式（Skill调用输入）

```json
{
  "vllmMode": "fast",
  "query": "可选的用户问题"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| vllmMode | string | 否 | 分析模式：`"fast"`（快速，几句话简述）、`"detailed"`（详细描述）、`"none"`（不启用VLLM）。默认 `"fast"` |
| query | string | 否 | 用户的具体问题，仅当 vllmMode 不为 "none" 时生效，会覆盖默认提示词传递给Vision LLM |

## 使用要点

- 快速模式("fast")与详细模式("detailed")仅通过提示词区分，快速模式用简短提示词，详细模式用完整描述提示词
- 截图分析耗时约2-5秒
- 不要在同一轮对话中重复调用此技能，除非用户提供了新的图片或指令
