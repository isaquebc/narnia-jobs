"""Etapa de junção (F13/M2): palavras da transcrição + turnos da separação de vozes → turnos por pessoa.

Cada palavra vai para o falante cujo turno mais se sobrepõe a ela (ou o mais próximo, quando cai num vão). Palavras
seguidas do mesmo falante formam um turno, que se abre de novo depois de uma pausa maior que `max_gap`. Sem separação
de vozes, os turnos saem sem falante (a ligação com o rosto, no M3, ou a pessoa corrige).
"""

from bisect import bisect_left

Word = dict
Turn = dict


def _speaker_for(word: Word, diar: list[dict], starts: list[float]) -> str | None:
    if not diar:
        return None
    ws, we = word["start"], word["end"]
    i = bisect_left(starts, we)
    best, best_overlap = None, 0.0
    for t in diar[max(0, i - 12) : i + 1]:
        overlap = min(we, t["end"]) - max(ws, t["start"])
        if overlap > best_overlap:
            best, best_overlap = t["speaker"], overlap
    if best is not None:
        return best
    mid = (ws + we) / 2

    def distance(t: dict) -> float:
        return 0.0 if t["start"] <= mid <= t["end"] else min(abs(mid - t["start"]), abs(mid - t["end"]))

    return min(diar[max(0, i - 12) : i + 12], key=distance)["speaker"]


def build_turns(words: list[Word], diar: list[dict], *, max_gap: float = 1.5) -> list[Turn]:
    diar = sorted(diar, key=lambda t: t["start"])
    starts = [t["start"] for t in diar]
    turns: list[Turn] = []
    for word in words:
        speaker = _speaker_for(word, diar, starts)
        last = turns[-1] if turns else None
        if last and last["speaker"] == speaker and word["start"] - last["end"] <= max_gap:
            last["words"].append(word)
            last["end"] = word["end"]
        else:
            turns.append({"speaker": speaker, "start": word["start"], "end": word["end"], "words": [word]})
    for t in turns:
        t["text"] = " ".join(x["w"].strip() for x in t["words"]).strip()
    return turns
