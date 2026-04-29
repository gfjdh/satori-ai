# TTS Service

GPT-SoVITS 独立语音合成服务（standalone 模式）。

## 快速开始

### 1. 环境配置
```
双击 01_setup_env.bat
```

### 2. 启动服务
```
双击 02_start_service.bat
```

### 3. 测试
```bash
curl http://localhost:5000/api/health
```

## API 接口

### Health Check
```
GET http://localhost:5000/api/health
```

### 合成 (JSON)
```
POST http://localhost:5000/api/synthesize
{
    "ref_audio_path": "character-cards/satori/TTS/example/normal.wav",
    "prompt_text": "こんにちは",
    "text": "こんにちは、元気ですか？",
    "ref_language": "ja",
    "text_language": "ja"
}
```

### 合成 (流式 WAV)
```
POST http://localhost:5000/api/synthesize_stream
{同上}
```

## 架构

```
┌─────────────────────────────┐
│  TTS Service (端口 5000)    │
│  Flask + Standalone         │
│  直接调用 PyTorch 推理       │
└─────────────────────────────┘
```

## 依赖

- Python 3.9+ (使用 venv)
- torch, transformers, librosa, soundfile
- GPT-SoVITS 模型文件（整合包路径）

## 注意事项

1. 首次启动会下载 open_jtalk 词典（约 22MB）
2. 推理在 CPU 上进行，需要几分钟预热
3. 路径支持相对路径
