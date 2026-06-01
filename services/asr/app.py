"""
Flask application entry - Standalone ASR Service (SenseVoice ONNX)
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
    """后台预热：加载模型并执行一次空推理（不阻塞服务启动）"""
    import time
    import numpy as np

    from api.routes import get_model

    logger.info("[Warmup] Loading SenseVoice ONNX model...")
    t0 = time.time()
    model = get_model()
    logger.info("[Warmup] Model loaded in %.1fs", time.time() - t0)

    sample_rate = 16000
    duration = 0.5
    t_arr = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    audio = (np.sin(2 * np.pi * 440 * t_arr) * 0.1).astype(np.float32)

    logger.info("[Warmup] Running warmup inference...")
    t0 = time.time()
    model.transcribe(audio)
    logger.info("[Warmup] Warmup inference completed in %.2fs", time.time() - t0)


def create_app():
    app = Flask(__name__)
    app.register_blueprint(api_bp, url_prefix='/api')
    return app


if __name__ == '__main__':
    app = create_app()
    threading.Thread(target=warmup, daemon=True).start()
    app.run(host='127.0.0.1', port=5032, debug=False)
