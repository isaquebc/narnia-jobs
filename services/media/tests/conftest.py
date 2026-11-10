"""Fixtures do serviço media (F13/M1.1): vídeo sintético gerado pelo ffmpeg, nunca gravação real (F13 §6.4)."""

import json
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from narnia_media.server import make_server


def make_video(path: Path, seconds: int = 3, *, seekable: bool = True) -> Path:
    """WebM com vídeo (testsrc) e áudio (seno). `seekable=False` escreve num pipe, como o MediaRecorder do navegador:
    o muxer não volta ao cabeçalho, então o arquivo sai sem duração."""
    path.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc=size=160x120:rate=10:duration={seconds}",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
        "-c:v", "libvpx", "-b:v", "100k", "-c:a", "libopus", "-shortest",
    ]
    if seekable:
        subprocess.run([*args, str(path)], check=True)
    else:
        with path.open("wb") as out:
            subprocess.run([*args, "-f", "webm", "pipe:1"], check=True, stdout=out)
    return path


class Client:
    def __init__(self, base: str):
        self.base = base

    def call(self, method: str, path: str, body: object | None = None) -> tuple[int, dict]:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")


@pytest.fixture
def media(tmp_path):
    """Servidor numa porta livre, com pastas temporárias e validação do token injetada (sem rede)."""
    interviews = tmp_path / "interviews"
    models = tmp_path / "models"
    interviews.mkdir()
    models.mkdir()
    checked: list[str] = []

    def validate(token: str) -> str | None:
        checked.append(token)
        return None if token.startswith("hf_ok") else "Token recusado pelo Hugging Face."

    server = make_server("127.0.0.1", 0, interviews_dir=interviews, models_dir=models, validate_token=validate)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    client = Client(f"http://127.0.0.1:{server.server_address[1]}")
    client.interviews = interviews
    client.models = models
    client.server = server
    client.checked = checked
    yield client
    server.shutdown()
    server.server_close()
