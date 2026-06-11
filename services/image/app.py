"""
Image Analysis Service
Provides VLLM-based image analysis (fast/detailed modes).
"""
import logging

# Suppress uvicorn access logs (health check polling noise)
logging.getLogger('uvicorn.access').setLevel(logging.WARNING)

# ── Load .env ─────────────────────────────────────────────────────
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

# ── Constants ──────────────────────────────────────────────────────

SERVICE_PORT = 8742

# VLLM
VLLM_TIMEOUT = 120.0
VLLM_DEFAULT_TEMP = 0.3
VLLM_FAST_PROMPT = "当前是快速模式，请用几句话简短给出图片中的有效信息"
VLLM_DETAILED_PROMPT = "当前是详细模式，请详细描述这张图片的内容，包括所有可见的文字、物体、人物、场景布局和重要细节"

# ── Imports ────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import base64
import time
import os

app = FastAPI(title="Image Analysis Service")


async def call_vision_llm(image_base64: str, vllm_mode: str = "fast", query: str = None) -> str:
    """Call the configured Vision LLM for multimodal analysis."""
    base_url = os.environ.get("VISION_LLM_BASE_URL", "")
    api_key = os.environ.get("VISION_LLM_API_KEY", "")
    model = os.environ.get("VISION_LLM_MODEL", "")

    if not api_key or not base_url or not model:
        raise HTTPException(status_code=500, detail="VISION_LLM_API_KEY, VISION_LLM_BASE_URL, or VISION_LLM_MODEL not configured")

    import httpx

    if "/v1" in base_url or "/v3" in base_url:
        full_url = f"{base_url}/chat/completions"
    else:
        full_url = base_url

    base_prompt = "你是一个图像信息提取器，你不需要回答用户的问题，而是返回可能用于回答用户问题的图像内容描述。\n"

    if vllm_mode == "detailed":
        base_prompt += VLLM_DETAILED_PROMPT
    else:
        base_prompt += VLLM_FAST_PROMPT

    if query:
        prompt = f"{base_prompt}\n\n用户问题：{query}"
    else:
        prompt = base_prompt

    async with httpx.AsyncClient(timeout=VLLM_TIMEOUT) as client:
        response = await client.post(
            full_url,
            json={
                "model": model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}},
                        {"type": "text", "text": prompt}
                    ]
                }],
                "temperature": float(os.environ.get("VISION_LLM_TEMPERATURE", str(VLLM_DEFAULT_TEMP)))
            },
            headers={"Authorization": f"Bearer {api_key}"}
        )
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Vision LLM API error: {response.status_code} {response.text}")
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _run_analysis(image_base64: str, vllm_mode: str, query: Optional[str]) -> dict:
    """Core analysis pipeline: VLLM based."""
    start = time.time()

    vllm_result = None
    if vllm_mode and vllm_mode != "none":
        vllm_result = await call_vision_llm(image_base64, vllm_mode, query)

    elapsed_ms = (time.time() - start) * 1000

    return {
        "success": True,
        "vllm_result": vllm_result,
        "elapsed_ms": round(elapsed_ms, 1),
        "error": None
    }


# ── Pydantic models ──────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    image_base64: str
    vllm_mode: str = "fast"
    query: Optional[str] = None


class CaptureRequest(BaseModel):
    vllm_mode: str = "fast"
    query: Optional[str] = None


class AnalyzeResponse(BaseModel):
    success: bool
    vllm_result: Optional[str] = None
    elapsed_ms: float
    error: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "image-analysis"
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    return await _run_analysis(request.image_base64, request.vllm_mode, request.query)


@app.post("/capture", response_model=AnalyzeResponse)
async def capture(request: CaptureRequest):
    import mss
    import mss.tools

    with mss.MSS() as sct:
        monitor = sct.monitors[1]
        screenshot = sct.grab(monitor)
        png_data = mss.tools.to_png(screenshot.rgb, screenshot.size)
        image_base64 = base64.b64encode(png_data).decode("utf-8")

    return await _run_analysis(image_base64, request.vllm_mode, request.query)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=SERVICE_PORT)
