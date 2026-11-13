import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { Codex } from "../companion/codex";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { spawn } from "node:child_process";

describe("Codex App Server errors", () => {
  it("rejects the turn when Codex reports a usage limit without crashing the companion", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValueOnce(
      child as unknown as ReturnType<typeof spawn>,
    );
    const send = (message: unknown) =>
      child.stdout.write(JSON.stringify(message) + "\n");
    child.stdin.on("data", (data) => {
      const request = JSON.parse(data.toString());
      queueMicrotask(() => {
        if (request.method === "thread/start") {
          send({ id: request.id, result: { thread: { id: "test-thread" } } });
        } else if (request.method === "turn/start") {
          send({ id: request.id, result: { turn: { id: "test-turn" } } });
          send({
            method: "error",
            params: {
              threadId: "test-thread",
              willRetry: true,
              error: { message: "Retrying" },
            },
          });
          send({
            method: "error",
            params: {
              threadId: "test-thread",
              willRetry: false,
              error: { message: "Codex usage limit reached. Try again later." },
            },
          });
        }
      });
    });
    const codex = new Codex();
    try {
      await expect(
        codex.run({ id: "hevy", name: "Hevy" }, "Test", {}),
      ).rejects.toThrow("Codex usage limit reached");
    } finally {
      codex.close();
    }
  });
});
