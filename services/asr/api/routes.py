"""
API routes - Standalone ASR Service (SenseVoice ONNX)
"""
import io
import logging
import os
import re
import sys
import wave
import numpy as np
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)
api_bp = Blueprint('api', __name__)

_model = None

# HuggingFace repo with pre-exported ONNX files
_HF_REPO = "lovemefan/SenseVoice-onnx"

# SenseVoice special token sets for parsing output
_LANG_TAGS = frozenset({
    "zh", "en", "ja", "ko", "yue", "zh/en", "en/zh",
    "de", "es", "ru", "fr", "pt", "tr", "pl", "ca", "nl", "ar",
    "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms",
    "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg",
    "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn",
    "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy",
    "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si",
    "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd",
    "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn",
    "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw",
    "ln", "ha", "ba", "jw", "su",
})
_EMO_TAGS = frozenset({
    "HAPPY", "SAD", "ANGRY", "NEUTRAL", "FEARFUL", "DISGUSTED",
    "SURPRISED", "OTHER", "EMO_UNKNOWN",
})


def _download_model():
    """Download ONNX model from HuggingFace and config from ModelScope"""
    from huggingface_hub import snapshot_download
    from config import Config

    cfg = Config.get_instance()
    target = cfg.get_model_dir()
    os.makedirs(target, exist_ok=True)

    # 1. Download ONNX model + am.mvn from HuggingFace
    missing_hf = [f for f in ["sense-voice-encoder.onnx", "am.mvn"]
                  if not os.path.exists(os.path.join(target, f))]
    if missing_hf:
        logger.info("Downloading ONNX files from HuggingFace: %s", _HF_REPO)
        snapshot_download(
            _HF_REPO,
            local_dir=target,
            allow_patterns=["sense-voice-encoder.onnx", "am.mvn",
                            "chn_jpn_yue_eng_ko_spectok.bpe.model"],
            local_dir_use_symlinks=False,
        )

    # Rename encoder → model.onnx if needed
    encoder_path = os.path.join(target, "sense-voice-encoder.onnx")
    model_path = os.path.join(target, "model.onnx")
    if os.path.exists(encoder_path) and not os.path.exists(model_path):
        os.rename(encoder_path, model_path)
        logger.info("Renamed %s → model.onnx", encoder_path)

    # 2. Download config.yaml from ModelScope if missing
    config_path = os.path.join(target, "config.yaml")
    if not os.path.exists(config_path):
        logger.info("Downloading config.yaml from ModelScope...")
        from modelscope import snapshot_download as ms_download
        ms_download(
            cfg.MODEL_SCOPE_ID,
            cache_dir=cfg.MODELS_CACHE_DIR,
            allow_patterns=["config.yaml"],
        )
        # Find the downloaded config.yaml
        for root, dirs, files in os.walk(cfg.MODELS_CACHE_DIR):
            if "config.yaml" in files and root != target:
                import shutil
                src = os.path.join(root, "config.yaml")
                shutil.copy2(src, config_path)
                logger.info("Copied config.yaml from %s", src)
                break

    return target


def get_model():
    """Lazy load SenseVoiceSmall ONNX model"""
    global _model
    if _model is None:
        from funasr_onnx import SenseVoiceSmall
        from config import Config

        cfg = Config.get_instance()
        model_dir = _download_model()

        logger.info(
            "Loading SenseVoice ONNX: %s (device=%s)",
            model_dir, cfg.DEVICE_ID
        )
        base = SenseVoiceSmall(
            model_dir=model_dir,
            batch_size=1,
            device_id=cfg.DEVICE_ID,
            quantize=False,
        )

        # Wrap in a class that delegates frontend/tokenizer to SenseVoiceSmall
        # but performs inference directly on the 2-input HF ONNX model.
        # The HF ONNX model (lovemefan/SenseVoice-onnx) has only:
        #   inputs:  speech (float), speech_lengths (int64)
        #   outputs: encoder_out (float) — CTC logits [1, T, 25055]
        # funasr-onnx expects 4 inputs + 2 outputs, which is incompatible.
        class AsrModel:
            def __init__(self, engine):
                self._e = engine

            def transcribe(self, audio_np, language="auto", textnorm="withitn"):
                lang_list, tn_list = self._e.read_tags(
                    [language] if isinstance(language, str) else language,
                    [textnorm] if isinstance(textnorm, str) else textnorm,
                )
                waveform_list = self._e.load_data(
                    audio_np, self._e.frontend.opts.frame_opts.samp_freq
                )
                asr_res = []
                for beg_idx in range(0, len(waveform_list), self._e.batch_size):
                    end_idx = min(len(waveform_list), beg_idx + self._e.batch_size)
                    feats, feats_len = self._e.extract_feat(waveform_list[beg_idx:end_idx])
                    outputs = self._e.ort_infer([feats, feats_len.astype(np.int64)])
                    ctc_logits = outputs[0]
                    for b in range(feats.shape[0]):
                        x = ctc_logits[b, :, :]
                        yseq = x.argmax(axis=-1)
                        mask = np.concatenate([[True], yseq[1:] != yseq[:-1]])
                        yseq = yseq[mask]
                        mask = yseq != self._e.blank_id
                        token_int = yseq[mask].tolist()
                        asr_res.append(self._e.tokenizer.decode(token_int))
                return asr_res

        _model = AsrModel(base)
        logger.info("SenseVoice ONNX model ready")
    return _model


@api_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'asr-service'
    })


@api_bp.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transcribe audio to text using SenseVoice ONNX.
    Accepts raw WAV bytes in request body.
    Returns { success, text, emotion, language }
    """
    try:
        audio_data = request.get_data()
        if not audio_data:
            return jsonify({'success': False, 'error': 'Audio data is required'}), 400

        # Decode WAV to numpy array (16-bit PCM, mono)
        audio_buffer = io.BytesIO(audio_data)
        try:
            with wave.open(audio_buffer, 'rb') as wf:
                n_channels = wf.get_nchannels()
                n_frames = wf.get_nframes()
                pcm_data = wf.readframes(n_frames)
                audio_np = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
                if n_channels > 1:
                    audio_np = audio_np.reshape(-1, n_channels).mean(axis=1)
        except Exception:
            audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0

        # Run inference
        model = get_model()
        results = model.transcribe(audio_np)

        # Parse result — SenseVoice outputs:
        # "<|zh|><|NEUTRAL|><|Speech|>transcribed text here"
        if results and len(results) > 0 and results[0]:
            raw = results[0]

            emotion = 'neutral'
            language = 'auto'

            for tag in re.findall(r'<\|([^|]+)\|>', raw):
                if tag in _LANG_TAGS:
                    language = tag
                elif tag in _EMO_TAGS:
                    emotion = tag.lower()

            text = re.sub(r'<\|[^|]+\|>', '', raw).strip()

            logger.info("ASR result: text='%s', emotion=%s, lang=%s", text, emotion, language)

            return jsonify({
                'success': True,
                'text': text,
                'emotion': emotion,
                'language': language
            })
        else:
            return jsonify({'success': False, 'error': 'No speech detected'}), 422

    except Exception as e:
        logger.error("Transcribe error: %s", e, exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500
