"""
OCR 参数调优工具 — 截图后跑 OCR+YOLO，输出耗时拆解和识别文本。

用法:
  image-service\venv\Scripts\python.exe image-service\tune.py                           # 默认参数跑一次 (resize=960, box_thresh=0.6)
  image-service\venv\Scripts\python.exe image-service\tune.py --limit-side-len 320 --resize 0 --box 0.75    # 自定义
  image-service\venv\Scripts\python.exe image-service\tune.py --compare                  # 对比 4 组预设
  image-service\venv\Scripts\python.exe image-service\tune.py --resize 960 --box 0.5 --box 0.6 --box 0.7 --box 0.8  # 同参数多 box_thresh 对比

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
参数速查表 (对应 image-service/app.py)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  get_ocr() -> RapidOCR(...) 构造参数 (app.py:27-30):
    --use-angle-cls    0|1    默认 0  截图正向, 关掉角度分类省 5-10%
    --limit-side-len   px     默认 320 检测模型输入最小边长 (越小越快, 丢失小文字)
    --limit-type       min|max 默认 min
    --text-score       0-1    默认 0.5 识别置信度阈值 (最终过滤)
    --min-height       px     默认 30  低于此高度的框跳过检测
    --width-height-ratio int   默认 8   图片宽高比超过此值跳过检测

  ocr(img, ...) 调用参数 (app.py:110):
    --box-thresh       0-1    默认 0.6 检测框阈值 (越高框越少越快)
    --unclip-ratio     float  默认 1.6 检测框扩张比

  图片预处理 (app.py:54):
    --resize           px     默认 960 图片长边缩放, 0=不缩放

  YOLO (app.py:120):
    --yolo-imgsz       px     默认 640

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import argparse
import io
import time
import sys

import mss
import mss.tools
import numpy as np
from PIL import Image


def capture_screen():
    with mss.MSS() as sct:
        monitor = sct.monitors[1]
        screenshot = sct.grab(monitor)
        png_data = mss.tools.to_png(screenshot.rgb, screenshot.size)
        return Image.open(io.BytesIO(png_data)).convert("RGB")


def resize_image(img, max_size):
    if max_size <= 0:
        return img
    w, h = img.size
    if max(w, h) <= max_size:
        return img
    ratio = max_size / max(w, h)
    return img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)


def build_ocr_engine(ocr_kwargs):
    """Build a RapidOCR engine with given params. Keep the engine alive for reuse."""
    from rapidocr_onnxruntime import RapidOCR

    t0 = time.time()
    engine = RapidOCR(**ocr_kwargs)
    init_ms = (time.time() - t0) * 1000

    # Warmup: run a dummy image through to compile ONNX graphs
    engine(np.zeros((480, 640, 3), dtype=np.uint8))

    return engine, init_ms


def run_one(img_np, engine, box_thresh=0.5):
    """Single OCR run, return wall-clock time and results."""
    t0 = time.time()
    result, _ = engine(img_np, box_thresh=box_thresh)
    elapsed_ms = (time.time() - t0) * 1000

    texts = []
    if result:
        for box, text, conf in result:
            texts.append((text, float(conf)))
    return {"elapsed_ms": elapsed_ms, "count": len(texts), "texts": texts}


def run_yolo(img, imgsz=640):
    from ultralytics import YOLO

    t0 = time.time()
    model = YOLO("yolo26n.pt")
    init_ms = (time.time() - t0) * 1000

    model(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)

    t0 = time.time()
    results = model(img, imgsz=imgsz, verbose=False)
    elapsed_ms = (time.time() - t0) * 1000

    detections = []
    if results and len(results) > 0:
        boxes = results[0].boxes
        if boxes is not None:
            names = results[0].names
            for i in range(len(boxes.cls)):
                detections.append(f"{names[int(boxes.cls[i].item())]} ({float(boxes.conf[i].item()):.0%})")

    return {"init_ms": init_ms, "elapsed_ms": elapsed_ms, "count": len(detections), "objects": detections}


def print_bar(label, r, show_texts=False):
    bar = "─" * 55
    print(f"\n{bar}")
    print(f"  {label}")
    print(f"{bar}")
    print(f"  Time:  {r['elapsed_ms']:.0f}ms  |  Texts: {r['count']}")
    if show_texts and r["texts"]:
        for text, conf in r["texts"][:25]:
            print(f"  [{conf:.0%}] {text}")
        if len(r["texts"]) > 25:
            print(f"  … +{len(r['texts']) - 25} more")


def main():
    parser = argparse.ArgumentParser(description="OCR 参数调优工具")

    # OCR 构造参数
    parser.add_argument("--use-angle-cls", type=int, default=0)
    parser.add_argument("--limit-side-len", type=int, default=320)
    parser.add_argument("--text-score", type=float, default=0.5)
    parser.add_argument("--min-height", type=int, default=30)
    parser.add_argument("--width-height-ratio", type=int, default=8)
    # OCR 调用参数 (支持多个值做对比)
    parser.add_argument("--box", "--box-thresh", dest="box_threshs", type=float, nargs="*", default=[0.6])
    parser.add_argument("--unclip-ratio", type=float, default=1.6)
    # 图片
    parser.add_argument("--resize", type=int, default=960)
    # 模式
    parser.add_argument("--compare", action="store_true")
    parser.add_argument("--yolo", action="store_true")
    parser.add_argument("--yolo-imgsz", type=int, default=640)
    parser.add_argument("--show-texts", action="store_true", help="print OCR text results")
    args = parser.parse_args()

    # ── Capture ──────────────────────────────────────────
    print("Capturing screen...", end=" ", flush=True)
    t0 = time.time()
    img_original = capture_screen()
    cap_ms = (time.time() - t0) * 1000
    print(f"{img_original.size[0]}x{img_original.size[1]} ({cap_ms:.0f}ms)")

    # ── Resize ───────────────────────────────────────────
    img_full = resize_image(img_original, args.resize)
    if args.resize:
        print(f"Resized: {img_full.size[0]}x{img_full.size[1]}\n")
    else:
        print(f"No resize\n")

    img_np = np.array(img_full)

    if args.compare:
        # ── Compare mode: 4 preset configs ──────────────────
        presets = [
            ("default     (lim736,nocls,box0.5,resize1280)", 1280, False, 736, 0.5),
            ("optimized   (lim320,nocls,box0.6,resize1280) ", 1280, False, 320, 0.6),
            ("fast        (lim320,nocls,box0.7,resize1280) ", 1280, False, 320, 0.7),
            ("ultrafast   (lim320,nocls,box0.8,resize1280) ", 1280, False, 320, 0.8),
        ]

        print(f"{'Preset':<55s} {'Time':>8s}  {'Texts':>6s}  {'Rate':>7s}")
        print("-" * 83)

        for label, resize_sz, use_cls, lim_len, box_thresh in presets:
            # Build engine for this preset
            engine, init_ms = build_ocr_engine({
                "use_angle_cls": use_cls,
                "limit_side_len": lim_len,
                "limit_type": "min",
            })

            # Resize image for this preset
            img_r = resize_image(img_original, resize_sz) if resize_sz else img_full
            img_r_np = np.array(img_r)

            # Warmup + run
            engine(img_r_np, box_thresh=box_thresh)

            runs = []
            for _ in range(3):
                runs.append(run_one(img_r_np, engine, box_thresh=box_thresh))

            avg_ms = sum(r["elapsed_ms"] for r in runs) / len(runs)
            n_texts = runs[-1]["count"]
            rate = n_texts / avg_ms * 1000 if avg_ms > 0 else 0

            print(f"  {label:<52s} {avg_ms:>6.0f}ms  {n_texts:>5d}   {rate:>5.0f} txt/s")

    elif len(args.box_threshs) > 1:
        # ── Multi box_thresh对比 (同一个引擎) ─────────────
        engine, init_ms = build_ocr_engine({
            "use_angle_cls": bool(args.use_angle_cls),
            "limit_side_len": args.limit_side_len,
            "limit_type": "min",
            "text_score": args.text_score,
            "min_height": args.min_height,
            "width_height_ratio": args.width_height_ratio,
        })
        print(f"Engine init: {init_ms:.0f}ms")
        # warmup
        run_one(img_np, engine, args.box_threshs[0])

        print(f"\n{'box_thresh':>12s}  {'Time':>8s}  {'Texts':>6s}  {'Rate':>7s}")
        print("-" * 42)
        for bt in args.box_threshs:
            runs = [run_one(img_np, engine, bt) for _ in range(3)]
            avg_ms = sum(r["elapsed_ms"] for r in runs) / len(runs)
            n = runs[-1]["count"]
            rate = n / avg_ms * 1000 if avg_ms > 0 else 0
            print(f"  {bt:>10.2f}   {avg_ms:>6.0f}ms  {n:>5d}   {rate:>5.0f} txt/s")
            if args.show_texts and runs[-1]["texts"]:
                for text, conf in runs[-1]["texts"][:15]:
                    print(f"           [{conf:.0%}] {text}")

    else:
        # ── Single run ────────────────────────────────────
        ocr_kwargs = {
            "use_angle_cls": bool(args.use_angle_cls),
            "limit_side_len": args.limit_side_len,
            "limit_type": "min",
            "text_score": args.text_score,
            "min_height": args.min_height,
            "width_height_ratio": args.width_height_ratio,
        }
        print(f"OCR params: {ocr_kwargs}")
        print(f"Call params: box_thresh={args.box_threshs[0]}, unclip_ratio={args.unclip_ratio}")

        engine, init_ms = build_ocr_engine(ocr_kwargs)
        print(f"Engine init: {init_ms:.0f}ms")

        # warmup
        run_one(img_np, engine, args.box_threshs[0])

        runs = [run_one(img_np, engine, args.box_threshs[0]) for _ in range(3)]
        avg_ms = sum(r["elapsed_ms"] for r in runs) / len(runs)

        r = runs[-1]
        print_bar(f"OCR  resize={args.resize}  box_thresh={args.box_threshs[0]}", r, show_texts=True)
        print(f"  → avg of 3 runs: {avg_ms:.0f}ms")

        if args.yolo:
            yr = run_yolo(img_full, imgsz=args.yolo_imgsz)
            print(f"\n  YOLO: {yr['elapsed_ms']:.0f}ms  |  Objects: {yr['count']}")
            for obj in yr["objects"]:
                print(f"    {obj}")
            print(f"\n  Combined OCR+YOLO: {avg_ms + yr['elapsed_ms']:.0f}ms")

    print()


if __name__ == "__main__":
    main()
