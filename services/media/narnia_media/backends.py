"""Modelos das etapas (F13/M2): reais (faster-whisper, pyannote), importados só quando usados, ou falsos
(`NARNIA_MEDIA_FAKE=1`), com a entrevista sintética de `fake_script`, para testes e e2e sem baixar modelos."""

import os
from collections.abc import Callable
from pathlib import Path

import numpy as np

from . import fake_script
from .probe import StepError

Progress = Callable[[float], None]

DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"
FACE_MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/"
                  "face_landmarker.task")


def _pose(matrix) -> dict:
    """Ângulos da cabeça (graus) a partir da matriz de transformação do MediaPipe; pitch negativo = cabeça baixa."""
    import math

    r = np.asarray(matrix)[:3, :3]
    pitch = math.degrees(math.atan2(r[2, 1], r[2, 2]))
    yaw = math.degrees(math.asin(max(-1.0, min(1.0, -r[2, 0]))))
    roll = math.degrees(math.atan2(r[1, 0], r[0, 0]))
    return {"yaw": round(yaw, 1), "pitch": round(pitch, 1), "roll": round(roll, 1)}


def _blend(categories) -> dict:
    b = {c.category_name: float(c.score) for c in categories}
    pair = lambda a: (b.get(f"{a}Left", 0.0) + b.get(f"{a}Right", 0.0)) / 2  # noqa: E731
    return {"smile": round(pair("mouthSmile"), 3), "jawOpen": round(b.get("jawOpen", 0.0), 3),
            "browUp": round(max(b.get("browInnerUp", 0.0), pair("browOuterUp")), 3),
            "browDown": round(pair("browDown"), 3), "eyeLookDown": round(pair("eyeLookDown"), 3),
            "eyeBlink": round(pair("eyeBlink"), 3)}


class RealBackends:
    name = "real"

    def __init__(self, models_dir: Path):
        self.models_dir = models_dir
        self.whisper_model = os.environ.get("NARNIA_MEDIA_WHISPER_MODEL", "large-v3")

    def _device(self) -> str:
        try:
            import torch

            return "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            return "cpu"

    def transcribe(self, wav: np.ndarray, sr: int, language: str | None, progress: Progress) -> dict:
        from faster_whisper import WhisperModel

        device = self._device()
        model = WhisperModel(
            self.whisper_model,
            device=device,
            compute_type="float16" if device == "cuda" else "int8",
            cpu_threads=os.cpu_count() or 4,
            download_root=str(self.models_dir / "whisper"),
        )
        duration = len(wav) / sr or 1.0
        # áudio já em memória: o PyAV do faster-whisper quebrava ao decodificar gravações do Teams (F13 §8).
        # Sem idioma fixo, detecta o idioma em cada trecho: entrevista que passa para o inglês sai em inglês, não
        # "traduzida" para o idioma do começo.
        segments, info = model.transcribe(
            wav, language=language, multilingual=language is None, word_timestamps=True, vad_filter=True,
            beam_size=5,
        )
        words = []
        for seg in segments:
            for x in seg.words or []:
                words.append({"w": x.word.strip(), "start": round(x.start, 3), "end": round(x.end, 3),
                              "p": round(x.probability, 3)})
            progress(min(1.0, seg.end / duration))
        return {"model": f"faster-whisper {self.whisper_model}", "device": device,
                "language": info.language, "language_probability": round(info.language_probability, 3),
                "multilingual": language is None, "words": words}

    def diarize(self, wav: np.ndarray, sr: int, token: str, progress: Progress) -> list[dict]:
        import torch
        from pyannote.audio import Pipeline

        try:
            pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL, token=token, cache_dir=str(self.models_dir / "hf"))
        except Exception as err:  # noqa: BLE001 — a mensagem do HF pode citar o token: nunca repassar o texto
            raise StepError(
                "diarization_denied",
                "Não foi possível baixar o modelo de separação de vozes. Confira se o token ainda vale e se a conta "
                f"aceitou os termos de {DIARIZATION_MODEL} ({type(err).__name__}).",
            ) from None
        if self._device() == "cuda":
            pipeline.to(torch.device("cuda"))

        def hook(step_name, step_artifact, file=None, total=None, completed=None):
            if total and completed is not None:
                progress(min(1.0, completed / total))

        out = pipeline({"waveform": torch.from_numpy(wav)[None], "sample_rate": sr}, hook=hook)
        annotation = getattr(out, "exclusive_speaker_diarization", None) or getattr(out, "speaker_diarization", out)
        return [{"speaker": label, "start": round(seg.start, 3), "end": round(seg.end, 3)}
                for seg, _, label in annotation.itertracks(yield_label=True)]


    def face_detector(self, duration: float):
        import urllib.request

        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        model = self.models_dir / "mediapipe" / "face_landmarker.task"
        if not model.is_file():
            model.parent.mkdir(parents=True, exist_ok=True)
            tmp = model.with_suffix(".tmp")
            urllib.request.urlretrieve(FACE_MODEL_URL, tmp)
            tmp.replace(model)
        landmarker = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model)), num_faces=8,
            min_face_detection_confidence=0.3, min_face_presence_confidence=0.3,
            output_face_blendshapes=True, output_facial_transformation_matrixes=True))

        def detect(rgb: np.ndarray, t: float) -> list[dict]:
            h, w = rgb.shape[:2]
            res = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
            faces = []
            for i, lm in enumerate(res.face_landmarks):
                xs = [p.x for p in lm]
                ys = [p.y for p in lm]
                x0, y0 = max(0, int(min(xs) * w)), max(0, int(min(ys) * h))
                faces.append({"bbox": [x0, y0, int(max(xs) * w) - x0, int(max(ys) * h) - y0],
                              "blend": _blend(res.face_blendshapes[i]) if res.face_blendshapes else {},
                              "pose": _pose(res.facial_transformation_matrixes[i])
                              if res.facial_transformation_matrixes else {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}})
            return faces

        return detect

    def ocr(self, rgb: np.ndarray) -> list[dict]:
        """Linhas de texto com caixa, pelo Tesseract (CLI). A etiqueta de nome do Teams tem ~11 px de altura: no quadro
        inteiro o Tesseract não lê (fundo poluído, letra miúda); em faixas horizontais, cinza e ampliadas 3×, lê com
        ~95% de confiança (teste com gravação real, F13 §8)."""
        import subprocess
        from concurrent.futures import ThreadPoolExecutor

        import cv2

        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))

        def variants(big: np.ndarray) -> list[np.ndarray]:
            # cinza: texto claro em caixa escura (Teams). Top-hat: só os traços claros e finos, invertidos, para texto
            # branco sem caixa em fundo claro (Meet, etiqueta sobre a parede do vídeo; teste com gravação real, F13 §8)
            top = cv2.morphologyEx(big, cv2.MORPH_TOPHAT, kernel)
            return [big, 255 - cv2.normalize(top, None, 0, 255, cv2.NORM_MINMAX)]

        def read(job: tuple[int, np.ndarray]) -> tuple[int, list[dict]]:
            y0, im = job
            ok, png = cv2.imencode(".png", im)
            if not ok:
                return y0, []
            res = subprocess.run(["tesseract", "stdin", "stdout", "-l", "por+eng", "--psm", "11", "tsv"],
                                 input=png.tobytes(), capture_output=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
            return y0, parse_tsv(res.stdout.decode("utf-8", "replace"), scale=OCR_SCALE)

        jobs = []
        for y0, y1 in ocr_bands(gray.shape[0]):
            big = cv2.resize(gray[y0:y1], None, fx=OCR_SCALE, fy=OCR_SCALE, interpolation=cv2.INTER_CUBIC)
            jobs += [(y0, im) for im in variants(big)]
        with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 2)) as pool:
            return merge_band_lines(list(pool.map(read, jobs)))


OCR_SCALE = 3


def ocr_bands(height: int, frac: float = 0.12) -> list[tuple[int, int]]:
    """Faixas horizontais de ~12% da altura, sobrepostas pela metade: uma etiqueta sempre cabe inteira em uma delas."""
    size = max(32, int(height * frac))
    step = max(1, size // 2)
    out = []
    y = 0
    while True:
        end = min(height, y + size)
        out.append((y, end))
        if end >= height:
            return out
        y += step


def merge_band_lines(bands: list[tuple[int, list[dict]]]) -> list[dict]:
    """Volta cada linha para a coordenada do quadro e junta o mesmo lugar lido duas vezes (duas faixas ou duas
    leituras da mesma faixa): fica a de maior confiança, mesmo com texto diferente ("Narta" × "Marta")."""
    out: list[dict] = []
    for y0, lines in bands:
        for line in lines:
            x, y, w, h = line["bbox"]
            moved = {**line, "bbox": [x, y + y0, w, h]}
            same = next((i for i, o in enumerate(out) if _overlap(o["bbox"], moved["bbox"]) > 0.5), None)
            if same is None:
                out.append(moved)
            elif moved["conf"] > out[same]["conf"]:
                out[same] = moved
    return out


def _overlap(a: list, b: list) -> float:
    """Interseção sobre a menor das duas caixas."""
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    small = min(a[2] * a[3], b[2] * b[3]) or 1
    return ix * iy / small


def parse_tsv(tsv: str, scale: float = 1.0) -> list[dict]:
    lines: dict[tuple, dict] = {}
    for row in tsv.splitlines()[1:]:
        cols = row.split("\t")
        if len(cols) < 12 or not cols[11].strip():
            continue
        try:
            conf = float(cols[10])
        except ValueError:
            continue
        if conf < 0:
            continue
        key = (cols[1], cols[2], cols[3], cols[4])
        x, y, w, h = (int(c) / scale for c in cols[6:10])
        cur = lines.setdefault(key, {"words": [], "conf": [], "box": [x, y, x + w, y + h]})
        cur["words"].append(cols[11].strip())
        cur["conf"].append(conf)
        b = cur["box"]
        cur["box"] = [min(b[0], x), min(b[1], y), max(b[2], x + w), max(b[3], y + h)]
    return [{"text": " ".join(v["words"]), "conf": round(sum(v["conf"]) / len(v["conf"]), 1),
             "bbox": [round(v["box"][0]), round(v["box"][1]), round(v["box"][2] - v["box"][0]),
                      round(v["box"][3] - v["box"][1])]} for v in lines.values()]


class FakeBackends:
    name = "fake"

    def transcribe(self, wav: np.ndarray, sr: int, language: str | None, progress: Progress) -> dict:
        progress(1.0)
        words = [w for t in fake_script.timeline(len(wav) / sr) for w in t["words"]]
        return {"model": "fake", "device": "cpu", "language": "pt", "language_probability": 1.0,
                "multilingual": language is None, "words": words}

    def diarize(self, wav: np.ndarray, sr: int, token: str, progress: Progress) -> list[dict]:
        progress(1.0)
        return [{"speaker": t["speaker"], "start": t["start"], "end": t["end"] + 0.2}
                for t in fake_script.timeline(len(wav) / sr)]


    def face_detector(self, duration: float):
        """Duas pessoas: quem entrevista em destaque à esquerda, quem é entrevistado em miniatura no alto à direita (o
        caso real do teste de viabilidade). Boca mexe nos turnos de cada uma; cabeça baixa na resposta errada (anotação
        provável); sobrancelha franzida depois da resposta vaga sobre qualidade."""
        timeline = fake_script.timeline(duration)

        def speaking(speaker: str, t: float) -> bool:
            return any(x["speaker"] == speaker and x["start"] <= t <= x["end"] for x in timeline)

        wrong, vague = timeline[3], timeline[10]

        def detect(rgb: np.ndarray, t: float) -> list[dict]:
            h, w = rgb.shape[:2]
            k = int(t)
            big = {"bbox": [int(w * 0.25), int(h * 0.2), int(w * 0.3), int(h * 0.45)],
                   "blend": {"smile": 0.3, "jawOpen": 0.45 if speaking(fake_script.INTERVIEWER, t) and k % 2 else 0.05,
                             "browUp": 0.1, "browDown": 0.65 if vague["end"] < t <= vague["end"] + 3 else 0.05,
                             "eyeLookDown": 0.7 if wrong["start"] <= t <= wrong["start"] + 5 else 0.1},
                   "pose": {"yaw": 0.0, "pitch": -25.0 if wrong["start"] <= t <= wrong["start"] + 5 else 0.0,
                            "roll": 0.0}}
            small = {"bbox": [int(w * 0.85), int(h * 0.05), max(2, int(w * 0.05)), max(2, int(h * 0.08))],
                     "blend": {"smile": 0.05, "jawOpen": 0.4 if speaking(fake_script.CANDIDATE, t) and k % 2 else 0.04,
                               "browUp": 0.1, "browDown": 0.05, "eyeLookDown": 0.1},
                     "pose": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}}
            return [big] if k % 2 == 0 and k % 3 == 0 else [big, small]  # miniatura detectada só parte do tempo

        return detect

    def ocr(self, rgb: np.ndarray) -> list[dict]:
        h, w = rgb.shape[:2]
        return [
            {"text": fake_script.NAMES[fake_script.INTERVIEWER], "conf": 90,
             "bbox": [int(w * 0.25), int(h * 0.7), int(w * 0.2), max(2, int(h * 0.04))]},
            {"text": f"{fake_script.NAMES[fake_script.CANDIDATE]} (Convidado)", "conf": 85,
             "bbox": [int(w * 0.84), int(h * 0.15), int(w * 0.12), max(2, int(h * 0.03))]},
        ]


def from_env(models_dir: Path):
    return FakeBackends() if os.environ.get("NARNIA_MEDIA_FAKE") == "1" else RealBackends(models_dir)
