import { describe, expect, it } from "vitest";
import { isBlockedAddress, urlGuard } from "../../src/net/guard";

/** F05/M1 · anti-SSRF no core (movido do api na F05 para o worker checar links do CV com a mesma regra da F06). */
describe("F05/M1 · urlGuard", () => {
  const publicDns = async () => ["93.184.216.34"];

  it("bloqueia rede interna, loopback, link-local e IPv6 local", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.10",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
      "0.0.0.0",
    ])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"])
      expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("recusa esquema que não é http(s), credenciais, localhost, IP interno e DNS interno", async () => {
    const guard = urlGuard(publicDns);
    expect(await guard(new URL("ftp://exemplo.com/x"))).toMatch(/http/);
    expect(await guard(new URL("https://a:b@exemplo.com/"))).toMatch(/credenciais/);
    expect(await guard(new URL("http://localhost:3100/"))).toMatch(/local/);
    expect(await guard(new URL("http://169.254.169.254/latest"))).toMatch(/interna/);
    expect(
      await urlGuard(async () => ["10.0.0.5"])(new URL("https://intranet.exemplo.com/")),
    ).toMatch(/interna/);
  });

  it("DNS que não resolve vira motivo próprio; endereço público passa", async () => {
    expect(
      await urlGuard(async () => {
        throw new Error("ENOTFOUND");
      })(new URL("https://nao-existe.exemplo/")),
    ).toBe("Não consegui resolver o endereço.");
    expect(await urlGuard(publicDns)(new URL("https://www.linkedin.com/in/ana"))).toBeNull();
  });
});
