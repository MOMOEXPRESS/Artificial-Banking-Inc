import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverIdentity, supabaseConfig, sameOrigin } from "@/lib/supabase/server";
import { validatePrivateFile, PRIVATE_FILE_MAX } from "@/lib/private-file-validation";
export const dynamic = "force-dynamic";
async function authorized(req: NextRequest) {
  const s = serverIdentity(req);
  const {
    data: { user },
    error,
  } = await s.client.auth.getUser();
  if (error && (!error.status || error.status >= 500 || error.name === "AuthRetryableFetchError"))
    throw error;
  if (error || !user) return null;
  return { ...s, user };
}
const failure = (message: string, status = 400) =>
  NextResponse.json({ error: { message } }, { status, headers: { "cache-control": "no-store" } });
export async function GET(req: NextRequest) {
  try {
    const s = await authorized(req);
    if (!s) return failure("Connect your Google or GitHub sign-in to use private files.", 401);
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      if (!z.string().uuid().safeParse(id).success) return s.apply(failure("File not found.", 404));
      const { data: file, error } = await s.client
        .from("abi_files")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !file) return s.apply(failure("File not found.", 404));
      const result = await s.client.storage.from("abi-private-files").download(file.object_path);
      if (result.error || !result.data)
        return s.apply(failure("The file could not be downloaded. Try again.", 503));
      return s.apply(
        new NextResponse(result.data, {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "x-content-type-options": "nosniff",
            "cache-control": "no-store",
          },
        }),
      );
    }
    const {
      data: { session },
    } = await s.client.auth.getSession();
    const config = supabaseConfig()!;
    const r = await fetch(`${config.url}/functions/v1/abi-user-data`, {
      method: "POST",
      headers: {
        apikey: config.key,
        authorization: `Bearer ${session?.access_token}`,
        "content-type": "application/json",
      },
      body: '{"tool":"files"}',
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return s.apply(failure("Private files could not load. Try again.", r.status));
    return s.apply(NextResponse.json(await r.json()));
  } catch {
    return failure("Private files are temporarily unavailable.", 503);
  }
}
function mutationAllowed(req: NextRequest) {
  const csrf = req.cookies.get("abi_csrf")?.value;
  return sameOrigin(req) && !!csrf && req.headers.get("x-abi-csrf") === csrf;
}
export async function POST(req: NextRequest) {
  if (!mutationAllowed(req)) return failure("Reload this page before uploading.", 403);
  try {
    const s = await authorized(req);
    if (!s) return failure("Sign in with Google or GitHub first.", 401);
    if (!req.body) return s.apply(failure("Choose a file."));
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > PRIVATE_FILE_MAX + 100000) {
        await reader.cancel();
        return s.apply(failure("Files must be under 3 MB.", 413));
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.length;
    }
    const form = await new Response(body, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return s.apply(failure("Choose a file."));
    const content = new Uint8Array(await file.arrayBuffer());
    let spec;
    try {
      spec = validatePrivateFile(file.name, content);
    } catch (e) {
      return s.apply(failure((e as Error).message));
    }
    const id = crypto.randomUUID(),
      path = `${s.user.id}/${id}.${spec.extension}`;
    const uploaded = await s.client.storage
      .from("abi-private-files")
      .upload(path, content, { contentType: spec.mime, upsert: false });
    if (uploaded.error) return s.apply(failure("The file could not be uploaded. Try again.", 503));
    const saved = await s.client.from("abi_files").insert({
      id,
      owner_id: s.user.id,
      object_path: path,
      name: spec.name,
      mime_type: spec.mime,
      size_bytes: content.length,
    });
    if (saved.error) {
      await s.client.storage.from("abi-private-files").remove([path]);
      return s.apply(failure("The file record could not be saved. Try again.", 503));
    }
    return s.apply(NextResponse.json({ id, name: spec.name }, { status: 201 }));
  } catch {
    return failure("The upload could not finish. Try again.", 503);
  }
}
export async function DELETE(req: NextRequest) {
  if (!mutationAllowed(req)) return failure("Reload before deleting a file.", 403);
  try {
    const s = await authorized(req);
    if (!s) return failure("Sign in again.", 401);
    const body = z
      .object({ id: z.string().uuid() })
      .strict()
      .safeParse(await req.json());
    if (!body.success) return s.apply(failure("Choose a file."));
    const { data: file } = await s.client
      .from("abi_files")
      .select("object_path")
      .eq("id", body.data.id)
      .single();
    if (!file) return s.apply(failure("File not found.", 404));
    const removed = await s.client.storage.from("abi-private-files").remove([file.object_path]);
    if (removed.error) return s.apply(failure("The file could not be deleted. Try again.", 503));
    const deleted = await s.client.from("abi_files").delete().eq("id", body.data.id);
    if (deleted.error)
      return s.apply(failure("The file record could not be deleted. Refresh to retry.", 503));
    return s.apply(NextResponse.json({ ok: true }));
  } catch {
    return failure("The file could not be deleted. Try again.", 503);
  }
}
