import { describe, expect, it } from "vitest";
import { resolveClaudeBinary } from "../src/index";

describe("M4/providers resolveClaudeBinary", () => {
  it("prefere o caminho explícito, depois `claude` no PATH, depois o binário embutido no SDK", () => {
    const exists = (p: string) =>
      p === "/sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude";
    expect(
      resolveClaudeBinary({
        explicit: "/x/claude",
        exists: () => true,
        which: () => null,
        sdkDir: "/sdk/node_modules/@anthropic-ai/claude-agent-sdk",
      }),
    ).toBe("/x/claude");
    expect(
      resolveClaudeBinary({
        exists,
        which: () => "/usr/local/bin/claude",
        sdkDir: "/sdk/node_modules/@anthropic-ai/claude-agent-sdk",
      }),
    ).toBe("/usr/local/bin/claude");
    expect(
      resolveClaudeBinary({
        exists,
        which: () => null,
        sdkDir: "/sdk/node_modules/@anthropic-ai/claude-agent-sdk",
        platform: "linux",
        arch: "x64",
      }),
    ).toBe("/sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude");
  });

  it("devolve null quando nada existe", () => {
    expect(
      resolveClaudeBinary({ exists: () => false, which: () => null, sdkDir: "/sdk/x" }),
    ).toBeNull();
  });
});
