---
name: image-analysis
description: 图像分析技能 - 屏幕截图识别与分析，支持OCR文本提取和物体检测，可选视觉语言模型增强
triggerWords: [看, 观察, 屏幕, 截图, 识别, 图像, 图片, 显示, 桌面, 窗口]
---

## 请求格式（Skill调用输入）

```json
{
  "useVLLM": false,
  "preciseOCR": false,
  "query": "可选的用户问题"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| useVLLM | boolean | 否 | 是否使用视觉语言模型增强分析，默认false（快速模式，仅OCR+YOLO26n） |
| preciseOCR | boolean | 否 | OCR精确识别模式，默认false（快速：~1s/66条文本），true时用高精度参数（~4s/188条），主动调用时应当尽可能使用高精度模式 |
| query | string | 否 | 用户的具体问题，仅当 useVLLM=true 时生效，传递给Vision LLM |

## 使用要点

- **LLM主动调用**：当需要深入视觉理解时设置 useVLLM=true，会调用Vision LLM生成详细描述
- 截图分析为耗时操作（OCR+YOLO约1-2秒，VLLM额外2-5秒）
- 不要在同一轮对话中重复调用此技能，除非用户提供了新的图片或指令
