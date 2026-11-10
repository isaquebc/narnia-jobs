"""API HTTP do serviço media (F13 §6.1.1, R1 e R4). Só a rede `media` (api e worker) chega aqui; JSON nas duas direções.

GET /health · PUT /token · DELETE /token · POST /runs · GET /runs/<id>
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import tokens
from . import backends as backends_mod
from .runner import INTERVIEW_ID_RE, Busy, Runner, find_video
from .steps import STEPS

VERSION = "0.1.0"
MAX_BODY = 64 * 1024


class MediaServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr, *, interviews_dir: Path, models_dir: Path, validate_token: tokens.Validator,
                 backends: object):
        super().__init__(addr, Handler)
        self.interviews_dir = interviews_dir
        self.models_dir = models_dir
        self.validate_token = validate_token
        self.runner = Runner(interviews_dir, models_dir, backends)
        self.backends_name = getattr(backends, "name", "real")


class Handler(BaseHTTPRequestHandler):
    server: MediaServer

    def log_message(self, fmt, *args):  # só método e caminho; corpo (token) nunca vai para o log
        print(f"media: {self.command} {self.path.split('?')[0]}", flush=True)

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status: int, code: str, message: str, **extra) -> None:
        self._send(status, {"error": code, "message": message, **extra})

    def _json(self) -> dict | None:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return None
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return None
        return body if isinstance(body, dict) else None

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {
                "ok": True,
                "version": VERSION,
                "token": tokens.has_token(self.server.models_dir),
                "busy": self.server.runner.busy(),
                "steps": list(STEPS),
                "backends": self.server.backends_name,
            })
        if self.path.startswith("/runs/"):
            path, _, query = self.path.partition("?")
            run = self.server.runner.runs.get(path[len("/runs/"):])
            if run is None:
                return self._error(404, "unknown_run", "Execução não encontrada.")
            # brief=1: sem os resultados (o worker lê os JSON da pasta; as etapas de rosto passam de alguns MB)
            hide = {"results"} if "brief=1" in query.split("&") else set()
            return self._send(200, {k: v for k, v in run.items() if not k.startswith("_") and k not in hide})
        self._error(404, "not_found", "Rota inexistente.")

    def do_PUT(self):
        if self.path != "/token":
            return self._error(404, "not_found", "Rota inexistente.")
        body = self._json() or {}
        token = body.get("token")
        if not isinstance(token, str) or not tokens.valid_format(token.strip()):
            return self._error(400, "invalid_token", "Isso não parece um token do Hugging Face (começa com hf_).")
        token = token.strip()
        problem = self.server.validate_token(token)
        if problem:
            return self._error(422, "token_rejected", problem)
        tokens.save_token(self.server.models_dir, token)
        self._send(200, {"configured": True})

    def do_DELETE(self):
        if self.path != "/token":
            return self._error(404, "not_found", "Rota inexistente.")
        tokens.delete_token(self.server.models_dir)
        self._send(200, {"configured": False})

    def do_POST(self):
        if self.path != "/runs":
            return self._error(404, "not_found", "Rota inexistente.")
        body = self._json()
        if body is None:
            return self._error(400, "invalid_body", "Corpo JSON inválido.")
        interview_id = body.get("interview_id")
        if not isinstance(interview_id, str) or not INTERVIEW_ID_RE.match(interview_id):
            return self._error(400, "invalid_interview_id", "Id de entrevista inválido.")
        steps = body.get("steps")
        if not isinstance(steps, list) or not steps or any(s not in STEPS for s in steps):
            return self._error(400, "unknown_step", f"Etapas válidas: {', '.join(STEPS)}.")
        if find_video(self.server.interviews_dir / interview_id) is None:
            return self._error(404, "no_video", "Não há vídeo para essa entrevista.")
        try:
            options = body.get("options") if isinstance(body.get("options"), dict) else {}
            run = self.server.runner.start(interview_id, steps, options)
        except Busy as busy:
            return self._error(409, "busy", "Já há uma análise em andamento.", run_id=busy.run_id)
        self._send(202, {"id": run["id"]})


def make_server(host: str, port: int, *, interviews_dir: Path, models_dir: Path,
                validate_token: tokens.Validator = tokens.validate_with_hub, backends: object = None) -> MediaServer:
    return MediaServer((host, port), interviews_dir=interviews_dir, models_dir=models_dir,
                       validate_token=validate_token, backends=backends or backends_mod.from_env(models_dir))
