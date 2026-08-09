import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.AI_CUSTOM_ALLOWED_HOSTS;
});

async function freshAi() {
  vi.resetModules();
  return import("./ai.js");
}

describe("AI assistant provider client", () => {
  it("calls OpenAI-compatible providers with bounded prompts", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "  Answer  " } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await freshAi();
    await expect(
      generateText("question", {
        provider: "openai",
        model: "test-model",
        baseUrl: "https://attacker.example/v1",
      }),
    ).resolves.toBe("Answer");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ content: string }> };
    expect(body.model).toBe("test-model");
    expect(body.messages.at(-1)?.content).toBe("question");
  });

  it("calls Gemini and joins candidate parts", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "one" }, { text: " two" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await freshAi();
    await expect(
      generateText("explain", {
        provider: "gemini",
        model: "gemini-test",
        baseUrl: "https://attacker.example/gemini",
      }),
    ).resolves.toBe("one two");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("generativelanguage.googleapis.com");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("gemini-test:generateContent");
  });

  it("requires an explicit allowlist for custom AI endpoints", async () => {
    process.env.AI_CUSTOM_ALLOWED_HOSTS = "ai.example";
    const { assertAiConnectionAllowed } = await freshAi();
    const connection = {
      provider: "custom" as const,
      model: "custom-model",
      baseUrl: "https://ai.example/v1",
    };
    expect(() => assertAiConnectionAllowed(connection)).not.toThrow();
    expect(() => assertAiConnectionAllowed({
      ...connection,
      baseUrl: "https://internal.example/v1",
    })).toThrow(/AI_CUSTOM_ALLOWED_HOSTS/u);
  });

  it("fails closed when credentials or providers are unavailable", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { generateText } = await freshAi();
    await expect(
      generateText("secret", {
        provider: "openai",
        model: "test",
        baseUrl: "",
      }),
    ).resolves.toBeNull();
    expect(warning).toHaveBeenCalled();
  });
});
