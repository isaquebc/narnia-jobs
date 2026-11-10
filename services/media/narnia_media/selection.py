"""Etapa 11 (F13/M3): no máximo ~40 quadros, os únicos que vão ao modelo (F13-7). Anotações primeiro, depois as
reações mais fortes, e um quadro de referência por pessoa (expressão neutra, câmera e luz)."""

from statistics import median

PRIORITY = {("note", "confirmed"): 0, ("note", "probable"): 1}


def select_frames(events: list[dict], tracks: list[dict], *, limit: int = 40) -> list[dict]:
    refs = []
    for tr in tracks:
        if tr["series"]:
            ts = sorted(r["t"] for r in tr["series"])
            refs.append({"t": float(ts[len(ts) // 2]), "reason": "reference", "events": [], "track": tr["id"]})
    refs = refs[: max(0, limit // 4)]
    ranked = sorted(events, key=lambda e: (PRIORITY.get((e["type"], e.get("level")), 2), -e.get("intensity", 0),
                                           e["t"]))
    chosen: list[dict] = []
    for e in ranked:
        if len(chosen) >= limit - len(refs):
            break
        t = float(e["t"]) + (min(1.0, e.get("duration_s", 0) / 2) if e["type"] != "note" else 0.0)
        near = next((c for c in chosen if abs(c["t"] - t) < 1.0), None)
        if near:
            near["events"].append(e["id"])
            continue
        chosen.append({"t": round(t, 2), "reason": "event", "events": [e["id"]], "track": e.get("track")})
    return chosen + refs


def median_time(track: dict) -> float:
    return float(median(r["t"] for r in track["series"]))
