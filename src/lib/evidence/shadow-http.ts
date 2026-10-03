export type LimitedJsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; reason: string };

export async function readJsonBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<LimitedJsonReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return { ok: false, status: 413, reason: "invalid request limit" };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (
      !Number.isFinite(declared) ||
      declared < 0 ||
      declared > maxBytes
    ) {
      return { ok: false, status: 413, reason: "request too large" };
    }
  }

  const text = await request.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    return { ok: false, status: 413, reason: "request too large" };
  }
  if (text.trim() === "") {
    return { ok: false, status: 400, reason: "empty JSON body" };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, reason: "invalid JSON body" };
  }
}
