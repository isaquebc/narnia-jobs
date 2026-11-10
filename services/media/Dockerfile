# syntax=docker/dockerfile:1.7
# Serviço media da F13 (análise de entrevista gravada), opcional: perfil `media` dos composes, desligado por padrão.
# Estágios:
#   base       -> Python 3.12 + ffmpeg/ffprobe (Debian; chamados como processo, não linkados)
#   media-test -> base + pytest + testes (scripts/claude-env.sh media-test)
#   runtime    -> o serviço (porta 8700, rede só com api e worker; ver plans/plan-v0/tasks/F13-entrevista-gravada.md §6.1.1)
# A imagem de testes não leva os modelos (modo falso, NARNIA_MEDIA_FAKE=1); o runtime instala torch CPU, faster-whisper,
# pyannote e MediaPipe, e os pesos baixam no primeiro uso para o volume media-models (nada de pesos na imagem).

FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NARNIA_MEDIA_INTERVIEWS=/interviews \
    NARNIA_MEDIA_MODELS=/models \
    HF_HOME=/models/hf \
    NUMBA_CACHE_DIR=/tmp/numba \
    MPLCONFIGDIR=/tmp/matplotlib
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-por tesseract-ocr-eng \
    libegl1 libgles2 libgl1 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /interviews /models \
 && chmod a+rwX /interviews /models
WORKDIR /srv
COPY services/media/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS media-test
COPY services/media/requirements-test.txt ./
RUN pip install --no-cache-dir -r requirements-test.txt
COPY services/media/narnia_media ./narnia_media
COPY services/media/tests ./tests
COPY services/media/pyproject.toml ./
CMD ["python", "-m", "pytest", "-q"]

# modo falso (F13 §6.4): sem modelos, entrevista sintética; usado no e2e
FROM base AS fake
ENV NARNIA_MEDIA_FAKE=1
COPY services/media/narnia_media ./narnia_media
EXPOSE 8700
CMD ["python", "-m", "narnia_media"]

FROM base AS runtime
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
COPY services/media/requirements-models.txt ./
RUN pip install --no-cache-dir --extra-index-url ${TORCH_INDEX} -r requirements-models.txt
# o código por último: mudar uma etapa não reinstala torch e os modelos
COPY services/media/narnia_media ./narnia_media
EXPOSE 8700
CMD ["python", "-m", "narnia_media"]
