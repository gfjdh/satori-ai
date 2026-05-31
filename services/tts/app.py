"""
Flask application entry - Standalone TTS Service
"""
import logging
import sys
import os
import threading
from flask import Flask

from api.routes import api_bp

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def warmup():
    """后台预热：加载模型并执行一次合成（不阻塞服务启动）"""
    import time
    import json

    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)

    from config import Config
    from api.routes import get_synthesizer

    cfg = Config.get_instance()

    # 1. 加载合成器
    logger.info("[Warmup] Loading synthesizer...")
    t0 = time.time()
    synthesizer = get_synthesizer()
    logger.info(f"[Warmup] Synthesizer loaded in {time.time() - t0:.1f}s")

    # 2. 获取参考音频路径
    ref_audio_path = cfg.get_ref_audio_path()
    logger.info(f"[Warmup] Ref audio: {ref_audio_path}")

    # 3. 读取角色卡配置
    with open(cfg.get_character_card_path(), encoding="utf-8") as f:
        character_card = json.load(f)
    raw_lang = character_card["speechLanguage"]
    speech_language = raw_lang.split("-")[0]

    with open(cfg.get_emotions_path(), encoding="utf-8") as f:
        emotions = json.load(f)
    normal_text = emotions["normal"]

    # 4. 执行一次合成预热
    logger.info(f"[Warmup] Running synthesis warmup: lang={speech_language}, text={normal_text[:30]}")
    t0 = time.time()
    _, _, duration = synthesizer.synthesize(
        ref_wav_path=ref_audio_path,
        prompt_text=normal_text,
        prompt_language=speech_language,
        text=normal_text,
        text_language=speech_language
    )
    logger.info(f"[Warmup] Synthesis warmup completed in {time.time() - t0:.1f}s, generated {duration:.2f}s audio")


def create_app():
    app = Flask(__name__)
    app.register_blueprint(api_bp, url_prefix='/api')
    return app


if __name__ == '__main__':
    app = create_app()
    # Start warmup in background thread so the server binds immediately
    threading.Thread(target=warmup, daemon=True).start()
    app.run(host='127.0.0.1', port=5030, debug=False)
