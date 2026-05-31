"""
API routes - Standalone TTS Service
"""
import io
import logging
import os
import base64
import soundfile as sf
from flask import Blueprint, request, jsonify, Response

logger = logging.getLogger(__name__)
api_bp = Blueprint('api', __name__)

_synthesizer = None


def get_project_root():
    """获取 satori-ai 项目根目录（从 services/tts/api/ 往上三层）"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(os.path.dirname(os.path.dirname(current_dir)))


def get_synthesizer():
    """Lazy load standalone synthesizer"""
    global _synthesizer
    if _synthesizer is None:
        # Import config BEFORE synthesizer to avoid sys.path shadowing
        import sys
        import os
        current_dir = os.path.dirname(os.path.abspath(__file__))
        parent_dir = os.path.dirname(current_dir)
        if parent_dir not in sys.path:
            sys.path.insert(0, parent_dir)

        from config import Config
        from synthesizer import GPTSovitsSynthesizer

        cfg = Config.get_instance()
        _synthesizer = GPTSovitsSynthesizer(
            gpt_path=cfg.GPT_MODEL_PATH,
            sovits_path=cfg.SOVITS_MODEL_PATH,
            bert_path=cfg.BERT_PATH,
            hubert_path=cfg.HUBERT_PATH,
            device="cpu"
        )
        logger.info("Standalone synthesizer initialized")
    return _synthesizer


@api_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'tts-service',
        'mode': 'standalone'
    })


@api_bp.route('/switch_model', methods=['POST'])
def switch_model():
    """重新加载TTS模型（当前端切换角色时调用）"""
    global _synthesizer
    try:
        body = request.get_json() or {}
        character_id = body.get('character_id')
        
        from config import Config
        # 清理原有的类属性缓存
        Config._gpt_model_path = None
        Config._sovits_model_path = None
        
        # 强制设置加载某个指定角色
        if character_id:
            Config.CURRENT_CHARACTER_ID_OVERRIDE = character_id
            
        cfg = Config.get_instance()
        _synthesizer = None # 清空之前的合成器以释放内存/旧模型
        
        # 预加载新的合成器
        get_synthesizer()
        
        return jsonify({
            'success': True,
            'message': f'Model switched to {character_id}' if character_id else 'Model reloaded'
        })
    except Exception as e:
        logger.error(f"switch_model error: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@api_bp.route('/synthesize', methods=['POST'])
def synthesize():
    try:
        body = request.get_json()
        if not body:
            return jsonify({'success': False, 'error': 'Request body is required'}), 400

        ref_audio_path = body.get('ref_audio_path')
        text = body.get('text')
        prompt_text = body.get('prompt_text', '')
        ref_language = body.get('ref_language', 'ja')
        text_language = body.get('text_language', 'ja')

        if not ref_audio_path:
            return jsonify({'success': False, 'error': 'ref_audio_path is required'}), 400
        if not text:
            return jsonify({'success': False, 'error': 'text is required'}), 400

        # Resolve relative path
        if not os.path.isabs(ref_audio_path):
            abs_path = os.path.join(get_project_root(), ref_audio_path)
            if os.path.exists(abs_path):
                ref_audio_path = abs_path

        audio, sr, duration = get_synthesizer().synthesize(
            ref_wav_path=ref_audio_path,
            prompt_text=prompt_text,
            prompt_language=ref_language,
            text=text,
            text_language=text_language
        )

        # Encode as base64
        buffer = io.BytesIO()
        sf.write(buffer, audio, sr, format='WAV')
        buffer.seek(0)
        audio_bytes = buffer.read()
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')

        return jsonify({
            'success': True,
            'audio_base64': audio_b64,
            'sample_rate': sr,
            'duration': duration
        })

    except Exception as e:
        logger.error(f"synthesize error: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@api_bp.route('/synthesize_stream', methods=['POST'])
def synthesize_stream():
    try:
        body = request.get_json()
        if not body:
            return jsonify({'success': False, 'error': 'Request body is required'}), 400

        ref_audio_path = body.get('ref_audio_path')
        text = body.get('text')
        prompt_text = body.get('prompt_text', '')
        ref_language = body.get('ref_language', 'ja')
        text_language = body.get('text_language', 'ja')

        if not ref_audio_path:
            return jsonify({'success': False, 'error': 'ref_audio_path is required'}), 400
        if not text:
            return jsonify({'success': False, 'error': 'text is required'}), 400

        # Resolve relative path
        if not os.path.isabs(ref_audio_path):
            abs_path = os.path.join(get_project_root(), ref_audio_path)
            if os.path.exists(abs_path):
                ref_audio_path = abs_path

        audio, sr, duration = get_synthesizer().synthesize(
            ref_wav_path=ref_audio_path,
            prompt_text=prompt_text,
            prompt_language=ref_language,
            text=text,
            text_language=text_language
        )

        buffer = io.BytesIO()
        sf.write(buffer, audio, sr, format='WAV')
        buffer.seek(0)
        audio_bytes = buffer.read()
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')

        return jsonify({
            'success': True,
            'audio': audio_b64,
            'sample_rate': sr,
            'duration': duration
        })

    except Exception as e:
        logger.error(f"synthesize_stream error: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
