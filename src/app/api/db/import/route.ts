import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/api";
import { getStorage, readBundleFromSqlite } from "@/lib/db/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tempPath = join(tmpdir(), `words-explore-import-${randomUUID()}.sqlite`);

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new Error("SQLite file is required");
    }

    await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const bundle = await readBundleFromSqlite(tempPath);
    const storage = await getStorage();
    const user = await storage.importUserBundle(bundle);
    const state = await storage.getUserState(user.username);

    return ok({ username: user.username, user, state });
  } catch (error) {
    return fail(error);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
