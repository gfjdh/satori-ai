"""
GPT-SoVITS 独立推理引擎
使用本地虚拟环境和修复后的模块
"""
import os
import sys

# 自动配置CPU多线程（使用核心数的一半，提升性能且避免过度竞争）
CPU_COUNT = os.cpu_count() or 8
CPU_THREADS = max(1, CPU_COUNT // 2)
import torch
torch.set_num_threads(CPU_THREADS)
torch.set_num_interop_threads(CPU_THREADS)
print(f"[GPTSovitsSynthesizer] CPU threads: intra={CPU_THREADS}, inter={CPU_THREADS}")

# 添加本项目的模块路径
current_dir = os.path.dirname(os.path.abspath(__file__))
LOCAL_GPT_SOVITS = os.path.join(current_dir, "gpt_sovits")
LOCAL_AR = os.path.join(LOCAL_GPT_SOVITS, "AR")

# 添加 gpt_sovits 根目录
if LOCAL_GPT_SOVITS not in sys.path:
    sys.path.insert(0, LOCAL_GPT_SOVITS)

# 添加本地 AR 模块
if LOCAL_AR not in sys.path:
    sys.path.insert(0, LOCAL_AR)
    sys.path.insert(0, os.path.join(LOCAL_AR, "modules"))
    sys.path.insert(0, os.path.join(LOCAL_AR, "models"))

import torch
import numpy as np
import librosa
import soundfile as sf
from transformers import AutoModelForMaskedLM, AutoTokenizer

from gpt_sovits.feature_extractor.cnhubert import CNHubert, get_model as cnhubert_get_model
from gpt_sovits.module.models import SynthesizerTrn
from gpt_sovits.AR.models.t2s_lightning_module import Text2SemanticLightningModule
from gpt_sovits.text import cleaned_text_to_sequence
from gpt_sovits.text.cleaner import clean_text
from gpt_sovits.module.mel_processing import spectrogram_torch
from gpt_sovits.tools.my_utils import load_audio


class DictToAttrRecursive(dict):
    def __init__(self, input_dict):
        super().__init__(input_dict)
        for key, value in input_dict.items():
            if isinstance(value, dict):
                value = DictToAttrRecursive(value)
            self[key] = value
            setattr(self, key, value)


class GPTSovitsSynthesizer:
    """GPT-SoVITS 独立推理器"""

    def __init__(
        self,
        gpt_path: str,
        sovits_path: str,
        bert_path: str,
        hubert_path: str,
        device: str = "cpu"
    ):
        self.device = device
        self.is_half = False

        # 初始化 BERT
        print(f"Loading BERT from {bert_path}...")
        self.tokenizer = AutoTokenizer.from_pretrained(bert_path)
        self.bert_model = AutoModelForMaskedLM.from_pretrained(bert_path)
        self.bert_model = self.bert_model.to(device)

        # 初始化 HuBERT
        print(f"Loading HuBERT from {hubert_path}...")
        import feature_extractor.cnhubert as cnhubert_module
        cnhubert_module.cnhubert_base_path = hubert_path
        self.ssl_model = cnhubert_module.get_model()
        self.ssl_model = self.ssl_model.to(device)

        # 加载 SoVITS
        print(f"Loading SoVITS from {sovits_path}...")
        dict_s2 = torch.load(sovits_path, map_location="cpu", weights_only=False)
        hps = dict_s2["config"]
        self.hps = DictToAttrRecursive(hps)
        self.hps.model.semantic_frame_rate = "25hz"

        self.vq_model = SynthesizerTrn(
            self.hps.data.filter_length // 2 + 1,
            self.hps.train.segment_size // self.hps.data.hop_length,
            n_speakers=self.hps.data.n_speakers,
            **vars(self.hps.model)
        )
        if "pretrained" not in sovits_path:
            del self.vq_model.enc_q
        self.vq_model = self.vq_model.to(device)
        self.vq_model.eval()
        self.vq_model.load_state_dict(dict_s2["weight"], strict=False)

        # 加载 GPT
        print(f"Loading GPT from {gpt_path}...")
        dict_s1 = torch.load(gpt_path, map_location="cpu", weights_only=False)
        config = dict_s1["config"]
        self.hz = 50
        self.max_sec = config["data"]["max_sec"]

        self.t2s_model = Text2SemanticLightningModule(config, "****", is_train=False)
        self.t2s_model.load_state_dict(dict_s1["weight"])
        self.t2s_model = self.t2s_model.to(device)
        self.t2s_model.eval()

        print("All models loaded successfully!")

    def get_bert_feature(self, text: str, word2ph: list) -> torch.Tensor:
        with torch.no_grad():
            inputs = self.tokenizer(text, return_tensors="pt")
            for i in inputs:
                inputs[i] = inputs[i].to(self.device)
            res = self.bert_model(**inputs, output_hidden_states=True)
            res = torch.cat(res["hidden_states"][-3:-2], -1)[0].cpu()[1:-1]

        phone_level_feature = []
        for i in range(len(word2ph)):
            repeat_feature = res[i].repeat(word2ph[i], 1)
            phone_level_feature.append(repeat_feature)
        phone_level_feature = torch.cat(phone_level_feature, dim=0)
        return phone_level_feature.T

    def get_bert_inf(self, phones: list, word2ph: list, norm_text: str, language: str) -> torch.Tensor:
        language = language.replace("all_", "")
        if language == "zh":
            bert = self.get_bert_feature(norm_text, word2ph).to(self.device)
        else:
            bert = torch.zeros(
                (1024, len(phones)),
                dtype=torch.float32
            ).to(self.device)
        return bert

    def clean_text_inf(self, text: str, language: str) -> tuple:
        phones, word2ph, norm_text = clean_text(text, language)
        phones = cleaned_text_to_sequence(phones)
        return phones, word2ph, norm_text

    def get_spepc(self, filename: str) -> torch.Tensor:
        audio = load_audio(filename, int(self.hps.data.sampling_rate))
        audio = torch.FloatTensor(audio)
        audio_norm = audio.unsqueeze(0)
        spec = spectrogram_torch(
            audio_norm,
            self.hps.data.filter_length,
            self.hps.data.sampling_rate,
            self.hps.data.hop_length,
            self.hps.data.win_length,
            center=False,
        )
        return spec

    def synthesize(
        self,
        ref_wav_path: str,
        prompt_text: str,
        prompt_language: str,
        text: str,
        text_language: str
    ) -> tuple:
        # 确保推理时线程配置正确（intra-op 可重复设置，interop 只在模块加载时设置一次）
        torch.set_num_threads(CPU_THREADS)
        print(f"Synthesizing: {text}")

        # 1. 加载参考音频并提取 SSL 特征
        wav16k, sr = librosa.load(ref_wav_path, sr=16000)
        wav16k = torch.from_numpy(wav16k).to(self.device)
        zero_wav = np.zeros(int(self.hps.data.sampling_rate * 0.3), dtype=np.float32)
        zero_wav_torch = torch.from_numpy(zero_wav).to(self.device)
        wav16k = torch.cat([wav16k, zero_wav_torch])

        ssl_content = self.ssl_model.model(wav16k.unsqueeze(0))["last_hidden_state"].transpose(1, 2)
        codes = self.vq_model.extract_latent(ssl_content)
        prompt_semantic = codes[0, 0]

        # 2. 处理提示文本
        phones1, word2ph1, norm_text1 = self.clean_text_inf(prompt_text, prompt_language)
        bert1 = self.get_bert_inf(phones1, word2ph1, norm_text1, prompt_language)

        # 3. 处理目标文本
        phones2, word2ph2, norm_text2 = self.clean_text_inf(text, text_language)
        bert2 = self.get_bert_inf(phones2, word2ph2, norm_text2, text_language)

        # 4. 拼接 BERT
        bert = torch.cat([bert1, bert2], 1)

        # 5. GPT 推理
        all_phoneme_ids = torch.LongTensor(phones1 + phones2).to(self.device).unsqueeze(0)
        bert = bert.unsqueeze(0)
        all_phoneme_len = torch.tensor([all_phoneme_ids.shape[-1]]).to(self.device)
        prompt = prompt_semantic.unsqueeze(0).to(self.device)

        print("Running GPT inference...")
        with torch.no_grad():
            pred_semantic, idx = self.t2s_model.model.infer_panel(
                all_phoneme_ids,
                all_phoneme_len,
                prompt,
                bert,
                top_k=5,
                early_stop_num=self.hz * self.max_sec,
            )

        pred_semantic = pred_semantic[:, -idx:].unsqueeze(0)

        # 6. VITS 解码
        refer = self.get_spepc(ref_wav_path).to(self.device)
        audio = self.vq_model.decode(
            pred_semantic,
            torch.LongTensor(phones2).to(self.device).unsqueeze(0),
            refer
        ).detach().cpu().numpy()[0, 0]

        # 7. 后处理
        max_audio = np.abs(audio).max()
        if max_audio > 1:
            audio = audio / max_audio

        duration = len(audio) / self.hps.data.sampling_rate
        print(f"Generated audio: {duration:.2f}s")

        return audio, self.hps.data.sampling_rate, duration


if __name__ == "__main__":
    # 测试
    import sys
    import os
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)

    from config import Config
    cfg = Config.get_instance()

    synthesizer = GPTSovitsSynthesizer(
        gpt_path=cfg.GPT_MODEL_PATH,
        sovits_path=cfg.SOVITS_MODEL_PATH,
        bert_path=cfg.BERT_PATH,
        hubert_path=cfg.HUBERT_PATH,
        device="cpu"
    )

    audio, sr, duration = synthesizer.synthesize(
        ref_wav_path=r"d:\dev\cyber-wife\satori-ai\character-cards\satori\TTS\example\normal.wav",
        prompt_text="こんにちは",
        prompt_language="ja",
        text="こんにちは、元気ですか？",
        text_language="ja"
    )

    # 保存
    output_path = os.path.join(current_dir, "output", "standalone_test.wav")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    sf.write(output_path, audio, sr)
    print(f"Saved to {output_path}")