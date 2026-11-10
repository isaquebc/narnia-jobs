"""Execuções (R1): uma por vez, numa thread; cada etapa grava `interviews/<id>/work/<etapa>.json` e é pulada ao retomar."""

import json
import re
import threading
import traceback
import uuid
from pathlib import Path

from .probe import StepError
from .steps import STEP_VERSION, STEPS, Ctx, outdated

INTERVIEW_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
VIDEO_PREFIX = "video."


def find_video(folder: Path) -> Path | None:
    """O vídeo final (`video.<ext>`); a parte em envio (`video.part`) não conta."""
    if not folder.is_dir():
        return None
    for f in sorted(folder.iterdir()):
        if f.is_file() and f.name.startswith(VIDEO_PREFIX) and f.suffix != ".part":
            return f
    return None


class Busy(Exception):
    def __init__(self, run_id: str):
        super().__init__(run_id)
        self.run_id = run_id


class Runner:
    def __init__(self, interviews_dir: Path, models_dir: Path | None = None, backends: object = None):
        self.interviews_dir = interviews_dir
        self.models_dir = models_dir or interviews_dir
        self.backends = backends
        self.runs: dict[str, dict] = {}
        self.current: str | None = None
        self.lock = threading.Lock()
        self.hold = threading.Event()  # testes seguram a execução no início
        self.hold.set()

    def busy(self) -> bool:
        return self.current is not None

    def start(self, interview_id: str, steps: list[str], options: dict | None = None) -> dict:
        with self.lock:
            if self.current:
                raise Busy(self.current)
            run = {
                "id": uuid.uuid4().hex,
                "interview_id": interview_id,
                "steps": steps,
                "options": options or {},
                "state": "running",
                "step": None,
                "progress": 0,
                "step_progress": 0,
                "results": {},
                "skipped": [],
                "error": None,
            }
            self.runs[run["id"]] = run
            self.current = run["id"]
        threading.Thread(target=self._run, args=(run,), daemon=True).start()
        return run

    def _run(self, run: dict) -> None:
        self.hold.wait()
        folder = self.interviews_dir / run["interview_id"]
        work = folder / "work"
        try:
            video = find_video(folder)
            if video is None:
                raise StepError("no_video", "O vídeo da entrevista não está mais na pasta.")
            work.mkdir(exist_ok=True)
            total = len(run["steps"])

            def report(fraction: float) -> None:
                run["step_progress"] = round(100 * max(0.0, min(1.0, fraction)))
                run["progress"] = round(100 * (run["_index"] + max(0.0, min(1.0, fraction))) / total)

            ctx = Ctx(video=video, work=work, models_dir=self.models_dir, backends=self.backends,
                      options=run["options"], results=run["results"], report=report)
            for i, name in enumerate(run["steps"]):
                run["step"] = name
                run["_index"] = i
                run["step_progress"] = 0
                out = work / f"{name}.json"
                if not outdated(name, ctx):
                    run["results"][name] = json.loads(out.read_text())
                    run["skipped"].append(name)
                else:
                    result = {**STEPS[name](ctx), "_v": STEP_VERSION.get(name, 1)}
                    tmp = out.with_suffix(".tmp")
                    tmp.write_text(json.dumps(result, ensure_ascii=False))
                    tmp.replace(out)
                    run["results"][name] = result
                run["progress"] = round(100 * (i + 1) / total)
                run["step_progress"] = 100
            run["state"] = "done"
        except StepError as err:
            run["state"] = "failed"
            run["error"] = {"code": err.code, "message": err.message, "step": run["step"]}
        except Exception as err:  # noqa: BLE001 — a execução nunca derruba o serviço
            traceback.print_exc()
            run["state"] = "failed"
            run["error"] = {"code": "step_failed", "message": type(err).__name__, "step": run["step"]}
        finally:
            with self.lock:
                self.current = None
