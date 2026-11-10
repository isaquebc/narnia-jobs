"""Etapa de áudio (F13/M2, §2.2 #6): volume, picos, saturação e ruído de fundo por falante.

O áudio da chamada já chega misturado e comprimido pela plataforma: os números comparam as pessoas entre si e com o
ruído do arquivo, não medem o microfone de cada uma.
"""

from collections import defaultdict

import numpy as np

FRAME_S = 0.1


def _db(x: float) -> float:
    return round(20 * float(np.log10(max(x, 1e-9))), 1)


def measure_levels(turns: list[dict], wav: np.ndarray, sr: int) -> dict:
    hop = int(FRAME_S * sr)
    n = len(wav) // hop
    frames = wav[: n * hop].reshape(n, hop) if n else np.zeros((0, hop))
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1)) if n else np.array([])
    speech = np.zeros(n, bool)
    for t in turns:
        speech[int(t["start"] / FRAME_S) : int(np.ceil(t["end"] / FRAME_S))] = True
    quiet = rms[~speech] if (~speech).any() else rms
    floor = _db(float(np.percentile(quiet, 10))) if quiet.size else None
    by: dict[str, list[np.ndarray]] = defaultdict(list)
    for t in turns:
        by[t["speaker"] or "?"].append(wav[int(t["start"] * sr) : int(t["end"] * sr)])
    speakers = {}
    for spk, parts in by.items():
        x = np.concatenate(parts) if parts else np.zeros(1, np.float32)
        level = _db(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))))
        speakers[spk] = {
            "rms_dbfs": level,
            "peak_dbfs": _db(float(np.max(np.abs(x)))),
            "clipping_ratio": round(float(np.mean(np.abs(x) >= 0.99)), 5),
            "snr_db": round(level - floor, 1) if floor is not None else None,
        }
    return {"noise_floor_dbfs": floor, "speakers": speakers}
