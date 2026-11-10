"""F13/M2 · lógica das etapas de áudio, sem modelos: junção de palavras e turnos, medições de voz e de áudio."""

import numpy as np

from narnia_media.levels import measure_levels
from narnia_media.turns import build_turns
from narnia_media.voice import count_fillers, measure_voice

SR = 16_000


def w(text, start, end, p=0.9):
    return {"w": text, "start": start, "end": end, "p": p}


def test_palavras_vao_para_o_falante_com_mais_sobreposicao():
    words = [w("Bom", 0.0, 0.4), w("dia.", 0.4, 0.8), w("Oi,", 1.0, 1.3), w("tudo", 1.3, 1.6), w("bem?", 1.6, 2.0)]
    diar = [{"speaker": "A", "start": 0.0, "end": 0.9}, {"speaker": "B", "start": 0.95, "end": 2.1}]
    turns = build_turns(words, diar)
    assert [(t["speaker"], t["text"]) for t in turns] == [("A", "Bom dia."), ("B", "Oi, tudo bem?")]
    assert turns[1]["start"] == 1.0 and turns[1]["end"] == 2.0
    assert len(turns[1]["words"]) == 3


def test_palavra_fora_de_qualquer_turno_vai_para_o_mais_proximo():
    words = [w("um", 0.0, 0.3), w("dois", 5.0, 5.3)]
    diar = [{"speaker": "A", "start": 0.0, "end": 0.2}, {"speaker": "B", "start": 5.5, "end": 6.0}]
    assert [t["speaker"] for t in build_turns(words, diar)] == ["A", "B"]


def test_pausa_longa_do_mesmo_falante_abre_outro_turno():
    words = [w("primeira", 0.0, 0.5), w("frase.", 0.5, 1.0), w("segunda", 4.0, 4.5)]
    diar = [{"speaker": "A", "start": 0.0, "end": 5.0}]
    assert [t["text"] for t in build_turns(words, diar, max_gap=2.0)] == ["primeira frase.", "segunda"]


def test_sem_separacao_de_vozes_turnos_sem_falante():
    words = [w("oi", 0.0, 0.3), w("tchau", 3.0, 3.3)]
    turns = build_turns(words, [], max_gap=1.0)
    assert [t["speaker"] for t in turns] == [None, None]


def test_palavras_de_apoio_em_portugues():
    text = "Então, né, tipo assim, eu hum basicamente fiz, né"
    c = count_fillers(text, "pt")
    assert c["né"] == 2 and c["hum"] == 1 and c["basicamente"] == 1 and c["tipo assim"] == 1


def tone(freq, seconds, amp=0.3):
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_medicoes_de_voz_por_falante():
    # A fala 0–10 s (120 Hz), B fala 11–16 s (220 Hz) e responde 1 s depois
    wav = np.concatenate([tone(120, 10), np.zeros(SR, np.float32), tone(220, 5)])
    a_words = [w(f"p{i}", i * 0.5, i * 0.5 + 0.4) for i in range(20)]  # 20 palavras em 10 s
    b_words = [w("sim", 11.0, 11.4), w("claro", 14.0, 14.4)]  # pausa de 2,6 s
    turns = [
        {"speaker": "A", "start": 0.0, "end": 9.9, "text": " ".join(x["w"] for x in a_words), "words": a_words},
        {"speaker": "B", "start": 11.0, "end": 14.4, "text": "sim claro", "words": b_words},
    ]
    v = measure_voice(turns, wav, SR, language="pt")
    a, b = v["speakers"]["A"], v["speakers"]["B"]
    assert a["words"] == 20 and abs(a["wpm"] - 121) < 5
    assert 110 < a["pitch_median_hz"] < 130 and 200 < b["pitch_median_hz"] < 240
    assert a["pitch_spread_semitones"] < 1  # tom constante: voz monótona
    assert b["long_pauses"] == 1
    assert abs(b["response_latency_median_s"] - 1.1) < 0.01
    assert abs(v["talk_share"]["A"] - 9.9 / 13.3) < 0.01


def test_medicoes_de_audio_por_falante_e_ruido():
    rng = np.random.default_rng(1)
    noise = (rng.standard_normal(SR * 4) * 0.001).astype(np.float32)
    loud = tone(200, 2, amp=0.5)
    quiet = tone(200, 2, amp=0.05)
    wav = noise.copy()
    wav[0 : 2 * SR] += loud
    wav[2 * SR : 4 * SR] += quiet
    turns = [
        {"speaker": "A", "start": 0.0, "end": 2.0, "text": "", "words": []},
        {"speaker": "B", "start": 2.0, "end": 4.0, "text": "", "words": []},
    ]
    lv = measure_levels(turns, np.concatenate([wav, noise]), SR)
    a, b = lv["speakers"]["A"], lv["speakers"]["B"]
    assert a["rms_dbfs"] - b["rms_dbfs"] > 15
    assert a["clipping_ratio"] == 0
    assert lv["noise_floor_dbfs"] < -50
    assert b["snr_db"] > 15
