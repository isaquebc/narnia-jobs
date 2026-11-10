"""Etapa 9 (F13/M3): ligar voz e rosto. A boca de quem fala mexe nos segundos em que a voz dela aparece: correlação
entre o movimento da boca de cada rosto e os turnos de cada falante. Sem separação de vozes (sem token), cada turno vai
para o rosto que mais mexe a boca durante ele (aproximado, a pessoa corrige)."""

import math

import numpy as np


def _activity(track: dict, seconds: int) -> np.ndarray:
    act = np.full(seconds, np.nan)
    prev = None
    for row in track["series"]:
        s = int(row["t"])
        if 0 <= s < seconds:
            move = abs(row["jawOpen"] - prev) if prev is not None else 0.0
            act[s] = move + 0.5 * row["jawOpen"]
        prev = row["jawOpen"]
    return act


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    m = ~np.isnan(a) & ~np.isnan(b)
    if m.sum() < 5 or np.std(a[m]) == 0 or np.std(b[m]) == 0:
        return 0.0
    return float(np.corrcoef(a[m], b[m])[0, 1])


def link_speakers(tracks: list[dict], turns: list[dict]) -> dict:
    end = max([t["end"] for t in turns] + [r["t"] for tr in tracks for r in tr["series"]] + [1.0])
    seconds = int(math.ceil(end)) + 1
    acts = {tr["id"]: _activity(tr, seconds) for tr in tracks}
    speakers = sorted({t["speaker"] for t in turns if t["speaker"] is not None})
    if not speakers:
        turn_tracks = []
        for t in turns:
            a, b = int(t["start"]), int(math.ceil(t["end"])) + 1
            scores = {tid: float(np.nanmean(act[a:b])) if not np.all(np.isnan(act[a:b])) else -1.0
                      for tid, act in acts.items()}
            turn_tracks.append(max(scores, key=scores.get) if scores and max(scores.values()) >= 0 else None)
        return {"approximate": True, "speaker_to_track": {}, "confidence": {}, "ambiguous": [],
                "turn_tracks": turn_tracks}
    indicator = {}
    for spk in speakers:
        ind = np.zeros(seconds)
        for t in turns:
            if t["speaker"] == spk:
                ind[int(t["start"]) : int(math.ceil(t["end"]))] = 1.0
        indicator[spk] = ind
    pairs = sorted(((_corr(acts[tid], indicator[spk]), spk, tid) for spk in speakers for tid in acts), reverse=True)
    mapping, confidence, used = {}, {}, set()
    for c, spk, tid in pairs:
        if spk in mapping or tid in used or c < 0.1:
            continue
        mapping[spk], confidence[spk] = tid, round(c, 3)
        used.add(tid)
    ambiguous = []
    for spk in speakers:
        mine = sorted((c for c, s, _ in pairs if s == spk), reverse=True)
        if spk not in mapping or mine[0] < 0.2 or (len(mine) > 1 and mine[0] - mine[1] < 0.05):
            ambiguous.append(spk)
    return {"approximate": False, "speaker_to_track": mapping, "confidence": confidence, "ambiguous": ambiguous,
            "turn_tracks": [mapping.get(t["speaker"]) for t in turns]}
