import { z } from "zod";
import { serverConfig } from "@/lib/serverConfig";

export interface DictionaryWordInfo {
  word: string;
  partOfSpeech: string;
  definition: string;
  example: string;
}

export interface DictionaryLookupOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface DictionaryDefinitionCandidate {
  partOfSpeech: string;
  definition: string;
  example: string | null;
}

const dictionaryDefinitionSchema = z.object({
  definition: z.string().optional(),
  example: z.string().optional()
}).passthrough();

const dictionaryMeaningSchema = z.object({
  partOfSpeech: z.string().optional(),
  definitions: z.array(dictionaryDefinitionSchema).optional()
}).passthrough();

const dictionaryEntrySchema = z.object({
  word: z.string().optional(),
  meanings: z.array(dictionaryMeaningSchema).optional()
}).passthrough();

const dictionaryResponseSchema = z.array(dictionaryEntrySchema);

export async function lookupDictionaryWord(
  word: string,
  options: DictionaryLookupOptions = {}
): Promise<DictionaryWordInfo> {
  const normalizedWord = normalizeDictionaryWord(word);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? serverConfig.dictionary.timeoutMs;
  const baseUrl = options.baseUrl ?? serverConfig.dictionary.baseUrl;
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(normalizedWord)}`, {
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Dictionary lookup failed for ${normalizedWord}: HTTP ${response.status}`);
  }

  const payload = dictionaryResponseSchema.parse(await response.json());
  const entries = payload
    .flatMap((entry) =>
      (entry.meanings ?? []).flatMap((meaning) =>
        (meaning.definitions ?? []).map<DictionaryDefinitionCandidate | null>((definition) => {
          const definitionText = cleanDictionaryText(definition.definition ?? "");
          if (!definitionText) {
            return null;
          }

          return {
            partOfSpeech: cleanDictionaryText(meaning.partOfSpeech ?? "word") || "word",
            definition: definitionText,
            example: cleanDictionaryText(definition.example ?? "") || null
          };
        })
      )
    )
    .filter((entry): entry is DictionaryDefinitionCandidate => Boolean(entry));

  const selected = entries.find((entry) => entry.example) ?? entries[0];
  if (!selected) {
    throw new Error(`Dictionary lookup returned no usable definitions for ${normalizedWord}`);
  }

  return {
    word: payload[0]?.word?.trim() || normalizedWord,
    partOfSpeech: selected.partOfSpeech,
    definition: truncateDictionaryText(selected.definition, 160),
    example: truncateDictionaryText(selected.example ?? `Dictionary definition: ${selected.definition}`, 320)
  };
}

function normalizeDictionaryWord(word: string): string {
  return word.trim().toLowerCase();
}

function cleanDictionaryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateDictionaryText(value: string, maxLength: number): string {
  const normalized = cleanDictionaryText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
