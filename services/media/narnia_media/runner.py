"""Execuções (R1): uma por vez, numa thread; cada etapa grava `interviews/<id>/work/<etapa>.json` e é pulada ao retomar."""

import json
import re
import threading
import traceback
import uuid
from collections.abc import Callable
from pathlib import Path

from .probe import StepError, probe

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


StepFn = Callable[[Path, Path, dict], dict]

STEPS: dict[str, StepFn] = {
    "probe": lambda video, work, results: probe(video),
}


class Busy(Exception):
    def __init__(self, run_id: str):
        super().__init__(run_id)
        self.run_id = run_id


class Runner:
    def __init__(self, interviews_dir: Path):
        self.interviews_dir = interviews_dir
        self.runs: dict[str, dict] = {}
        self.current: str | None = None
        self.lock = threading.Lock()
        self.hold = threading.Event()  # testes seguram a execução no início
        self.hold.set()

    def busy(self) -> bool:
        return self.current is not None

    def start(self, interview_id: str, steps: list[str]) -> dict:
        with self.lock:
            if self.current:
                raise Busy(self.current)
            run = {
                "id": uuid.uuid4().hex,
                "interview_id": interview_id,
                "steps": steps,
                "state": "running",
                "step": None,
                "progress": 0,
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
            for i, name in enumerate(run["steps"]):
                run["step"] = name
                out = work / f"{name}.json"
                if out.is_file():
                    run["results"][name] = json.loads(out.read_text())
                    run["skipped"].append(name)
                else:
                    result = STEPS[name](video, work, run["results"])
                    tmp = out.with_suffix(".tmp")
                    tmp.write_text(json.dumps(result, ensure_ascii=False))
                    tmp.replace(out)
                    run["results"][name] = result
                run["progress"] = round(100 * (i + 1) / len(run["steps"]))
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
