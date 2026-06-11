"""
Pre-download BERT and HuBERT models from HuggingFace during setup.

Called by tts-setup.bat after pip install.
Models are cached to ~/.cache/huggingface/ by the transformers library.
Subsequent loads are instant.
"""
import sys
import os

# Use HF mirror for faster download in China (https://hf-mirror.com)
# User can override: set HF_ENDPOINT env var before running setup
if not os.environ.get("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
# Ensure progress bars are enabled
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "0"

# Add vendored packages to path (populated by pip install --target)
current_dir = os.path.dirname(os.path.abspath(__file__))
packages_dir = os.path.join(current_dir, "packages")
if os.path.isdir(packages_dir):
    sys.path.insert(0, packages_dir)

# Force old weight_norm API for HuBERT checkpoint compatibility.
# TencentGameMate/chinese-hubert-base was saved with old format (weight_g/weight_v).
# PyTorch 2.2+ parametrizations.weight_norm creates params with different keys
# (parametrizations.weight.original0/original1), causing weight mismatch on load.
# transformers 4.36.0 modeling_hubert.py auto-selects new API if available.
# We hide it so transformers falls back to nn.utils.weight_norm (old format).
import torch.nn as nn
_saved_param_wn = getattr(nn.utils.parametrizations, "weight_norm", None)
if _saved_param_wn is not None:
    del nn.utils.parametrizations.weight_norm

from transformers import (
    AutoTokenizer,
    AutoModelForMaskedLM,
    HubertModel,
    Wav2Vec2FeatureExtractor,
)

BERT_ID = "hfl/chinese-roberta-wwm-ext-large"
HUBERT_ID = "TencentGameMate/chinese-hubert-base"


def download_bert():
    print(f"[TTS setup] Downloading BERT: {BERT_ID}")
    AutoTokenizer.from_pretrained(BERT_ID)
    AutoModelForMaskedLM.from_pretrained(BERT_ID)
    print(f"[TTS setup] BERT model ready.")


def download_hubert():
    print(f"[TTS setup] Downloading HuBERT: {HUBERT_ID}")
    HubertModel.from_pretrained(HUBERT_ID)
    Wav2Vec2FeatureExtractor.from_pretrained(HUBERT_ID)
    print(f"[TTS setup] HuBERT model ready.")


if __name__ == "__main__":
    download_bert()
    download_hubert()
    print("[TTS setup] All models downloaded successfully.")
