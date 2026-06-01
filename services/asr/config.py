"""
ASR Service Configuration
"""
import os


class Config:
    """Global configuration singleton"""

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

    # SenseVoice ONNX model
    MODEL_SCOPE_ID = "iic/SenseVoiceSmall"
    MODELS_CACHE_DIR = os.path.join(BASE_DIR, "models")
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
