import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ApiError, fail, ok, usernameSchema } from "@/lib/api";
import { getStorage, readBundleFromSqlite } from "@/lib/db/storage";
import { serverConfig } from "@/lib/serverConfig";
import { requireUserAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const tempPath = join(tmpdir(), `words-explore-import-${randomUUID()}.sqlite`);

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const username = usernameSchema.parse(formData.get("username"));

    if (!(file instanceof File)) {
      throw new ApiError(400, "需要上传 SQLite 文件");
    }

    if (file.size > serverConfig.security.importLimits.maxFileBytes) {
      throw new ApiError(413, "SQLite 文件过大");
    }

    const storage = await getStorage();
    await requireUserAuth(request, storage, username);

    await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const bundle = await readBundleFromSqlite(tempPath);
    const user = await storage.importUserBundle(bundle, username);
    const state = await storage.getUserState(user.username);

    return ok({ username: user.username, user, state });
  } catch (error) {
    return fail(error);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
