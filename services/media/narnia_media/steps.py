"""Etapas do `media` (F13 §2.2). Cada uma recebe o contexto da execução e devolve o JSON que o runner grava em
`work/<etapa>.json`; o que a etapa precisa das anteriores vem de `ctx.need`, que lê o resultado ou o arquivo."""

import json
import re
import subprocess
import wave
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import tokens, vision
from .events import detect_events, person_stats
from .layout import assign_names, leftover_names, track_faces
from .levels import measure_levels
from .link import link_speakers
from .selection import select_frames
from .probe import StepError, probe
from .turns import build_turns
from .voice import measure_voice

SAMPLE_RATE = 16_000


@dataclass
class Ctx:
    video: Path
    work: Path
    models_dir: Path
    backends: object
    options: dict = field(default_factory=dict)
    results: dict = field(default_factory=dict)
    report: Callable[[float], None] = lambda fraction: None

    def need(self, step: str) -> dict:
        if step not in self.results:
            path = self.work / f"{step}.json"
            if not path.is_file():
                raise StepError("missing_step", f"A etapa {step} precisa rodar antes.")
            self.results[step] = json.loads(path.read_text())
        return self.results[step]

    def wav(self) -> np.ndarray:
        self.need("audio")
        with wave.open(str(self.work / "audio.wav"), "rb") as f:
            raw = f.readframes(f.getnframes())
        return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def _lufs(path: Path) -> float | None:
    res = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True)
    found = re.findall(r"I:\s+(-?[\d.]+) LUFS", res.stderr)
    return float(found[-1]) if found else None


def step_audio(ctx: Ctx) -> dict:
    """Etapa 2: WAV 16 kHz mono para as etapas de voz."""
    out = ctx.work / "audio.wav"
    res = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(ctx.video), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
         "-c:a", "pcm_s16le", str(out)], capture_output=True, text=True)
    if res.returncode != 0 or not out.is_file():
        raise StepError("no_audio", "Não foi possível extrair o áudio do vídeo.")
    with wave.open(str(out), "rb") as f:
        seconds = f.getnframes() / f.getframerate()
    return {"file": out.name, "sample_rate": SAMPLE_RATE, "seconds": round(seconds, 3), "integrated_lufs": _lufs(out)}


def step_transcribe(ctx: Ctx) -> dict:
    """Etapa 3: palavras com tempo e confiança."""
    return ctx.backends.transcribe(ctx.wav(), SAMPLE_RATE, ctx.options.get("language"), ctx.report)


def step_diarize(ctx: Ctx) -> dict:
    """Etapa 4: quem fala quando. Sem token, nada aqui: a voz se liga ao rosto pela boca (M3) e a pessoa corrige."""
    token = tokens.read_token(ctx.models_dir)
    if not token:
        return {"method": "none", "turns": []}
    return {"method": "pyannote", "turns": ctx.backends.diarize(ctx.wav(), SAMPLE_RATE, token, ctx.report)}


def step_turns(ctx: Ctx) -> dict:
    words = ctx.need("transcribe")["words"]
    diar = ctx.need("diarize")
    return {"method": diar["method"], "turns": build_turns(words, diar["turns"])}


def _by_person(ctx: Ctx) -> list[dict]:
    """Turnos com a pessoa já resolvida pela ligação voz–rosto (P1, P2…) quando ela rodou; senão, pelo falante."""
    turns = ctx.need("turns")["turns"]
    if "link" not in ctx.results and not (ctx.work / "link.json").is_file():
        return turns
    persons = ctx.need("link")["turn_persons"]
    return [{**t, "speaker": p} for t, p in zip(turns, persons)]


def step_voice(ctx: Ctx) -> dict:
    """Etapa 5: ritmo, pausas, entonação, palavras de apoio (por pessoa quando a ligação voz–rosto já rodou)."""
    language = ctx.need("transcribe").get("language") or "pt"
    return measure_voice(_by_person(ctx), ctx.wav(), SAMPLE_RATE, language=language)


def step_levels(ctx: Ctx) -> dict:
    """Etapa 6: volume, ruído e saturação."""
    out = measure_levels(_by_person(ctx), ctx.wav(), SAMPLE_RATE)
    out["integrated_lufs"] = ctx.need("audio").get("integrated_lufs")
    return out


def _dims(ctx: Ctx) -> tuple[int, int, float]:
    p = ctx.need("probe")
    v = p.get("video") or {}
    if not v.get("width"):
        raise StepError("no_video_stream", "O arquivo não tem imagem: as etapas visuais não se aplicam.")
    return v["width"], v["height"], float(p.get("duration") or 0)


def step_faces(ctx: Ctx) -> dict:
    """Etapa 7: rostos por segundo (caixa, expressões, pose) e luz/nitidez de cada recorte."""
    width, height, duration = _dims(ctx)
    detect = ctx.backends.face_detector(duration)
    frames = []
    for t, rgb in vision.read_frames(ctx.video, width, height):
        frame_luma = float(vision.luma(rgb[::4, ::4].astype(np.float32)).mean())
        faces = detect(rgb, t)
        for f in faces:
            f.update(vision.crop_metrics(rgb, f["bbox"], frame_luma))
        frames.append({"t": t, "faces": faces})
        if duration:
            ctx.report(t / duration)
    w, h = vision.out_size(width, height)
    return {"fps": 1, "width": w, "height": h, "frames": frames}


def step_layout(ctx: Ctx) -> dict:
    """Etapa 8: pessoas pela posição na tela e nomes pelas etiquetas. Antes da primeira fala (sala de espera) fica de
    fora."""
    faces = ctx.need("faces")
    turns = ctx.need("turns")["turns"]
    start = max(0.0, turns[0]["start"] - 2.0) if turns else 0.0
    frames = [f for f in faces["frames"] if f["t"] >= start]
    tracks = track_faces(frames, faces["width"], faces["height"])
    width, height, _ = _dims(ctx)
    samples = []
    span = [f["t"] for f in frames] or [0.0]
    for k in range(6):
        t = span[0] + (span[-1] - span[0]) * (k + 0.5) / 6
        rgb = vision.frame_at(ctx.video, t, width, height)
        if rgb is not None:
            samples.append(ctx.backends.ocr(rgb))
        ctx.report((k + 1) / 6)
    names = assign_names(tracks, samples)
    return {"meeting_start_s": round(start, 1), "width": faces["width"], "height": faces["height"],
            "tracks": tracks, "names": names, "leftover_names": leftover_names(names, samples)}


def step_link(ctx: Ctx) -> dict:
    """Etapa 9: pessoa = rosto + voz + nome. Ambíguo vai para a confirmação do usuário."""
    layout = ctx.need("layout")
    turns = ctx.need("turns")["turns"]
    link = link_speakers(layout["tracks"], turns)
    persons, by_track, by_speaker = [], {}, {}
    for tr in layout["tracks"]:
        pid = f"P{len(persons) + 1}"
        speaker = next((s for s, t in link["speaker_to_track"].items() if t == tr["id"]), None)
        name = layout["names"].get(tr["id"])
        persons.append({"id": pid, "track": tr["id"], "speaker": speaker, "name": name,
                        "name_source": "ocr" if name else None,
                        "confidence": link["confidence"].get(speaker) if speaker else None,
                        "ambiguous": speaker in link["ambiguous"] if speaker else False})
        by_track[tr["id"]] = pid
        if speaker:
            by_speaker[speaker] = pid
    faceless = sorted({t["speaker"] for t in turns if t["speaker"]} - set(by_speaker))
    spare = layout.get("leftover_names", [])
    for spk in faceless:
        pid = f"P{len(persons) + 1}"
        # um nome sobrando e uma voz sem rosto: é ela (miniatura que o detector não pega)
        name = spare[0] if len(spare) == 1 and len(faceless) == 1 else None
        persons.append({"id": pid, "track": None, "speaker": spk, "name": name,
                        "name_source": "ocr" if name else None, "confidence": None, "ambiguous": True})
        by_speaker[spk] = pid
    if link["approximate"]:
        turn_persons = [by_track.get(t) for t in link["turn_tracks"]]
    else:
        turn_persons = [by_speaker.get(t["speaker"]) for t in turns]
    return {"approximate": link["approximate"], "persons": persons, "turn_persons": turn_persons}


def step_events(ctx: Ctx) -> dict:
    """Etapa 10: reações e anotações por pessoa, e as medições de rosto, câmera e luz com a confiabilidade."""
    layout = ctx.need("layout")
    link = ctx.need("link")
    turns = ctx.need("turns")["turns"]
    person_of_track = {p["track"]: p["id"] for p in link["persons"] if p["track"]}
    track_of_person = {v: k for k, v in person_of_track.items()}
    # turnos com a pessoa já resolvida (inclusive na aproximação sem token)
    resolved = [{**t, "speaker": pid} for t, pid in zip(turns, link["turn_persons"])]
    events = detect_events(layout["tracks"], resolved, {pid: track_of_person.get(pid) for pid in
                                                        {p["id"] for p in link["persons"]}})
    for e in events:
        e["person"] = person_of_track.get(e.get("track")) or e.get("speaker")
    stats = {person_of_track[tr["id"]]: person_stats(tr) for tr in layout["tracks"] if tr["id"] in person_of_track}
    return {"events": events, "persons": stats}


def step_frames(ctx: Ctx) -> dict:
    """Etapa 11: até 40 quadros (JPEG em work/frames), os únicos que vão ao modelo."""
    layout = ctx.need("layout")
    ev = ctx.need("events")
    link = ctx.need("link")
    person_of_track = {p["track"]: p["id"] for p in link["persons"] if p["track"]}
    out_dir = ctx.work / "frames"
    out_dir.mkdir(exist_ok=True)
    chosen = select_frames(ev["events"], layout["tracks"])
    frames = []
    for k, f in enumerate(chosen):
        name = f"f{k + 1:02d}-{int(f['t'] * 10):06d}.jpg"
        if vision.save_jpeg(ctx.video, f["t"], out_dir / name):
            frames.append({**f, "file": name, "person": person_of_track.get(f.get("track"))})
        ctx.report((k + 1) / max(1, len(chosen)))
    return {"frames": frames}


# de quais etapas cada uma lê o resultado; refazer uma refaz as que dependem dela (o arquivo da dependência fica mais
# novo que o dela)
DEPS: dict[str, list[str]] = {
    "probe": [],
    "audio": [],
    "transcribe": ["audio"],
    "diarize": ["audio"],
    "turns": ["transcribe", "diarize"],
    "voice": ["transcribe", "turns", "link"],
    "levels": ["audio", "turns", "link"],
    "faces": ["probe"],
    "layout": ["faces", "turns"],
    "link": ["layout", "turns"],
    "events": ["layout", "link", "turns"],
    "frames": ["layout", "events", "link"],
}


def outdated(name: str, ctx: Ctx) -> bool:
    """A etapa precisa rodar: sem resultado, separação de vozes feita sem token que agora existe, ou uma dependência
    refeita depois dela."""
    out = ctx.work / f"{name}.json"
    if not out.is_file():
        return True
    if name == "diarize" and tokens.has_token(ctx.models_dir):
        if json.loads(out.read_text()).get("method") == "none":
            return True
    mtime = out.stat().st_mtime_ns
    for dep in DEPS.get(name, []):
        p = ctx.work / f"{dep}.json"
        if p.is_file() and p.stat().st_mtime_ns > mtime:
            return True
    return False


STEPS: dict[str, Callable[[Ctx], dict]] = {
    "probe": lambda ctx: probe(ctx.video),
    "audio": step_audio,
    "transcribe": step_transcribe,
    "diarize": step_diarize,
    "turns": step_turns,
    "voice": step_voice,
    "levels": step_levels,
    "faces": step_faces,
    "layout": step_layout,
    "link": step_link,
    "events": step_events,
    "frames": step_frames,
}
