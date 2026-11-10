"""F13/M3 · etapas visuais pelo serviço, com modelos falsos: duas pessoas (destaque e miniatura), nomes pela etiqueta,
voz ligada ao rosto, anotação confirmada e provável, reação, confiabilidade e quadros em JPEG."""

from test_audio_steps import run_steps

VISION = ["faces", "layout", "link", "events", "frames"]
BASE = ["probe", "audio", "transcribe", "diarize", "turns"]
FULL = BASE + ["faces", "layout", "link", "voice", "levels", "events", "frames"]


def test_pipeline_completo_com_token(media):
    media.call("PUT", "/token", {"token": "hf_ok_x"})
    run = run_steps(media, "v1", FULL, seconds=60)
    r = run["results"]
    assert len(r["faces"]["frames"]) >= 59
    assert r["layout"]["meeting_start_s"] > 0  # sala de espera antes da primeira fala
    persons = r["link"]["persons"]
    assert {p["name"] for p in persons} == {"Marina Duarte", "Alex Souza"}
    by_name = {p["name"]: p for p in persons}
    assert by_name["Marina Duarte"]["speaker"] == "SPEAKER_00"
    assert by_name["Alex Souza"]["speaker"] == "SPEAKER_01"
    events = r["events"]["events"]
    marina = by_name["Marina Duarte"]["id"]
    notes = {(e["level"], e["person"]) for e in events if e["type"] == "note"}
    assert ("confirmed", marina) in notes and ("probable", marina) in notes
    assert any(e["type"] == "frown" and e["person"] == marina for e in events)
    alex = r["events"]["persons"][by_name["Alex Souza"]["id"]]
    assert alex["reliability"]["level"] == "poor" and "smile_ratio" in alex
    assert set(r["voice"]["speakers"]) == {p["id"] for p in persons}  # medições por pessoa
    frames = r["frames"]["frames"]
    assert 1 <= len(frames) <= 40
    assert all((media.interviews / "v1" / "work" / "frames" / f["file"]).is_file() for f in frames)


def test_sem_token_aproxima_pela_boca(media):
    run = run_steps(media, "v2", FULL, seconds=60)
    link = run["results"]["link"]
    assert link["approximate"] is True
    turns = run["results"]["turns"]["turns"]
    assert len(link["turn_persons"]) == len(turns)
    assert set(run["results"]["voice"]["speakers"]) <= {p["id"] for p in link["persons"]} | {"?"}
