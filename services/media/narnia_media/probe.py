"""Etapa 1 (F13 §2.2): validar o vídeo com ffprobe. Gravação do navegador (MediaRecorder, Teams pelo navegador) costuma
vir sem duração no cabeçalho: aí a duração sai dos pacotes, copiando os fluxos para o nada, sem decodificar."""

import json
import subprocess
from pathlib import Path


class StepError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _num(value) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _fps(rate: str | None) -> float | None:
    if not rate or "/" not in rate:
        return _num(rate)
    a, b = rate.split("/", 1)
    a_n, b_n = _num(a), _num(b)
    return round(a_n / b_n, 3) if a_n and b_n else None


def duration_from_packets(video: Path) -> float | None:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(video), "-map", "0", "-c", "copy",
         "-f", "null", "-progress", "pipe:1", "-nostats", "-"],
        capture_output=True, text=True, timeout=3600,
    )
    last = None
    for line in proc.stdout.splitlines():
        if line.startswith("out_time_us="):
            last = _num(line.split("=", 1)[1])
    return round(last / 1_000_000, 3) if last else None


def probe(video: Path) -> dict:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(video)],
        capture_output=True, text=True, timeout=300,
    )
    info = json.loads(proc.stdout or "{}") if proc.returncode == 0 else {}
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v and not a:
        raise StepError("invalid_video", "O arquivo não parece ser um vídeo ou áudio que o ffmpeg consiga ler.")
    duration = _num(info.get("format", {}).get("duration"))
    source = "header"
    if duration is None:
        duration = duration_from_packets(video)
        source = "packets"
    if duration is None:
        raise StepError("invalid_video", "Não consegui medir a duração do vídeo.")
    return {
        "duration": duration,
        "duration_source": source,
        "container": info.get("format", {}).get("format_name"),
        "size": int(info.get("format", {}).get("size") or video.stat().st_size),
        "video": v and {
            "codec": v.get("codec_name"),
            "width": v.get("width"),
            "height": v.get("height"),
            "fps": _fps(v.get("avg_frame_rate")) or _fps(v.get("r_frame_rate")),
        },
        "audio": a and {
            "codec": a.get("codec_name"),
            "sample_rate": int(a.get("sample_rate") or 0) or None,
            "channels": a.get("channels"),
        },
    }
