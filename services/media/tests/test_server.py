"""Serviço media, M1.1: saúde, token e execuções com a etapa probe (F13 §6.1.1, R1 e R4)."""

import os
import stat
import time

from conftest import make_video


def wait_run(media, run_id: str, timeout: float = 30) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        status, run = media.call("GET", f"/runs/{run_id}")
        assert status == 200
        if run["state"] in ("done", "failed"):
            return run
        time.sleep(0.05)
    raise AssertionError("execução não terminou")


def test_health_sem_token(media):
    status, body = media.call("GET", "/health")
    assert status == 200
    assert body["ok"] is True
    assert body["token"] is False
    assert body["busy"] is False
    assert "probe" in body["steps"]


def test_token_gravado_0600_e_nunca_devolvido(media, capsys):
    status, body = media.call("PUT", "/token", {"token": "hf_ok_segredo123"})
    assert status == 200
    assert body == {"configured": True}
    path = media.models / "hf_token"
    assert path.read_text() == "hf_ok_segredo123"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    _, health = media.call("GET", "/health")
    assert health["token"] is True
    assert "hf_ok_segredo123" not in str(health)
    out = capsys.readouterr()
    assert "hf_ok_segredo123" not in out.out + out.err


def test_token_recusado_nao_grava(media):
    status, body = media.call("PUT", "/token", {"token": "hf_ruim"})
    assert status == 422
    assert body["error"] == "token_rejected"
    assert "hf_ruim" not in str(body)
    assert not (media.models / "hf_token").exists()


def test_token_com_formato_invalido_nem_consulta(media):
    status, body = media.call("PUT", "/token", {"token": "nao é token\n"})
    assert status == 400
    assert body["error"] == "invalid_token"
    assert media.checked == []


def test_apagar_token(media):
    media.call("PUT", "/token", {"token": "hf_ok_x"})
    status, _ = media.call("DELETE", "/token")
    assert status == 200
    assert not (media.models / "hf_token").exists()


def test_probe_com_duracao_no_cabecalho(media):
    make_video(media.interviews / "e1" / "video.webm", 3)
    status, body = media.call("POST", "/runs", {"interview_id": "e1", "steps": ["probe"]})
    assert status == 202
    run = wait_run(media, body["id"])
    assert run["state"] == "done", run
    probe = run["results"]["probe"]
    assert abs(probe["duration"] - 3) < 0.3
    assert probe["duration_source"] == "header"
    assert probe["video"]["width"] == 160
    assert probe["audio"]["codec"] == "opus"
    assert (media.interviews / "e1" / "work" / "probe.json").exists()


def test_probe_sem_duracao_no_cabecalho_calcula_pelos_pacotes(media):
    make_video(media.interviews / "e2" / "video.webm", 4, seekable=False)
    _, body = media.call("POST", "/runs", {"interview_id": "e2", "steps": ["probe"]})
    run = wait_run(media, body["id"])
    assert run["state"] == "done", run
    probe = run["results"]["probe"]
    assert probe["duration_source"] == "packets"
    assert abs(probe["duration"] - 4) < 0.3


def test_etapa_ja_feita_e_pulada_ao_retomar(media):
    make_video(media.interviews / "e3" / "video.webm", 2)
    work = media.interviews / "e3" / "work"
    work.mkdir()
    (work / "probe.json").write_text('{"duration": 99, "duration_source": "header"}')
    _, body = media.call("POST", "/runs", {"interview_id": "e3", "steps": ["probe"]})
    run = wait_run(media, body["id"])
    assert run["results"]["probe"]["duration"] == 99
    assert run["skipped"] == ["probe"]


def test_arquivo_que_nao_e_video_falha_com_mensagem(media):
    (media.interviews / "e4").mkdir()
    (media.interviews / "e4" / "video.mp4").write_bytes(b"isto nao e video")
    _, body = media.call("POST", "/runs", {"interview_id": "e4", "steps": ["probe"]})
    run = wait_run(media, body["id"])
    assert run["state"] == "failed"
    assert run["error"]["code"] == "invalid_video"
    assert not (media.interviews / "e4" / "work" / "probe.json").exists()


def test_sem_video_404(media):
    status, body = media.call("POST", "/runs", {"interview_id": "nada", "steps": ["probe"]})
    assert status == 404
    assert body["error"] == "no_video"


def test_id_com_caminho_recusado(media):
    for bad in ["../x", "a/b", "", "A B"]:
        status, body = media.call("POST", "/runs", {"interview_id": bad, "steps": ["probe"]})
        assert status == 400, bad
        assert body["error"] == "invalid_interview_id"


def test_etapa_desconhecida_recusada(media):
    make_video(media.interviews / "e5" / "video.webm", 1)
    status, body = media.call("POST", "/runs", {"interview_id": "e5", "steps": ["voar"]})
    assert status == 400
    assert body["error"] == "unknown_step"


def test_ocupado_409(media):
    make_video(media.interviews / "e6" / "video.webm", 1)
    media.server.runner.hold.clear()  # segura a execução no início
    _, first = media.call("POST", "/runs", {"interview_id": "e6", "steps": ["probe"]})
    status, body = media.call("POST", "/runs", {"interview_id": "e6", "steps": ["probe"]})
    assert status == 409
    assert body["error"] == "busy"
    assert body["run_id"] == first["id"]
    _, health = media.call("GET", "/health")
    assert health["busy"] is True
    media.server.runner.hold.set()
    assert wait_run(media, first["id"])["state"] == "done"


def test_execucao_desconhecida_404(media):
    status, _ = media.call("GET", "/runs/nao-existe")
    assert status == 404
