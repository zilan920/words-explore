import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { usernameSchema, fail } from "@/lib/api";
import { getStorage, writeBundleToSqlite } from "@/lib/db/storage";
import { requireUserAuth } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tempPath = join(tmpdir(), `words-explore-${randomUUID()}.sqlite`);

  try {
    const url = new URL(request.url);
    const username = usernameSchema.parse(url.searchParams.get("username"));
    const storage = await getStorage();
    await requireUserAuth(request, storage, username);
    const bundle = await storage.exportUserBundle(username);

    await writeBundleToSqlite(bundle, tempPath);
    const bytes = await readFile(tempPath);

    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${username}.sqlite"`
      }
    });
  } catch (error) {
    return fail(error);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
