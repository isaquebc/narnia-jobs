"""F13/M2 · etapas de áudio pelo serviço, com os modelos falsos (entrevista sintética): extrair, transcrever, separar
vozes (com e sem token), juntar e medir; retomada por etapa."""

from conftest import make_video
from test_server import wait_run

AUDIO = ["probe", "audio", "transcribe", "diarize", "turns", "voice", "levels"]


def run_steps(media, iid, steps, seconds=30):
    make_video(media.interviews / iid / "video.webm", seconds, seekable=False)
    status, body = media.call("POST", "/runs", {"interview_id": iid, "steps": steps})
    assert status == 202, body
    run = wait_run(media, body["id"], timeout=90)
    assert run["state"] == "done", run
    return run


def test_audio_completo_com_token(media):
    media.call("PUT", "/token", {"token": "hf_ok_x"})
    run = run_steps(media, "a1", AUDIO)
    r = run["results"]
    assert r["audio"]["sample_rate"] == 16000 and abs(r["audio"]["seconds"] - 30) < 0.5
    assert (media.interviews / "a1" / "work" / "audio.wav").is_file()
    assert r["transcribe"]["language"] == "pt" and len(r["transcribe"]["words"]) > 100
    assert r["diarize"]["method"] == "pyannote"
    turns = r["turns"]["turns"]
    assert {t["speaker"] for t in turns} == {"SPEAKER_00", "SPEAKER_01"}
    assert any("anotar" in t["text"] for t in turns)
    v = r["voice"]["speakers"]["SPEAKER_01"]
    assert v["fillers"].get("né", 0) >= 2 and v["wpm"] > 0
    assert set(r["levels"]["speakers"]) == {"SPEAKER_00", "SPEAKER_01"}
    assert run["progress"] == 100


def test_sem_token_turnos_sem_falante(media):
    run = run_steps(media, "a2", AUDIO, seconds=20)
    assert run["results"]["diarize"] == {"method": "none", "turns": []}
    assert {t["speaker"] for t in run["results"]["turns"]["turns"]} == {None}


def test_etapa_sem_a_anterior_falha_com_mensagem(media):
    make_video(media.interviews / "a3" / "video.webm", 5)
    _, body = media.call("POST", "/runs", {"interview_id": "a3", "steps": ["voice"]})
    run = wait_run(media, body["id"])
    assert run["state"] == "failed"
    assert run["error"]["code"] == "missing_step"


def test_retomada_pula_o_que_ja_foi_feito(media):
    run_steps(media, "a4", ["probe", "audio", "transcribe"], seconds=10)
    _, body = media.call("POST", "/runs", {"interview_id": "a4", "steps": AUDIO})
    run = wait_run(media, body["id"], timeout=90)
    assert run["state"] == "done"
    assert run["skipped"] == ["probe", "audio", "transcribe"]


def test_token_salvo_depois_refaz_as_vozes_e_o_que_depende_delas(media):
    run_steps(media, "a5", AUDIO, seconds=20)
    media.call("PUT", "/token", {"token": "hf_ok_x"})
    _, body = media.call("POST", "/runs", {"interview_id": "a5", "steps": AUDIO})
    run = wait_run(media, body["id"], timeout=90)
    assert run["state"] == "done", run
    assert run["skipped"] == ["probe", "audio", "transcribe"]
    assert run["results"]["diarize"]["method"] == "pyannote"
    assert {t["speaker"] for t in run["results"]["turns"]["turns"]} == {"SPEAKER_00", "SPEAKER_01"}
    assert set(run["results"]["voice"]["speakers"]) == {"SPEAKER_00", "SPEAKER_01"}


def test_sem_token_de_novo_nao_refaz_nada(media):
    run_steps(media, "a6", AUDIO, seconds=10)
    _, body = media.call("POST", "/runs", {"interview_id": "a6", "steps": AUDIO})
    run = wait_run(media, body["id"], timeout=90)
    assert run["skipped"] == AUDIO
