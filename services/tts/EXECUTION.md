# TTS Service 执行逻辑说明

## 概述

TTS Service 是一个基于 GPT-SoVITS 的独立语音合成服务，支持 standalone 模式直接调用 PyTorch 推理，无需依赖外部 API。

## 目录结构

```
tts-service/
├── 01_setup_env.bat        # 环境配置脚本
├── 02_start_service.bat     # 服务启动脚本
├── app.py                   # Flask 应用入口
├── synthesizer.py            # Standalone 推理引擎
├── config.py                 # 配置管理
├── api/
│   └── routes.py             # API 路由
├── gpt_sovits/               # 本地修复的 AR 模块
│   └── AR/
│       ├── models/           # GPT 模型
│       └── modules/          # AR 模块
└── venv/                     # Python 虚拟环境
```

## 执行流程

### 1. 环境配置 (01_setup_env.bat)

```
检查/创建虚拟环境 → 安装依赖 → 完成
```

**依赖包**：
- `flask` - Web 框架
- `torch` - PyTorch 推理引擎
- `transformers>=4.45.0` - BERT/HuBERT 模型（4.36.0 依赖的 tokenizers<0.19 已从 PyPI 下架，升级到 >=4.45.0 解决）
- `librosa` - 音频处理
- `soundfile` - 音频文件读写
- `scipy` - 科学计算
- `pytorch-lightning` - Lightning 框架
- `einops` - 张量操作
- `matplotlib` - 绘图（AR 模块需要）
- `cn2an`, `pyopenjtalk`, `pypinyin`, `jieba-fast` - 中文/日文文本处理
- `g2p_en`, `wordsegment` - 英文/日文文本处理

### 2. 服务启动 (02_start_service.bat)

```
启动 Flask 服务 → 监听 0.0.0.0:5000
```

### 3. 模型加载 (synthesizer.py)

**首次调用时懒加载**：

```
1. 加载 BERT 模型 (chinese-roberta-wwm-ext-large)
   └── 用于文本特征提取

2. 加载 HuBERT 模型 (chinese-hubert-base)
   └── 用于参考音频 SSL 特征提取

3. 加载 SoVITS 模型
   └── VITS 解码器，将语义特征转为音频

4. 加载 GPT 模型 (Text2SemanticLightningModule)
   └── T2S 编码器，将文本转为语义特征
```

### 4. 语音合成流程 (synthesize)

```
参考音频 → 重采样 16kHz → HuBERT SSL → ssl_content
                                            ↓
文本 → BERT → text_bert    → GPT T2S → 语义ID → SoVITS → 音频
                                              ↓
                    参考音频频谱 ─────────────────┘
```

**详细步骤**：

```
Step 1: SSL 特征提取
  - 参考音频重采样至 16kHz
  - 通过 HuBERT 获取 SSL 特征
  - 通过 VQ 模型提取潜在语义代码

Step 2: 文本处理
  - 文本 → 音素序列（clean_text）
  - 音素 → BERT 特征

Step 3: GPT 推理
  - 拼接 prompt 和目标文本的音素+BERT
  - 自回归生成语义 ID 序列

Step 4: VITS 解码
  - 语义 ID → Mel Spectrogram
  - Mel → 波形音频 (32kHz)
```

## API 接口

### Health Check
```
GET /api/health
Response: {"status": "healthy", "service": "tts-service", "mode": "standalone"}
```

### 合成 (JSON)
```
POST /api/synthesize
{
    "ref_audio_path": "character-cards/satori/TTS/example/normal.wav",
    "prompt_text": "こんにちは",
    "text": "こんにちは、元気ですか？",
    "ref_language": "ja",
    "text_language": "ja"
}
Response: {"success": true, "audio_base64": "...", "sample_rate": 32000, "duration": 7.92}
```

### 合成 (流式)
```
POST /api/synthesize_stream
{同上}
Response: WAV audio bytes
```

## 路径解析

服务支持相对路径，基于 `d:\dev\cyber-wife\satori-ai`：

```
character-cards/satori/TTS/example/normal.wav
→ d:\dev\cyber-wife\satori-ai\character-cards\satori\TTS\example\normal.wav
```

```

## 关键问题与解决方案

### 1. transformers 版本兼容性

**问题**：`transformers==4.36.0` 依赖 `tokenizers>=0.14,<0.19`，但这些版本已被 PyPI 下架（仅剩 0.20.2+），导致 pip install 永久失败。

**解决**：升级到 `transformers>=4.45.0`，接受 `tokenizers>=0.21`。TTS 代码使用的 API（`AutoModelForMaskedLM`, `AutoTokenizer`, `HubertModel`, `Wav2Vec2FeatureExtractor`）在所有 transformers 4.x 版本中保持稳定。

### 2. Python 版本

**问题**：整合包使用 Python 3.9，本地环境使用 Python 3.13。

**解决**：本地 venv 使用 Python 3.13，通过升级 transformers 到 >=4.45.0 并配合 weight_norm 兼容性 hack 解决。

### 3. HParams 类

**问题**：GPT 模型 checkpoint 中包含 `utils.HParams` 类，旧版 Python 包中不存在。

**解决**：在 `gpt_sovits/AR/models/utils.py` 中添加了 `HParams` 类定义。
