"""Token do Hugging Face (F13-5, R4): arquivo 0600 no volume de modelos; nunca em log, resposta ou exceção."""

import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

TOKEN_FILE = "hf_token"
TOKEN_RE = re.compile(r"^hf_[A-Za-z0-9_-]{3,200}$")
# modelo gated (CC-BY-4.0): o usuário precisa aceitar os termos na página dele com a mesma conta do token
GATED_CHECK_URL = "https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/main/config.yaml"
WHOAMI_URL = "https://huggingface.co/api/whoami-v2"

Validator = Callable[[str], str | None]


def valid_format(token: str) -> bool:
    return bool(TOKEN_RE.match(token))


def token_path(models_dir: Path) -> Path:
    return models_dir / TOKEN_FILE


def has_token(models_dir: Path) -> bool:
    return token_path(models_dir).is_file()


def read_token(models_dir: Path) -> str | None:
    path = token_path(models_dir)
    return path.read_text().strip() if path.is_file() else None


def save_token(models_dir: Path, token: str) -> None:
    path = token_path(models_dir)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(token)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def delete_token(models_dir: Path) -> None:
    token_path(models_dir).unlink(missing_ok=True)


def _status(url: str, token: str, method: str) -> int:
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return res.status
    except urllib.error.HTTPError as err:
        return err.code


def validate_with_hub(token: str) -> str | None:
    """None = token aceito e termos do community-1 aceitos; senão, a mensagem acionável (sem o token)."""
    try:
        if _status(WHOAMI_URL, token, "GET") != 200:
            return "O Hugging Face recusou o token. Confira se copiou o token inteiro e se ele não foi revogado."
        code = _status(GATED_CHECK_URL, token, "HEAD")
    except (urllib.error.URLError, TimeoutError, OSError):
        return "Não consegui falar com o Hugging Face. Confira a conexão com a internet e tente de novo."
    if code in (401, 403):
        return (
            "O token é válido, mas a conta ainda não aceitou os termos do modelo "
            "pyannote/speaker-diarization-community-1. Abra a página do modelo, aceite e tente de novo."
        )
    if code >= 400:
        return f"O Hugging Face respondeu {code} ao conferir o modelo. Tente de novo mais tarde."
    return None
