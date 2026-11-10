"""Entrevista sintética do modo falso (`NARNIA_MEDIA_FAKE=1`, F13 §6.4): fictícia, em pt-BR, para os testes e o e2e
rodarem sem modelos. Inclui o que o relatório precisa encontrar: resposta errada, tangente, anotação dita em voz alta,
palavras de apoio e pergunta sem resposta completa. Os tempos se ajustam à duração do vídeo."""

INTERVIEWER = "SPEAKER_00"
CANDIDATE = "SPEAKER_01"
NAMES = {INTERVIEWER: "Marina Duarte", CANDIDATE: "Alex Souza"}

SCRIPT: list[tuple[str, str]] = [
    (INTERVIEWER, "Oi Alex, tudo bem? Obrigada por vir. Vamos começar pela sua experiência com bancos de dados."),
    (CANDIDATE, "Tudo ótimo, obrigado pelo convite. Trabalho com PostgreSQL há uns cinco anos, né, principalmente com APIs."),
    (INTERVIEWER, "Quando você usaria um índice B-tree e quando usaria um índice GIN no PostgreSQL?"),
    (CANDIDATE, "Então, tipo assim, o B-tree é melhor para busca de texto livre e o GIN para igualdade simples, né."),
    (INTERVIEWER, "Entendi. Deixa eu anotar isso aqui rapidinho."),
    (INTERVIEWER, "Me conta de uma situação em que você discordou do time e como resolveu."),
    (CANDIDATE, "Hum, teve uma vez que o time queria microsserviços e eu preferia um monólito modular. Aliás, eu adoro "
                "arquitetura, comecei programando jogos no colégio, fiz vários projetos de jogos e aprendi muito."),
    (INTERVIEWER, "E como terminou a discussão sobre o monólito?"),
    (CANDIDATE, "A gente fez uma prova de conceito e mediu o tempo de entrega. O monólito ganhou e o time concordou."),
    (INTERVIEWER, "Como você garante a qualidade do código que entrega?"),
    (CANDIDATE, "Basicamente eu testo bastante."),
    (INTERVIEWER, "Você tem alguma pergunta para a gente?"),
    (CANDIDATE, "Tenho sim: como o time divide o plantão e como medem o sucesso de quem entra agora?"),
    (INTERVIEWER, "Boa pergunta. O plantão é semanal e o primeiro trimestre tem metas combinadas com a liderança."),
]


def timeline(duration: float) -> list[dict]:
    """Turnos com palavras espaçadas por igual; 0,8 s entre turnos; começa em 5 % da duração (sala de espera)."""
    total_words = sum(len(text.split()) for _, text in SCRIPT)
    start = round(duration * 0.05, 2)
    gap = 0.8
    usable = max(1.0, duration * 0.92 - start - gap * (len(SCRIPT) - 1))
    per_word = usable / total_words
    out, t = [], start
    for speaker, text in SCRIPT:
        words = []
        for token in text.split():
            words.append({"w": token, "start": round(t, 3), "end": round(t + per_word * 0.85, 3), "p": 0.93})
            t += per_word
        out.append({"speaker": speaker, "start": words[0]["start"], "end": words[-1]["end"], "words": words})
        t += gap
    return out
