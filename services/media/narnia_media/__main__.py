import os
from pathlib import Path

from .server import make_server


def main() -> None:
    port = int(os.environ.get("NARNIA_MEDIA_PORT", "8700"))
    server = make_server(
        "0.0.0.0",
        port,
        interviews_dir=Path(os.environ.get("NARNIA_MEDIA_INTERVIEWS", "/interviews")),
        models_dir=Path(os.environ.get("NARNIA_MEDIA_MODELS", "/models")),
    )
    print(f"media: ouvindo na porta {port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
