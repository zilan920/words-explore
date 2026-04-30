import { generateRandomUsername } from "@/lib/username";
import { getStorage } from "@/lib/db/storage";
import { fail, ok } from "@/lib/api";

export const runtime = "nodejs";

export async function POST() {
  try {
    const storage = await getStorage();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const username = generateRandomUsername();
      try {
        const user = await storage.createUser(username);
        const state = await storage.getUserState(username);
        return ok({ username, user, state });
      } catch (error) {
        if (!String(error).includes("UNIQUE")) {
          throw error;
        }
      }
    }

    throw new Error("Unable to create a unique username");
  } catch (error) {
    return fail(error, 500);
  }
}
