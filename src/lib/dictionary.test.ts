import { describe, expect, it, vi } from "vitest";
import { lookupDictionaryWord } from "@/lib/dictionary";

describe("dictionary lookup", () => {
  it("uses dictionary definitions with examples when available", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            word: "coherent",
            meanings: [
              {
                partOfSpeech: "adjective",
                definitions: [
                  {
                    definition: "logical and consistent.",
                    example: "They failed to develop a coherent economic strategy."
                  }
                ]
              }
            ]
          }
        ]),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    await expect(lookupDictionaryWord("Coherent", { fetchImpl, timeoutMs: 1000 })).resolves.toEqual({
      word: "coherent",
      partOfSpeech: "adjective",
      definition: "logical and consistent.",
      example: "They failed to develop a coherent economic strategy."
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.dictionaryapi.dev/api/v2/entries/en/coherent",
      expect.objectContaining({
        headers: {
          Accept: "application/json"
        }
      })
    );
  });

  it("rejects dictionary responses without usable definitions", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch;

    await expect(lookupDictionaryWord("missing", { fetchImpl, timeoutMs: 1000 })).rejects.toThrow(/no usable/);
  });
});
