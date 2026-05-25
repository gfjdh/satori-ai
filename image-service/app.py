"""
Image Analysis Service
Provides OCR text extraction, YOLO26 object detection, and optional VLLM analysis.
"""
# ── Constants ──────────────────────────────────────────────────────

# Service
SERVICE_PORT = 8742

# Image preprocessing
OCR_MAX_SIZE = 0             # 快速模式：不缩放 (0=原图), 检测模型内部 limit_side_len 控速
OCR_MAX_SIZE_PRECISE = 1280  # 精确模式：缩放到1280px保留更多细节

# RapidOCR engine — fast mode (default)
OCR_USE_ANGLE_CLS = False    # 不启用方向分类器 (截图正向)
OCR_LIMIT_SIDE_LEN = 320     # 检测输入最小边 (越小越快)
OCR_LIMIT_TYPE = "min"

# RapidOCR engine — precise mode
OCR_USE_ANGLE_CLS_PRECISE = True
OCR_LIMIT_SIDE_LEN_PRECISE = 736  # 原始默认值, 检测更多文字

# RapidOCR call
OCR_BOX_THRESH = 0.75        # 快速模式检测框阈值
OCR_BOX_THRESH_PRECISE = 0.5 # 精确模式检测框阈值

# YOLO26
YOLO_MODEL = "yolo26n.pt"
YOLO_IMGSZ = 640

# VLLM
VLLM_TIMEOUT = 120.0
VLLM_DEFAULT_PROMPT = "请详细描述这张图片的内容"
VLLM_DEFAULT_TEMP = 0.7

# ── Imports ────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import base64
import io
import time
import os
from PIL import Image
import numpy as np

app = FastAPI(title="Image Analysis Service")

# Lazy-loaded model globals
_ocr_fast = None
_ocr_precise = None
_yolo_model = None


def get_ocr(precise: bool = False):
    """Lazy-load RapidOCR engine. Two instances: fast (default) and precise."""
    global _ocr_fast, _ocr_precise
    if precise:
        if _ocr_precise is None:
            from rapidocr_onnxruntime import RapidOCR
            _ocr_precise = RapidOCR(
                use_angle_cls=OCR_USE_ANGLE_CLS_PRECISE,
                limit_side_len=OCR_LIMIT_SIDE_LEN_PRECISE,
                limit_type=OCR_LIMIT_TYPE,
            )
            _ocr_precise(np.zeros((480, 640, 3), dtype=np.uint8))
        return _ocr_precise
    else:
        if _ocr_fast is None:
            from rapidocr_onnxruntime import RapidOCR
            _ocr_fast = RapidOCR(
                use_angle_cls=OCR_USE_ANGLE_CLS,
                limit_side_len=OCR_LIMIT_SIDE_LEN,
                limit_type=OCR_LIMIT_TYPE,
            )
            _ocr_fast(np.zeros((480, 640, 3), dtype=np.uint8))
        return _ocr_fast


def get_yolo():
    """Lazy-load YOLO26n model on first use."""
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        _yolo_model = YOLO(YOLO_MODEL)
    return _yolo_model


def base64_to_pil(b64_string: str) -> Image.Image:
    """Decode base64 image to PIL Image."""
    if b64_string.startswith("data:image"):
        b64_string = b64_string.split(",", 1)[1]
    image_bytes = base64.b64decode(b64_string)
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def resize_image(img: Image.Image, max_size: int = OCR_MAX_SIZE) -> Image.Image:
    """Resize image so the longest side is max_size pixels."""
    if max_size <= 0:
        return img
    w, h = img.size
    if max(w, h) <= max_size:
        return img
    ratio = max_size / max(w, h)
    return img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)


async def call_vision_llm(image_base64: str, query: str = None) -> str:
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

    prompt = query or VLLM_DEFAULT_PROMPT

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


async def _run_analysis(image_base64: str, use_vllm: bool, precise_ocr: bool, query: Optional[str]) -> dict:
    """Core analysis pipeline: OCR + YOLO + optional VLLM."""
    start = time.time()
    img = base64_to_pil(image_base64)
    img_w, img_h = img.size

    ocr_results = []
    detection_results = []
    vllm_result = None

    # OCR — select fast or precise engine + params
    if precise_ocr:
        ocr_img = resize_image(img, OCR_MAX_SIZE_PRECISE)
        ocr_np = np.array(ocr_img)
        ocr = get_ocr(precise=True)
        ocr_raw, _ = ocr(ocr_np, box_thresh=OCR_BOX_THRESH_PRECISE)
    else:
        ocr_img = resize_image(img)
        ocr_np = np.array(ocr_img)
        ocr = get_ocr(precise=False)
        ocr_raw, _ = ocr(ocr_np, box_thresh=OCR_BOX_THRESH)
    if ocr_raw:
        for item in ocr_raw:
            box, text, confidence = item
            ocr_results.append({
                "text": text,
                "confidence": round(float(confidence), 4),
                "box": [[float(p[0]), float(p[1])] for p in box]
            })

    # YOLO26 detection
    yolo = get_yolo()
    yolo_results = yolo(img, imgsz=YOLO_IMGSZ, verbose=False)
    if yolo_results and len(yolo_results) > 0:
        boxes = yolo_results[0].boxes
        if boxes is not None:
            names = yolo_results[0].names
            for i in range(len(boxes.cls)):
                detection_results.append({
                    "class_name": names[int(boxes.cls[i].item())],
                    "confidence": round(float(boxes.conf[i].item()), 4),
                    "box": [round(float(v), 1) for v in boxes.xyxy[i].tolist()]
                })

    # VLLM
    if use_vllm:
        vllm_result = await call_vision_llm(image_base64, query)

    elapsed_ms = (time.time() - start) * 1000

    return {
        "success": True,
        "image_width": img_w,
        "image_height": img_h,
        "ocr_results": ocr_results,
        "detection_results": detection_results,
        "vllm_result": vllm_result,
        "elapsed_ms": round(elapsed_ms, 1),
        "error": None
    }


# ── Pydantic models ──────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    image_base64: str
    use_vllm: bool = False
    precise_ocr: bool = False
    query: Optional[str] = None


class CaptureRequest(BaseModel):
    use_vllm: bool = False
    precise_ocr: bool = False
    query: Optional[str] = None


class OCRItem(BaseModel):
    text: str
    confidence: float
    box: List[List[float]]


class DetectionItem(BaseModel):
    class_name: str
    confidence: float
    box: List[float]


class AnalyzeResponse(BaseModel):
    success: bool
    image_width: int
    image_height: int
    ocr_results: List[OCRItem]
    detection_results: List[DetectionItem]
    vllm_result: Optional[str] = None
    elapsed_ms: float
    error: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "image-analysis",
        "ocr_fast_loaded": _ocr_fast is not None,
        "ocr_precise_loaded": _ocr_precise is not None,
        "yolo_loaded": _yolo_model is not None
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    return await _run_analysis(request.image_base64, request.use_vllm, request.precise_ocr, request.query)


@app.post("/capture", response_model=AnalyzeResponse)
async def capture(request: CaptureRequest):
    import mss
    import mss.tools

    with mss.MSS() as sct:
        monitor = sct.monitors[1]
        screenshot = sct.grab(monitor)
        png_data = mss.tools.to_png(screenshot.rgb, screenshot.size)
        image_base64 = base64.b64encode(png_data).decode("utf-8")

    return await _run_analysis(image_base64, request.use_vllm, request.precise_ocr, request.query)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=SERVICE_PORT)
