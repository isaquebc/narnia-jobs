import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(__dirname, "../..");

describe("favicon e logo do projeto", () => {
  it("index.html aponta para o favicon SVG da porta, que existe em public/", () => {
    const html = readFileSync(join(web, "index.html"), "utf8");
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    const svg = readFileSync(join(web, "public/favicon.svg"), "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("#0f5c5a");
  });

  it("o logo do repositório (docs/assets) é o mesmo desenho do favicon", () => {
    const logo = join(web, "../../docs/assets/logo.svg");
    expect(existsSync(logo)).toBe(true);
    const path = /<path d="([^"]+)"/;
    expect(readFileSync(logo, "utf8").match(path)?.[1]).toBe(
      readFileSync(join(web, "public/favicon.svg"), "utf8").match(path)?.[1],
    );
  });
});
