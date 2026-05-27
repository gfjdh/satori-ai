"""
TTS Service Configuration
"""
import os
import json
from dotenv import load_dotenv


class Config:
    """Global configuration singleton"""

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 预训练模型路径（写死）
    PRETRAINED_MODELS_DIR = os.path.join(BASE_DIR, "pretrained_models")
    BERT_PATH = os.path.join(PRETRAINED_MODELS_DIR, "chinese-roberta-wwm-ext-large")
    HUBERT_PATH = os.path.join(PRETRAINED_MODELS_DIR, "chinese-hubert-base")

    # 动态获取的模型路径（缓存）
    _gpt_model_path = None
    _sovits_model_path = None
    CURRENT_CHARACTER_ID_OVERRIDE = None

    @classmethod
    def get_tts_model_paths(cls):
        """根据当前角色ID动态加载TTS模型路径"""
        if cls._gpt_model_path is not None:
            return cls._gpt_model_path, cls._sovits_model_path

        if cls.CURRENT_CHARACTER_ID_OVERRIDE:
            character_id = cls.CURRENT_CHARACTER_ID_OVERRIDE
        else:
            load_dotenv(os.path.join(cls.PROJECT_DIR, ".env"))
            character_id = os.getenv("CURRENT_CHARACTER_ID")

        if not character_id:
            raise ValueError("No CURRENT_CHARACTER_ID found in env or override")

        tts_dir = os.path.join(cls.PROJECT_DIR, "character-cards", character_id, "TTS")

        # 查找 TTS 配置 JSON（排除 example 目录）
        folder = None
        for fname in os.listdir(tts_dir):
            fpath = os.path.join(tts_dir, fname)
            if fname.endswith(".json") and os.path.isfile(fpath):
                with open(fpath, encoding="utf-8") as f:
                    tts_config = json.load(f)
                folder = tts_config.get("Folder", "")
                if folder:
                    break

        model_dir = os.path.join(tts_dir, folder)

        # 查找 .ckpt 文件 (GPT)
        for f in os.listdir(model_dir):
            if f.endswith(".ckpt"):
                cls._gpt_model_path = os.path.join(model_dir, f)
                break

        # 查找 .pth 文件 (SoVITS)
        for f in os.listdir(model_dir):
            if f.endswith(".pth"):
                cls._sovits_model_path = os.path.join(model_dir, f)
                break

        return cls._gpt_model_path, cls._sovits_model_path

    @property
    def GPT_MODEL_PATH(self):
        return self.get_tts_model_paths()[0]

    @property
    def SOVITS_MODEL_PATH(self):
        return self.get_tts_model_paths()[1]

    @classmethod
    def get_ref_audio_path(cls):
        """获取当前角色的 reference audio 路径"""
        load_dotenv(os.path.join(cls.PROJECT_DIR, ".env"))
        character_id = os.getenv("CURRENT_CHARACTER_ID")
        return os.path.join(
            cls.PROJECT_DIR, "character-cards", character_id,
            "TTS", "example", "normal.wav"
        )

    @classmethod
    def get_emotions_path(cls):
        """获取当前角色的 emotions.json 路径"""
        load_dotenv(os.path.join(cls.PROJECT_DIR, ".env"))
        character_id = os.getenv("CURRENT_CHARACTER_ID")
        return os.path.join(
            cls.PROJECT_DIR, "character-cards", character_id,
            "TTS", "example", "emotions.json"
        )

    @classmethod
    def get_character_card_path(cls):
        """获取当前角色的 character.json 路径"""
        load_dotenv(os.path.join(cls.PROJECT_DIR, ".env"))
        character_id = os.getenv("CURRENT_CHARACTER_ID")
        return os.path.join(
            cls.PROJECT_DIR, "character-cards", character_id,
            "character.json"
        )

    # Service config
    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_PORT = 5030

    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
