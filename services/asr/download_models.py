"""
Pre-download SenseVoice ONNX model during setup.

Called by asr-setup.bat after pip install.
Keeps the same download logic as api/routes.py:_download_model()
which serves as the runtime fallback on first start.
"""
import sys
import os

# Ensure progress bars are enabled
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "0"

# Add local source + vendored packages to path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)
packages_dir = os.path.join(current_dir, "packages")
if os.path.isdir(packages_dir):
    sys.path.insert(0, packages_dir)

from config import Config
from huggingface_hub import snapshot_download

cfg = Config.get_instance()
target = cfg.get_model_dir()
os.makedirs(target, exist_ok=True)

# 1. Download ONNX model + tokenizer from HuggingFace
HF_REPO = "lovemefan/SenseVoice-onnx"
REQUIRED_FILES = ["sense-voice-encoder.onnx", "am.mvn", "chn_jpn_yue_eng_ko_spectok.bpe.model"]

# Skip if already downloaded (model.onnx is the renamed encoder)
has_encoder = os.path.exists(os.path.join(target, "sense-voice-encoder.onnx"))
has_model_onnx = os.path.exists(os.path.join(target, "model.onnx"))
has_mvn = os.path.exists(os.path.join(target, "am.mvn"))
already_have = (has_encoder or has_model_onnx) and has_mvn

if already_have:
    print(f"[ASR setup] ONNX model already cached, skipping download.")
else:
    print(f"[ASR setup] Downloading ONNX files from {HF_REPO}...")
    # Try in order: user-configured endpoint → hf-mirror.com → official huggingface.co
    endpoints = []
    user_ep = os.environ.get("HF_ENDPOINT")
    if user_ep:
        endpoints.append(("user", user_ep))
    endpoints.append(("mirror", "https://hf-mirror.com"))
    endpoints.append(("official", ""))  # empty = unset, uses default huggingface.co

    for label, ep in endpoints:
        if ep:
            os.environ["HF_ENDPOINT"] = ep
        else:
            os.environ.pop("HF_ENDPOINT", None)
        try:
            snapshot_download(
                HF_REPO,
                local_dir=target,
                allow_patterns=REQUIRED_FILES,
            )
            print(f"[ASR setup] Downloaded via {label} endpoint")
            break
        except Exception as e:
            print(f"[ASR setup] {label} endpoint failed: {e}")
    else:
        raise RuntimeError(f"Failed to download {HF_REPO} from all endpoints")

# Rename encoder -> model.onnx for funasr-onnx compatibility
encoder_path = os.path.join(target, "sense-voice-encoder.onnx")
model_path = os.path.join(target, "model.onnx")
if os.path.exists(encoder_path) and not os.path.exists(model_path):
    os.rename(encoder_path, model_path)
    print(f"[ASR setup] Renamed sense-voice-encoder.onnx -> model.onnx")

# 2. Download config.yaml from ModelScope
config_path = os.path.join(target, "config.yaml")
if not os.path.exists(config_path):
    print(f"[ASR setup] Downloading config.yaml from ModelScope...")
    from modelscope import snapshot_download as ms_download
    ms_download(
        cfg.MODEL_SCOPE_ID,
        cache_dir=cfg.MODELS_CACHE_DIR,
        allow_patterns=["config.yaml"],
    )
    # Find and copy the downloaded config.yaml
    for root, _dirs, files in os.walk(cfg.MODELS_CACHE_DIR):
        if "config.yaml" in files and root != target:
            import shutil
            shutil.copy2(os.path.join(root, "config.yaml"), config_path)
            print(f"[ASR setup] Copied config.yaml from {root}")
            break

print("[ASR setup] SenseVoice model ready.")
