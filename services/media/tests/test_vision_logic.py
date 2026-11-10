"""F13/M3 · lógica das etapas visuais, sem modelos: rostos → pessoas, nomes pelo OCR, voz ↔ rosto pela boca, eventos
relativos ao padrão da própria pessoa, anotações, confiabilidade (F13-4) e quadros."""

import numpy as np

from narnia_media.events import detect_events, person_stats, reliability
from narnia_media.layout import assign_names, track_faces
from narnia_media.link import link_speakers
from narnia_media.selection import select_frames

W, H = 1280, 720


def face(x, y, w, h, **blend):
    return {"bbox": [x, y, w, h], "blend": {"smile": 0.1, "jawOpen": 0.05, "browUp": 0.1, "browDown": 0.05,
                                             "eyeLookDown": 0.1, **blend},
            "pose": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "luma": 120.0, "contrast": 40.0, "sharpness": 90.0}


def frames_two_people(n=60, drop_small=()):
    out = []
    for t in range(n):
        faces = [face(400, 150, 300, 340)]
        if t not in drop_small:
            faces.append(face(1150, 40, 40, 46))
        out.append({"t": float(t), "faces": faces})
    return out


def test_rostos_viram_duas_pessoas_com_presenca():
    tracks = track_faces(frames_two_people(drop_small=range(0, 30)), W, H)
    assert len(tracks) == 2
    big, small = sorted(tracks, key=lambda t: -t["face_px"])
    assert big["detected_ratio"] == 1.0 and small["detected_ratio"] == 0.5
    assert big["face_px"] > 300 and small["face_px"] < 50
    assert len(big["series"]) == 60


def test_nome_da_etiqueta_abaixo_do_rosto():
    tracks = track_faces(frames_two_people(), W, H)
    lines = [
        {"text": "Marina Duarte", "conf": 91, "bbox": [400, 520, 180, 24]},
        {"text": "Alex Souza (Convidado)", "conf": 80, "bbox": [1130, 92, 120, 14]},
        {"text": "Reunião em andamento", "conf": 95, "bbox": [20, 690, 200, 20]},
        {"text": "12:04", "conf": 95, "bbox": [1200, 690, 50, 20]},
    ]
    names = assign_names(tracks, [lines, lines, lines])
    by_px = {t["id"]: t["face_px"] for t in tracks}
    big = max(by_px, key=by_px.get)
    small = min(by_px, key=by_px.get)
    assert names[big] == "Marina Duarte"
    assert names[small] == "Alex Souza"


def test_voz_liga_ao_rosto_cuja_boca_mexe_quando_ela_fala():
    frames = []
    turns = []
    for t in range(60):
        a_speaks = (t // 10) % 2 == 0
        frames.append({"t": float(t), "faces": [
            face(400, 150, 300, 340, jawOpen=0.4 if a_speaks and t % 2 else 0.05),
            face(1150, 40, 40, 46, jawOpen=0.35 if not a_speaks and t % 2 else 0.04),
        ]})
    for k in range(6):
        turns.append({"speaker": "S_A" if k % 2 == 0 else "S_B", "start": k * 10.0, "end": k * 10 + 9.5,
                      "text": "x", "words": []})
    tracks = track_faces(frames, W, H)
    link = link_speakers(tracks, turns)
    big = max(tracks, key=lambda t: t["face_px"])["id"]
    small = min(tracks, key=lambda t: t["face_px"])["id"]
    assert link["speaker_to_track"] == {"S_A": big, "S_B": small}
    assert link["confidence"]["S_A"] > 0.3


def test_sem_separacao_de_vozes_turno_vai_para_quem_mexe_a_boca():
    frames = [{"t": float(t), "faces": [face(400, 150, 300, 340, jawOpen=0.5 if t < 10 and t % 2 else 0.03),
                                        face(1150, 40, 40, 46, jawOpen=0.5 if t >= 10 and t % 2 else 0.03)]}
              for t in range(20)]
    turns = [{"speaker": None, "start": 0.0, "end": 9.5, "text": "a", "words": []},
             {"speaker": None, "start": 10.0, "end": 19.5, "text": "b", "words": []}]
    tracks = track_faces(frames, W, H)
    link = link_speakers(tracks, turns)
    big = max(tracks, key=lambda t: t["face_px"])["id"]
    small = min(tracks, key=lambda t: t["face_px"])["id"]
    assert link["approximate"] is True
    assert link["turn_tracks"] == [big, small]


def test_anotacao_confirmada_pela_fala_e_provavel_pela_cabeca_baixa():
    frames = []
    for t in range(80):
        f = face(400, 150, 300, 340)
        if 40 <= t < 47:
            f["pose"]["pitch"] = -28.0
            f["blend"]["eyeLookDown"] = 0.7
        frames.append({"t": float(t), "faces": [f]})
    tracks = track_faces(frames, W, H)
    tid = tracks[0]["id"]
    turns = [{"speaker": "S", "start": 10.0, "end": 12.0, "text": "Deixa eu anotar isso aqui.", "words": []},
             {"speaker": "S", "start": 30.0, "end": 32.0, "text": "Eu anoto tudo em casa depois.", "words": []}]
    events = detect_events(tracks, turns, {"S": tid})
    notes = [e for e in events if e["type"].startswith("note")]
    assert [(e["type"], e["level"]) for e in notes] == [("note", "confirmed"), ("note", "probable")]
    assert notes[0]["t"] == 10.0 and notes[1]["t"] == 40.0
    assert notes[1]["duration_s"] >= 6
    assert notes[0]["reading"] == "indeterminate"


def test_reacao_e_relativa_ao_padrao_da_pessoa():
    # quem sorri sempre (0,6) não gera evento; quem quase nunca sorri gera, com o turno anterior de outra pessoa
    frames = []
    for t in range(60):
        smiley = face(400, 150, 300, 340, smile=0.6)
        serious = face(1000, 150, 200, 230, smile=0.75 if 30 <= t < 34 else 0.05)
        frames.append({"t": float(t), "faces": [smiley, serious]})
    tracks = track_faces(frames, W, H)
    by_x = {t["id"]: t["bbox"][0] for t in tracks}
    serious_id = max(by_x, key=by_x.get)
    smiley_id = min(by_x, key=by_x.get)
    turns = [{"speaker": "A", "start": 27.0, "end": 29.5, "text": "E o salário pretendido?", "words": []}]
    events = detect_events(tracks, turns, {"A": smiley_id})
    smiles = [e for e in events if e["type"] == "smile"]
    assert [e["track"] for e in smiles] == [serious_id]
    assert smiles[0]["t"] == 30.0 and smiles[0]["after_turn"] == 0


def test_confiabilidade_e_sorriso_sempre_reportado():
    tracks = track_faces(frames_two_people(drop_small=range(0, 32)), W, H)
    small = min(tracks, key=lambda t: t["face_px"])
    big = max(tracks, key=lambda t: t["face_px"])
    assert reliability(big)["level"] == "good"
    r = reliability(small)
    assert r["level"] == "poor" and r["detected_pct"] == 46.7
    stats = person_stats(small)
    assert "smile_ratio" in stats and stats["reliability"]["level"] == "poor"
    assert stats["camera"]["face_px"] < 50


def test_quadros_ate_o_limite_com_prioridade_para_anotacoes():
    events = [{"id": f"e{i}", "type": "smile", "t": float(i), "track": "T1", "level": None} for i in range(60)]
    events.append({"id": "n1", "type": "note", "t": 100.0, "track": "T2", "level": "probable"})
    tracks = [{"id": "T1", "series": [{"t": 5.0}], "face_px": 300}, {"id": "T2", "series": [{"t": 7.0}], "face_px": 40}]
    sel = select_frames(events, tracks, limit=40)
    assert len(sel) == 40
    assert sel[0]["t"] == 100.0 and sel[0]["events"] == ["n1"]
    assert {s["reason"] for s in sel} >= {"event", "reference"}
    assert sorted(s["t"] for s in sel) == [s["t"] for s in sorted(sel, key=lambda s: s["t"])]


def test_cabeca_baixa_desloca_a_caixa_mas_continua_a_mesma_pessoa():
    frames = []
    for t in range(60):
        if 20 <= t < 26:  # cabeça baixa: caixa mais abaixo e menor, nunca junto com a de cima
            frames.append({"t": float(t), "faces": [face(460, 330, 260, 280)]})
        else:
            frames.append({"t": float(t), "faces": [face(400, 150, 300, 340)]})
    tracks = track_faces(frames, W, H)
    assert len(tracks) == 1
    assert tracks[0]["detected_ratio"] == 1.0


def test_dois_rostos_juntos_na_tela_nao_se_fundem():
    frames = [{"t": float(t), "faces": [face(400, 150, 300, 340), face(520, 200, 280, 300)]} for t in range(30)]
    assert len(track_faces(frames, W, H)) == 2


def test_nome_que_sobra_fica_disponivel_para_quem_nao_tem_rosto():
    tracks = track_faces([{"t": float(t), "faces": [face(400, 150, 300, 340)]} for t in range(30)], W, H)
    lines = [
        {"text": "Marina Duarte", "conf": 91, "bbox": [400, 520, 180, 24]},
        {"text": "Alex Souza", "conf": 70, "bbox": [1130, 92, 120, 14]},
        {"text": "Calendário", "conf": 90, "bbox": [10, 10, 80, 14]},
        {"text": "ONE TEAM AT", "conf": 90, "bbox": [10, 40, 80, 14]},
    ]
    from narnia_media.layout import leftover_names

    names = assign_names(tracks, [lines, lines])
    assert leftover_names(names, [lines, lines]) == ["Alex Souza"]


def test_nome_de_uma_palavra_na_miniatura_sobra_e_botoes_nao():
    # Teams: etiqueta "Bruno" na miniatura (rosto pequeno demais para o detector); barra de botões no topo
    from narnia_media.layout import leftover_names

    tracks = track_faces([{"t": float(t), "faces": [face(600, 460, 394, 423)]} for t in range(30)], 1920, 904)
    lines = [
        {"text": "Renata Alves Pereira de Souza", "conf": 96, "bbox": [14, 872, 178, 14]},
        {"text": "Bruno", "conf": 95, "bbox": [1682, 866, 40, 14]},
        {"text": "Câmera", "conf": 95, "bbox": [1573, 38, 40, 12]},
        {"text": "Pessoas", "conf": 92, "bbox": [1276, 38, 40, 12]},
        {"text": "Ss", "conf": 90, "bbox": [700, 880, 14, 12]},
        {"text": "Acmeworks", "conf": 90, "bbox": [1700, 70, 90, 20]},
    ]
    names = assign_names(tracks, [lines, lines])
    assert list(names.values()) == ["Renata Alves Pereira de Souza"]
    assert leftover_names(names, [lines, lines], height=904) == ["Bruno"]


def test_lixo_do_ocr_nao_vira_nome():
    from narnia_media.layout import clean_name

    assert clean_name("Ss") is None
    assert clean_name("Ana") == "Ana"
    assert clean_name("Renata Alves Pereira de Souza") == "Renata Alves Pereira de Souza"


def test_icone_do_microfone_lido_no_fim_da_etiqueta_sai_do_nome():
    # Teams: o OCR lê o ícone do microfone ao lado do nome como "8", "&", "4" (quadro real, F13 §8)
    from narnia_media.layout import clean_name

    assert clean_name("Bruno 8") == "Bruno"
    assert clean_name("Renata Alves Pereira de Souza &") == "Renata Alves Pereira de Souza"
    assert clean_name("Renata Souza 4 |") == "Renata Souza"
    assert clean_name("Ana Lu") == "Ana Lu"


def test_ocr_em_faixas_cobre_o_quadro_e_volta_para_a_coordenada_do_quadro():
    from narnia_media.backends import merge_band_lines, ocr_bands

    bands = ocr_bands(904)
    assert bands[0][0] == 0 and bands[-1][1] == 904
    assert all(b[0] < a[1] for a, b in zip(bands, bands[1:]))  # sobrepostas: etiqueta na borda não se perde
    lines = merge_band_lines([
        (800, [{"text": "Bruno", "conf": 90, "bbox": [1682, 66, 40, 14]}]),
        (850, [{"text": "Bruno", "conf": 95, "bbox": [1682, 16, 40, 14]}]),
        (0, [{"text": "Câmera", "conf": 95, "bbox": [1573, 38, 40, 12]}]),
    ])
    assert sorted((x["text"], x["bbox"][1], x["conf"]) for x in lines) == [("Bruno", 866, 95), ("Câmera", 38, 95)]
