import { describe, expect, it } from "vitest";
import { generateRandomUsername, isValidUsername } from "@/lib/username";

describe("username", () => {
  it("generates unique usernames with the expected format", () => {
    const usernames = new Set(Array.from({ length: 200 }, generateRandomUsername));

    expect(usernames.size).toBe(200);
    for (const username of usernames) {
      expect(isValidUsername(username)).toBe(true);
    }
  });

  it("rejects invalid usernames", () => {
    expect(isValidUsername("ok-id")).toBe(true);
    expect(isValidUsername("x")).toBe(false);
    expect(isValidUsername("Bright-atlas-0000001")).toBe(false);
    expect(isValidUsername("bright-atlas-!")).toBe(false);
    expect(isValidUsername("-bright-atlas")).toBe(false);
    expect(isValidUsername("bright-atlas-")).toBe(false);
  });
});
