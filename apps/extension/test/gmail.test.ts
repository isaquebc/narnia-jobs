// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { sendMailAction } from "../src/client";
import { readGmailOpenMessage } from "../src/gmail-page";
import { popupView } from "../src/popup-view";

/**
 * F14/M3 · extensão no Gmail web (F14-13): o menu troca para confiar, bloquear e processar; a leitura pega só o
 * remetente e o id da mensagem aberta (a última expandida); as chamadas ao narnia e as mensagens de retorno.
 */
const paired = { instance: "http://127.0.0.1:5173", token: "nxd_abc", deviceName: "Chrome" };
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("F14/M3 · menu no Gmail", () => {
  it("no Gmail: confiar, bloquear, processar e abrir; fora dele, o menu de sempre", () => {
    expect(popupView(paired, "https://mail.google.com/mail/u/0/#inbox/FMfcgz").actions).toEqual([
      "trust-sender",
      "block-sender",
      "process-mail",
      "open",
    ]);
    expect(popupView(paired, "https://mail.google.com.evil.example/").actions).toEqual([
      "posting",
      "form",
      "open",
    ]);
  });
});

describe("F14/M3 · leitura do e-mail aberto", () => {
  it("pega o remetente e o id da última mensagem expandida, nada do corpo", () => {
    document.body.innerHTML = `
      <div class="adn" data-legacy-message-id="18c2f0a1b2c3d4e5"><span class="gD" email="Antigo@Acme.example">Antigo</span></div>
      <div class="adn" data-legacy-message-id="18c2f0a1b2c3d4ff"><span class="gD" email="RH@Globex.example">RH</span><div>corpo secreto</div></div>`;
    expect(readGmailOpenMessage()).toEqual({
      sender: "rh@globex.example",
      messageId: "18c2f0a1b2c3d4ff",
    });
  });

  it("remetente de outra parte da página não entra: só o do nó da mensagem aberta", () => {
    document.body.innerHTML = `<span class="gD" email="lista@acme.example"></span><div class="adn" data-legacy-message-id="18c2f0a1b2c3d4ff"></div>`;
    expect(readGmailOpenMessage()).toEqual({ sender: null, messageId: "18c2f0a1b2c3d4ff" });
  });

  it("sem e-mail aberto: nada", () => {
    document.body.innerHTML = "<div>caixa de entrada</div>";
    expect(readGmailOpenMessage()).toEqual({ sender: null, messageId: null });
  });
});

describe("F14/M3 · chamadas ao narnia", () => {
  it("confiar manda o endereço com origem extensão e avisa da quarentena", async () => {
    const fetch = vi.fn(() => json(200, { quarantined: 2 }));
    const r = await sendMailAction(fetch, paired.instance, paired.token, {
      kind: "trust",
      sender: "rh@globex.example",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:5173/api/mail/senders",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          value: "rh@globex.example",
          override: "trusted",
          origin: "extension",
        }),
      }),
    );
    expect(r).toMatchObject({ ok: true });
    expect(r.message).toMatch(/2 e-mail\(s\) dele estão em quarentena/);
  });

  it("processar: novo ou já lido; narnia fora do ar e dispositivo revogado", async () => {
    const queued = await sendMailAction(
      vi.fn(() => json(202, { status: "queued" })),
      paired.instance,
      paired.token,
      {
        kind: "process",
        messageId: "18c2f0a1b2c3d4ff",
      },
    );
    expect(queued.message).toBe("O narnia vai ler este e-mail agora.");
    const known = await sendMailAction(
      vi.fn(() => json(200, { status: "known" })),
      paired.instance,
      paired.token,
      {
        kind: "process",
        messageId: "18c2f0a1b2c3d4ff",
      },
    );
    expect(known.message).toMatch(/já foi lido/);
    const off = await sendMailAction(
      vi.fn(() => Promise.reject(new Error("x"))),
      paired.instance,
      paired.token,
      {
        kind: "block",
        sender: "x@y.example",
      },
    );
    expect(off.ok).toBe(false);
    const revoked = await sendMailAction(
      vi.fn(() => json(401, {})),
      paired.instance,
      paired.token,
      {
        kind: "block",
        sender: "x@y.example",
      },
    );
    expect(revoked.message).toMatch(/desconectado/);
  });
});
