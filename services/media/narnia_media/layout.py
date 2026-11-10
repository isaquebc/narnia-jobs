"""Etapa 8 (F13/M3): rostos → pessoas e nomes pelas etiquetas da chamada.

Em Teams, Meet e Zoom cada pessoa fica num lugar fixo da tela (grade, destaque ou miniatura): os rostos se agrupam pela
posição. O nome vem do OCR da etiqueta mais próxima abaixo do rosto, nunca do rosto (MediaPipe não reconhece pessoas).
"""

import re
from collections import Counter
from statistics import median

FEATURES = ("smile", "jawOpen", "browUp", "browDown", "eyeLookDown")
NAME_RE = re.compile(r"^[A-ZÀ-Ý][\wÀ-ÿ'.-]*( (de|da|do|dos|das|e|[A-ZÀ-Ý][\wÀ-ÿ'.-]*)){0,5}$")
SUFFIX_RE = re.compile(r"\s*\((convidad[oa]|guest|extern[oa]|external|unverified|não verificado|host|organizador[a]?|"
                       r"você|you|me)\)\s*$", re.I)


def track_faces(frames: list[dict], width: int, height: int, *, max_dist: float = 0.08) -> list[dict]:
    raw: list[dict] = []
    for fr in frames:
        used: set[int] = set()
        for f in fr["faces"]:
            x, y, w, h = f["bbox"]
            cx, cy = (x + w / 2) / width, (y + h / 2) / height
            best, best_d = None, max_dist
            for i, tr in enumerate(raw):
                if i in used:
                    continue
                d = ((tr["cx"] - cx) ** 2 + (tr["cy"] - cy) ** 2) ** 0.5
                if d < best_d:
                    best, best_d = i, d
            if best is None:
                raw.append({"cx": cx, "cy": cy, "n": 0, "faces": []})
                best = len(raw) - 1
            tr = raw[best]
            used.add(best)
            tr["n"] += 1
            tr["cx"] += (cx - tr["cx"]) / tr["n"]
            tr["cy"] += (cy - tr["cy"]) / tr["n"]
            tr["faces"].append((fr["t"], f))
    raw = _merge_split(raw)
    total = len(frames) or 1
    keep = [tr for tr in raw if tr["n"] >= max(3, 0.02 * total)]
    keep.sort(key=lambda tr: (-tr["n"], tr["cx"]))
    tracks = []
    for k, tr in enumerate(keep, 1):
        faces = [f for _, f in tr["faces"]]
        series = []
        for t, f in tr["faces"]:
            row = {"t": t, **{key: round(float(f["blend"].get(key, 0.0)), 3) for key in FEATURES},
                   "pitch": f["pose"]["pitch"], "yaw": f["pose"]["yaw"]}
            for key in ("luma", "contrast", "sharpness", "frame_luma"):
                if key in f:
                    row[key] = f[key]
            series.append(row)
        tracks.append({
            "id": f"T{k}",
            "bbox": [round(median(f["bbox"][i] for f in faces)) for i in range(4)],
            "face_px": round(median(max(f["bbox"][2], f["bbox"][3]) for f in faces)),
            "detected_ratio": round(tr["n"] / total, 3),
            "frames_total": total,
            "series": series,
        })
    return tracks


def _iou(a: list[float], b: list[float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / (aw * ah + bw * bh - inter) if inter else 0.0


def _merge_split(raw: list[dict]) -> list[dict]:
    """Cabeça baixa ou de lado desloca a caixa do rosto e abre outro grupo: grupos que se sobrepõem na tela e nunca
    aparecem no mesmo quadro são a mesma pessoa. Pessoas lado a lado aparecem juntas e não se fundem."""
    def box(tr):
        return [median(f["bbox"][i] for _, f in tr["faces"]) for i in range(4)]

    merged = True
    while merged:
        merged = False
        raw.sort(key=lambda tr: -tr["n"])
        for i, a in enumerate(raw):
            ta = {t for t, _ in a["faces"]}
            for b in raw[i + 1 :]:
                tb = {t for t, _ in b["faces"]}
                together = len(ta & tb)
                if _iou(box(a), box(b)) > 0.2 and together <= 0.05 * min(len(ta), len(tb)):
                    a["faces"] = sorted(a["faces"] + [x for x in b["faces"] if x[0] not in ta], key=lambda x: x[0])
                    a["n"] = len(a["faces"])
                    raw.remove(b)
                    merged = True
                    break
            if merged:
                break
    return raw


def leftover_names(names: dict[str, str | None], samples: list[list[dict]]) -> list[str]:
    """Nomes de etiqueta vistos em ≥ 2 amostras e que não ficaram com nenhum rosto (ex.: a miniatura pequena demais
    para o detector): a ligação dá a quem tem voz e não tem rosto, quando sobra um de cada."""
    taken = {n for n in names.values() if n}
    seen: Counter = Counter()
    for lines in samples:
        found = {clean_name(x["text"]) for x in lines if x.get("conf", 0) >= 50}
        seen.update(n for n in found if n and n not in taken and len(n.split()) >= 2)
    return sorted(n for n, k in seen.items() if k >= min(2, len(samples)))


def clean_name(text: str) -> str | None:
    text = SUFFIX_RE.sub("", " ".join(text.split())).strip(" -|:")
    if not NAME_RE.match(text) or not 2 <= len(text) <= 60:
        return None
    # logotipos e botões costumam vir em maiúsculas ("ONE TEAM"); etiqueta de nome não
    if any(len(w) > 2 and w.isupper() for w in text.split()):
        return None
    return text


def assign_names(tracks: list[dict], samples: list[list[dict]]) -> dict[str, str | None]:
    names: dict[str, str | None] = {}
    for tr in tracks:
        x, y, w, h = tr["bbox"]
        cx, cy = x + w / 2, y + h / 2
        votes: Counter = Counter()
        for lines in samples:
            best, best_d = None, None
            for line in lines:
                name = clean_name(line["text"])
                if not name or line.get("conf", 0) < 50:
                    continue
                lx, ly, lw, lh = line["bbox"]
                dx, dy = (lx + lw / 2) - cx, (ly + lh / 2) - cy
                if dy <= 0 or dy > 4 * h + 40 or abs(dx) > 4 * w + 40:
                    continue
                d = (dx / max(w, 1)) ** 2 + (dy / max(h, 1)) ** 2
                if best_d is None or d < best_d:
                    best, best_d = name, d
            if best:
                votes[best] += 1
        names[tr["id"]] = votes.most_common(1)[0][0] if votes else None
    return names
