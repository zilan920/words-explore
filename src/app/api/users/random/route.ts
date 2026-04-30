import { generateRandomUsername } from "@/lib/username";
import { getStorage } from "@/lib/db/storage";
import { fail, ok } from "@/lib/api";
import { serverConfig } from "@/lib/serverConfig";
import {
  enforceRateLimit,
  generateAccessToken,
  getClientIp,
  hashAccessToken,
  rateLimitKey
} from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const storage = await getStorage();
    await enforceRateLimit(storage, {
      key: rateLimitKey("users:random", getClientIp(request)),
      ...serverConfig.security.userCreationRateLimit
    });
    await enforceRateLimit(storage, {
      key: rateLimitKey("users:random:global"),
      ...serverConfig.security.userCreationGlobalRateLimit
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const username = generateRandomUsername();
      const accessToken = generateAccessToken();
      try {
        const user = await storage.createUser(username, hashAccessToken(accessToken));
        const state = await storage.getUserState(username);
        return ok({ username, accessToken, user, state });
      } catch (error) {
        if (!String(error).toLowerCase().includes("unique")) {
          throw error;
        }
      }
    }

    throw new Error("Unable to create a unique username");
  } catch (error) {
    return fail(error, 500);
  }
}
