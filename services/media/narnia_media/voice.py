"""Etapa de voz (F13/M2, §2.2 #5): ritmo, pausas, entonação, volume e palavras de apoio por falante.

Entonação pelo `yin` do librosa (ISC), só nos trechos de fala de cada pessoa; a variação vem em semitons em torno da
mediana da própria pessoa (perto de zero = voz monótona). Parselmouth fica fora (GPLv3; o projeto é MIT).
"""

import re
from collections import defaultdict

import numpy as np

FILLERS = {
    "pt": ["tipo assim", "meio que", "basicamente", "entendeu", "sabe", "né", "hum", "hã", "ahn", "eh"],
    "en": ["you know", "i mean", "kind of", "sort of", "basically", "actually", "like", "um", "uh"],
}
PAUSE_S = 0.5
LONG_PAUSE_S = 2.0


def count_fillers(text: str, language: str) -> dict[str, int]:
    rest = text.lower()
    counts: dict[str, int] = {}
    for term in FILLERS.get(language[:2], FILLERS["pt"]):  # expressões longas primeiro
        pattern = re.compile(rf"(?<!\w){re.escape(term)}(?!\w)")
        n = len(pattern.findall(rest))
        if n:
            counts[term] = n
            rest = pattern.sub(" ", rest)
    return counts


def _pitch(chunks: list[np.ndarray], sr: int) -> np.ndarray:
    import librosa

    values = []
    for x in chunks:
        if len(x) < 2048:
            continue
        f0 = librosa.yin(x, fmin=60, fmax=450, sr=sr, frame_length=2048, hop_length=512)
        rms = librosa.feature.rms(y=x, frame_length=2048, hop_length=512)[0][: len(f0)]
        voiced = f0[: len(rms)][rms > max(1e-4, 0.1 * float(np.median(rms)))]
        values.append(voiced[(voiced > 60) & (voiced < 450)])
    return np.concatenate(values) if values else np.array([])


def measure_voice(turns: list[dict], wav: np.ndarray, sr: int, *, language: str = "pt") -> dict:
    by: dict[str, list[dict]] = defaultdict(list)
    for t in turns:
        by[t["speaker"] or "?"].append(t)
    latencies: dict[str, list[float]] = defaultdict(list)
    for prev, cur in zip(turns, turns[1:]):
        if cur["speaker"] != prev["speaker"]:
            latencies[cur["speaker"] or "?"].append(max(0.0, round(cur["start"] - prev["end"], 3)))
    total = sum(t["end"] - t["start"] for t in turns) or 1.0
    speakers = {}
    for spk, ts in by.items():
        talk = sum(t["end"] - t["start"] for t in ts)
        words = [x for t in ts for x in t["words"]]
        gaps = [b["start"] - a["end"] for t in ts for a, b in zip(t["words"], t["words"][1:])]
        fillers = count_fillers(" ".join(t["text"] for t in ts), language)
        chunks = [wav[int(t["start"] * sr) : int(t["end"] * sr)] for t in ts]
        f0 = _pitch(chunks, sr)
        median = float(np.median(f0)) if f0.size else None
        spread = float(np.std(12 * np.log2(f0 / median))) if f0.size and median else None
        lat = latencies.get(spk, [])
        speakers[spk] = {
            "turns": len(ts),
            "talk_s": round(talk, 1),
            "words": len(words),
            "wpm": round(len(words) / (talk / 60), 1) if talk > 0 else 0.0,
            "longest_turn_s": round(max(t["end"] - t["start"] for t in ts), 1),
            "pauses": sum(1 for g in gaps if g > PAUSE_S),
            "long_pauses": sum(1 for g in gaps if g > LONG_PAUSE_S),
            "fillers": fillers,
            "fillers_per_min": round(sum(fillers.values()) / (talk / 60), 2) if talk > 0 else 0.0,
            "pitch_median_hz": round(median, 1) if median else None,
            "pitch_spread_semitones": round(spread, 2) if spread is not None else None,
            "response_latency_median_s": round(float(np.median(lat)), 2) if lat else None,
            "low_confidence_words": sum(1 for x in words if x.get("p", 1) < 0.5),
        }
    return {
        "speakers": speakers,
        "talk_share": {s: round(sum(t["end"] - t["start"] for t in ts) / total, 3) for s, ts in by.items()},
    }
