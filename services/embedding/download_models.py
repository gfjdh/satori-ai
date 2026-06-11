"""
Pre-download bert-base-chinese model from HuggingFace during setup.

Called by embedding-setup.bat after pip install.
The runtime lifespan handler in main.py serves as the fallback
if the model wasn't pre-downloaded.
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

from transformers import BertTokenizer, BertModel

print("[Embedding setup] Downloading bert-base-chinese...")
BertTokenizer.from_pretrained("bert-base-chinese")
BertModel.from_pretrained("bert-base-chinese")
print("[Embedding setup] Model ready.")
