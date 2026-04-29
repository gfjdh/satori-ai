---
name: image-analysis
description: 图像分析技能 - 分析图片内容，支持传入图片路径或截取屏幕，帮助桌宠理解图像信息
---

# 图像分析技能

## 功能说明

分析图片内容，支持传入本地图片路径（可多个），如果没有传入图片路径则默认截取电脑屏幕进行分析。使用多模态模型识别图像内容。

## 输入

- `imagePaths`: 图片路径数组（可选，默认为空表示截取屏幕）
- `query`: 用户想要了解的内容（可选）

## 执行脚本

- `analyze.js` - 主脚本，调用Vision LLM分析图像

## 处理流程

1. **接收参数**
   - 如果 `imagePaths` 为空，使用 `captureScreen()` 获取屏幕截图
   - 支持多张图片

2. **图像读取**
   - 读取本地图片文件为 base64
   - 支持格式：PNG、JPG、JPEG、GIF

3. **调用Vision LLM**
   - 将图片和提示词发送给视觉模型
   - 获取图像描述

4. **返回结果**
   - 结构化的图像描述
   - 识别的对象/活动
   - 置信度等信息

## 输出格式

```json
{
  "success": true,
  "description": "图像内容描述",
  "objects": ["对象1", "对象2"],
  "activity": "当前活动",
  "source": "screen|capture|file",
  "timestamp": "ISO时间戳"
}
```

## 隐私保护

- 仅将图片数据发送给配置的Vision LLM服务
- 不上传到第三方服务器
- 分析结果存入日志

## 权限要求

- 读取本地文件权限
- 屏幕截图权限（如果使用默认截屏）

## 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| uuid | ^9.0.1 | 生成唯一ID（已随项目安装） |

**环境变量配置：**
- `SKILL_IMAGE_ANALYSIS_BASE_URL` - Vision LLM 服务地址（可选，优先于 `VISION_LLM_BASE_URL`）
- `SKILL_IMAGE_ANALYSIS_API_KEY` - Vision LLM API密钥（可选，优先于 `VISION_LLM_API_KEY`）
- `SKILL_IMAGE_ANALYSIS_MODEL` - Vision LLM 模型名称（可选，默认为 `gpt-4-vision-preview`）
