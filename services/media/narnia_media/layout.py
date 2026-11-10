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


# botões e abas das plataformas (pt e en): uma palavra só, com inicial maiúscula, como um primeiro nome
UI_WORDS = {
    w.casefold()
    for w in (
        "Chat Pessoas People Levantar Raise Reagir React Reações Reactions Exibição View Mais More Câmera Camera "
        "Microfone Microphone Mic Compartilhar Share Sair Leave Gravando Recording Participantes Participants Mudo Mute "
        "Unmute Apresentar Present Legendas Captions Detalhes Details Ferramentas Tools Atividades Activities Host "
        "Convidado Convidada Guest Você You Zoom Teams Meet Calendário Calendar Reunião Meeting Ativar Desativar "
        "Silenciar Gravar Record Entrar Join Configurações Settings Ajuda Help Pausar Pause Fechar Close Bate-papo"
    ).split()
}


def leftover_names(names: dict[str, str | None], samples: list[list[dict]], height: int | None = None) -> list[str]:
    """Nomes de etiqueta vistos em ≥ 2 amostras e que não ficaram com nenhum rosto (ex.: a miniatura pequena demais
    para o detector): a ligação dá a quem tem voz e não tem rosto, quando sobra um de cada. Um nome de uma palavra só
    ("Ana", comum na própria miniatura) conta se não for botão da plataforma e estiver abaixo da barra do topo."""
    taken = {n for n in names.values() if n}
    seen: Counter = Counter()
    for lines in samples:
        found = set()
        for x in lines:
            n = clean_name(x["text"]) if x.get("conf", 0) >= 50 else None
            if not n or n in taken:
                continue
            if len(n.split()) == 1:
                cy = x["bbox"][1] + x["bbox"][3] / 2
                if n.casefold() in UI_WORDS or height is None or cy < 0.12 * height:
                    continue
            found.add(n)
        seen.update(found)
    return sorted(n for n, k in seen.items() if k >= min(2, len(samples)))


def clean_name(text: str) -> str | None:
    words = " ".join(text.split()).split(" ")
    # ícone do microfone ou do status lido no fim da etiqueta ("Ana 8", "Ana &"): palavra sem letra ou de 1 caractere
    while len(words) > 1 and (len(words[-1]) == 1 or not any(c.isalpha() for c in words[-1])):
        words.pop()
    text = SUFFIX_RE.sub("", " ".join(words)).strip(" -|:")
    if not NAME_RE.match(text) or not 2 <= len(text) <= 60:
        return None
    # logotipos e botões costumam vir em maiúsculas ("ONE TEAM"); etiqueta de nome não
    if any(len(w) > 2 and w.isupper() for w in text.split()):
        return None
    # botões e abas da plataforma, sozinhos ou lidos juntos ("Levantar Reagir")
    if any(w.casefold() in UI_WORDS for w in text.split()):
        return None
    # lixo do OCR ("Ss", "Bi"): todo nome tem uma palavra de 3 letras ou mais
    if not any(sum(c.isalpha() for c in w) >= 3 for w in text.split()):
        return None
    return text


def assign_names(tracks: list[dict], samples: list[list[dict]]) -> dict[str, str | None]:
    """Nome de cada rosto: a etiqueta mais perto abaixo dele entre as que **se repetem** em 2 amostras ou mais (a
    etiqueta da chamada é fixa; o lixo do OCR, lido no fundo do vídeo, muda de quadro para quadro). Repetir é só
    filtro: um nome longo às vezes sai em menos amostras que o da miniatura e não pode perder por isso. Cada nome vai
    para um rosto só, começando pelo par mais perto."""
    need = min(2, len(samples))
    pairs = []
    for tr in tracks:
        x, y, w, h = tr["bbox"]
        cx, cy = x + w / 2, y + h / 2
        seen: Counter = Counter()
        dist: dict[str, float] = {}
        for lines in samples:
            here: dict[str, float] = {}
            for line in lines:
                name = clean_name(line["text"])
                if not name or line.get("conf", 0) < 50:
                    continue
                lx, ly, lw, lh = line["bbox"]
                dx, dy = (lx + lw / 2) - cx, (ly + lh / 2) - cy
                if dy <= 0 or dy > 4 * h + 40 or abs(dx) > 4 * w + 40:
                    continue
                d = (dx / max(w, 1)) ** 2 + (dy / max(h, 1)) ** 2
                here[name] = min(d, here.get(name, d))
            for name, d in here.items():
                seen[name] += 1
                dist[name] = min(d, dist.get(name, d))
        pairs += [(dist[n], -k, tr["id"], n) for n, k in seen.items() if k >= need]
    names: dict[str, str | None] = {tr["id"]: None for tr in tracks}
    used: set[str] = set()
    for _, _, tid, name in sorted(pairs):
        if names[tid] is None and name not in used:
            names[tid] = name
            used.add(name)
    return names
