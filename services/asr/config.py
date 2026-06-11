"""
ASR Service Configuration
"""
import os


def _get_cache_dir():
    """Persistent model cache inside HF cache directory (survives pkg rebuilds).
    Consistent with TTS/Embedding which also use ~/.cache/huggingface/ via from_pretrained()."""
    hf_home = os.environ.get("HF_HOME", os.path.join(os.path.expanduser("~"), ".cache", "huggingface"))
    return os.path.join(hf_home, "satori", "asr-models")


class Config:
    """Global configuration singleton"""

    # SenseVoice ONNX model
    MODEL_SCOPE_ID = "iic/SenseVoiceSmall"
    MODELS_CACHE_DIR = _get_cache_dir()
    DEVICE_ID = "-1"   # "-1" = CPU, "0" = GPU 0
    QUANTIZE = True    # INT8 quantization

    # Service config
    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_PORT = 5032

    @classmethod
    def get_model_dir(cls):
        """Local path to downloaded model"""
        return os.path.join(cls.MODELS_CACHE_DIR, cls.MODEL_SCOPE_ID.replace("/", "_"))

    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
