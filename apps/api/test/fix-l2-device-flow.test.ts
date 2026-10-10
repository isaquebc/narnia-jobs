import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createGhDeviceFlow } from "../src/github-auth";

/** Plano de correções F03, item 10: gerar outro código não emite erro falso do fluxo anterior. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: () => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {
    setImmediate(() => child.emit("close", null));
    return true;
  };
  return child;
}

describe("F03 fix L2 · item 10: fluxo de dispositivo substituído", () => {
  it("iniciar dois fluxos seguidos: só o segundo chama onDone; o primeiro, morto, não emite erro", async () => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnFn = (() => {
      const c = fakeChild();
      children.push(c);
      return c;
    }) as never;
    const flow = createGhDeviceFlow({ spawnFn, configDir: "/tmp/gh-test" } as never);
    const calls: Array<{ flow: number; r: unknown }> = [];

    const p1 = flow.start((r) => calls.push({ flow: 1, r }));
    children[0]?.stdout.write(
      "! First copy your one-time code: AAAA-1111\nOpen this URL to continue in your web browser: https://github.com/login/device\n",
    );
    await p1;
    const p2 = flow.start((r) => calls.push({ flow: 2, r }));
    children[1]?.stdout.write(
      "! First copy your one-time code: BBBB-2222\nOpen this URL to continue in your web browser: https://github.com/login/device\n",
    );
    await p2;
    await new Promise((r) => setImmediate(r));
    expect(calls).toEqual([]); // o kill do primeiro não vira "Autorização não concluída"

    children[1]?.emit("close", 0);
    expect(calls).toEqual([{ flow: 2, r: { ok: true } }]);
  });
});
