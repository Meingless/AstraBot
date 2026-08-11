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

  it("does not trip the circuit breaker on provider 4xx client errors", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("invalid model", { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Recovered" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await freshAi();
    const connection = { provider: "openai" as const, model: "bad-model", baseUrl: "" };
    await expect(generateText("question", connection)).resolves.toBeNull();
    // A 400 must not open the circuit: the next request still reaches the provider.
    await expect(generateText("question", connection)).resolves.toBe("Recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("trips the circuit breaker on provider 5xx and network errors", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const connection = { provider: "openai" as const, model: "test", baseUrl: "" };

    const serverErrorFetch = vi.fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", serverErrorFetch);
    const { generateText } = await freshAi();
    await expect(generateText("question", connection)).resolves.toBeNull();
    // The circuit is open, so the retry is rejected without calling fetch.
    await expect(generateText("question", connection)).resolves.toBeNull();
    expect(serverErrorFetch).toHaveBeenCalledTimes(1);

    const networkErrorFetch = vi.fn()
      .mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", networkErrorFetch);
    const networkAi = await freshAi();
    await expect(networkAi.generateText("question", connection)).resolves.toBeNull();
    await expect(networkAi.generateText("question", connection)).resolves.toBeNull();
    expect(networkErrorFetch).toHaveBeenCalledTimes(1);
  });
});
