# syntax=docker/dockerfile:1.7
# Serviço media da F13 (análise de entrevista gravada), opcional: perfil `media` dos composes, desligado por padrão.
# Estágios:
#   base       -> Python 3.12 + ffmpeg/ffprobe (Debian; chamados como processo, não linkados)
#   media-test -> base + pytest + testes (scripts/claude-env.sh media-test)
#   runtime    -> o serviço (porta 8700, rede só com api e worker; ver plans/plan-v0/tasks/F13-entrevista-gravada.md §6.1.1)
# As etapas pesadas (transcrição, vozes, rosto) entram no M2/M3 com as dependências delas.

FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NARNIA_MEDIA_INTERVIEWS=/interviews \
    NARNIA_MEDIA_MODELS=/models \
    HF_HOME=/models/hf
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /interviews /models \
 && chmod a+rwX /interviews /models
WORKDIR /srv
COPY services/media/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY services/media/narnia_media ./narnia_media

FROM base AS media-test
COPY services/media/requirements-test.txt ./
RUN pip install --no-cache-dir -r requirements-test.txt
COPY services/media/tests ./tests
COPY services/media/pyproject.toml ./
CMD ["python", "-m", "pytest", "-q"]

FROM base AS runtime
EXPOSE 8700
CMD ["python", "-m", "narnia_media"]
