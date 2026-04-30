import { randomInt } from "node:crypto";

const adjectives = [
  "bright",
  "quiet",
  "rapid",
  "steady",
  "vivid",
  "clever",
  "brisk",
  "lucid",
  "solid",
  "nimble",
  "calm",
  "fresh"
];

const nouns = [
  "atlas",
  "vector",
  "signal",
  "cipher",
  "harbor",
  "summit",
  "orbit",
  "matrix",
  "kernel",
  "ledger",
  "compass",
  "syntax"
];

export function generateRandomUsername(): string {
  const adjective = adjectives[randomInt(adjectives.length)];
  const noun = nouns[randomInt(nouns.length)];
  const suffix = randomInt(0x100000000).toString(36).padStart(7, "0");

  return `${adjective}-${noun}-${suffix}`;
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(username);
}
