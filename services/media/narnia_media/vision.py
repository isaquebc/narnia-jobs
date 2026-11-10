"""Leitura de quadros (F13/M3): 1 por segundo pelo ffmpeg, em RGB, sem ampliar (ampliar miniaturas não ajudou no teste
de viabilidade); medições de luz, contraste e nitidez no recorte de cada rosto."""

import subprocess
from collections.abc import Iterator
from pathlib import Path

import numpy as np

MAX_WIDTH = 1920


def out_size(width: int, height: int) -> tuple[int, int]:
    if width <= MAX_WIDTH:
        return width - width % 2, height - height % 2
    h = round(height * MAX_WIDTH / width)
    return MAX_WIDTH, h - h % 2


def read_frames(video: Path, width: int, height: int, fps: float = 1.0, start: float = 0.0) -> Iterator[tuple[float, np.ndarray]]:
    w, h = out_size(width, height)
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start), "-i", str(video), "-vf", f"fps={fps},scale={w}:{h}",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = w * h * 3
    k = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield round(start + k / fps, 3), np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            k += 1
    finally:
        proc.stdout.close()
        proc.wait()


def frame_at(video: Path, t: float, width: int, height: int) -> np.ndarray | None:
    w, h = out_size(width, height)
    res = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(video), "-frames:v", "1",
                          "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                         capture_output=True)
    if len(res.stdout) < w * h * 3:
        return None
    return np.frombuffer(res.stdout[: w * h * 3], np.uint8).reshape(h, w, 3)


def save_jpeg(video: Path, t: float, out: Path, max_width: int = 1280) -> bool:
    res = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", str(video), "-frames:v", "1",
                          "-vf", f"scale='min({max_width},iw)':-2", "-q:v", "4", str(out)], capture_output=True)
    return res.returncode == 0 and out.is_file()


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def crop_metrics(rgb: np.ndarray, bbox: list[int], frame_luma: float) -> dict:
    x, y, w, h = bbox
    crop = luma(rgb[max(0, y) : y + h, max(0, x) : x + w].astype(np.float32))
    if crop.size < 16:
        return {"frame_luma": round(frame_luma, 1)}
    lap = crop[1:-1, 1:-1] * -4 + crop[:-2, 1:-1] + crop[2:, 1:-1] + crop[1:-1, :-2] + crop[1:-1, 2:]
    return {"luma": round(float(crop.mean()), 1), "contrast": round(float(crop.std()), 1),
            "sharpness": round(float(lap.var()), 1) if lap.size else None, "frame_luma": round(frame_luma, 1)}
