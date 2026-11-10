"""Etapa 10 (F13/M3): eventos e medições por pessoa, sempre relativos ao padrão da própria pessoa (§2.3, §2.4).

- Reações: sorriso, sobrancelha erguida ou franzida bem acima da mediana da pessoa por ≥ 2 s, com o turno de outra
  pessoa que veio antes (o que provocou). Quem sorri o tempo todo não gera evento por sorrir.
- Anotações (F13-8): confirmada quando alguém diz que está anotando agora; provável com cabeça ou olhar para baixo por
  ≥ 4 s, ou rosto perdido por ≥ 4 s em quem é bem detectado. A leitura começa indeterminada; quem dá a hipótese é o
  recrutador.
- Confiabilidade (F13-4): % do tempo com o rosto detectável e tamanho do rosto. O sorriso sai sempre, com o nível.
"""

import re
from statistics import median

NOTE_RE = re.compile(
    r"(?<!\w)(vou anotar|deixa eu anotar|deixa eu escrever|anotar (isso|aqui|rapidinho)|anotando|anotei|anoto aqui|"
    r"tomando nota|fazendo uma anotação|let me (write|note)|taking notes?|writing (this|that) down|jot(ting)? (this|that) down)",
    re.I,
)
REACTIONS = {"smile": "smile", "brow_raise": "browUp", "frown": "browDown"}
MIN_REACTION_S = 2
NOTE_DOWN_S = 4
TRIGGER_WINDOW_S = 8.0


def reliability(track: dict) -> dict:
    pct = round(100 * track["detected_ratio"], 1)
    px = track["face_px"]
    level = "good" if pct >= 80 and px >= 100 else "weak" if pct >= 50 and px >= 48 else "poor"
    return {"detected_pct": pct, "face_px": px, "level": level}


def _median(rows, key, default=0.0):
    vals = [r[key] for r in rows if key in r]
    return float(median(vals)) if vals else default


def person_stats(track: dict) -> dict:
    s = track["series"]
    n = len(s) or 1
    pitch0 = _median(s, "pitch")
    luma = _median(s, "luma", None)
    frame_luma = _median(s, "frame_luma", None)
    sharp = _median(s, "sharpness", None)
    flags = []
    if track["face_px"] < 100:
        flags.append("small_face")
    if luma is not None and luma < 70:
        flags.append("dark")
    if luma is not None and luma > 200:
        flags.append("overexposed")
    if luma is not None and frame_luma is not None and frame_luma - luma > 40:
        flags.append("backlit")
    if sharp is not None and sharp < 20:
        flags.append("blurry")
    return {
        "reliability": reliability(track),
        "smile_ratio": round(sum(1 for r in s if r["smile"] > 0.4) / n, 3),
        "smile_mean": round(_median(s, "smile"), 3),
        "gaze_down_ratio": round(sum(1 for r in s if r["eyeLookDown"] > 0.5 or r["pitch"] < pitch0 - 15) / n, 3),
        "head_yaw_abs_median": round(float(median(abs(r["yaw"]) for r in s)), 1) if s else None,
        "camera": {"face_px": track["face_px"], "face_luma": luma, "frame_luma": frame_luma, "contrast":
                   _median(s, "contrast", None), "sharpness": sharp, "flags": flags},
    }


def _runs(times: list[float], max_gap: float = 1.5) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for t in times:
        if out and t - out[-1][1] <= max_gap:
            out[-1] = (out[-1][0], t)
        else:
            out.append((t, t))
    return out


def _trigger(turns: list[dict], t: float, track_id: str, speaker_to_track: dict) -> int | None:
    best = None
    for i, turn in enumerate(turns):
        mine = turn["speaker"] is not None and speaker_to_track.get(turn["speaker"]) == track_id
        if not mine and turn["start"] <= t and t - turn["end"] <= TRIGGER_WINDOW_S:
            best = i
    return best


def detect_events(tracks: list[dict], turns: list[dict], speaker_to_track: dict) -> list[dict]:
    events: list[dict] = []
    for i, turn in enumerate(turns):
        m = NOTE_RE.search(turn["text"])
        if m:
            events.append({"type": "note", "level": "confirmed", "t": turn["start"], "duration_s": round(
                turn["end"] - turn["start"], 1), "track": speaker_to_track.get(turn["speaker"]),
                "speaker": turn["speaker"], "turn": i, "cue": "speech", "evidence": turn["text"]})
    confirmed = [(e["track"], e["t"]) for e in events]
    for tr in tracks:
        s = tr["series"]
        if len(s) < 5:
            continue
        pitch0 = _median(s, "pitch")
        down = [r["t"] for r in s if r["pitch"] < pitch0 - 15 or r["eyeLookDown"] > 0.5]
        cues = [("head_down", a, b) for a, b in _runs(down) if b - a + 1 >= NOTE_DOWN_S]
        if tr["detected_ratio"] >= 0.8:
            ts = [r["t"] for r in s]
            cues += [("face_lost", a + 1, b - 1) for a, b in zip(ts, ts[1:]) if b - a - 1 >= NOTE_DOWN_S]
        for cue, a, b in cues:
            if any(tid == tr["id"] and 0 <= a - ct <= 15 for tid, ct in confirmed):
                continue
            events.append({"type": "note", "level": "probable", "t": a, "duration_s": round(b - a + 1, 1),
                           "track": tr["id"], "speaker": None, "turn": _trigger(turns, a, tr["id"], speaker_to_track),
                           "cue": cue})
        for kind, key in REACTIONS.items():
            vals = [r[key] for r in s]
            med = float(median(vals))
            mad = max(1.4826 * float(median(abs(v - med) for v in vals)), 0.05)
            hot = [r["t"] for r in s if (r[key] - med) / mad >= 3 and r[key] - med >= 0.25]
            for a, b in _runs(hot):
                if b - a + 1 < MIN_REACTION_S:
                    continue
                peak = max(r[key] for r in s if a <= r["t"] <= b)
                events.append({"type": kind, "level": None, "t": a, "duration_s": round(b - a + 1, 1),
                               "track": tr["id"], "speaker": None, "intensity": round(peak - med, 3),
                               "after_turn": _trigger(turns, a, tr["id"], speaker_to_track)})
    for e in events:
        e.setdefault("reading", "indeterminate" if e["type"] == "note" else None)
    events.sort(key=lambda e: (e["t"], e["type"]))
    for k, e in enumerate(events, 1):
        e["id"] = f"e{k}"
    return events
