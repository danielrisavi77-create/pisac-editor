export type LimitedJsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; reason: string };

export function isPinnedSameOrigin(
  request: Request,
  pinnedOrigin: string,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(pinnedOrigin).origin;
  } catch {
    return false;
  }
}

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
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > maxBytes
    ) {
      return { ok: false, status: 413, reason: "request too large" };
    }
  }

  if (!request.body) {
    return { ok: false, status: 400, reason: "empty JSON body" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, reason: "request too large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, reason: "request body unreadable" };
  }

  if (total === 0) {
    return { ok: false, status: 400, reason: "empty JSON body" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, reason: "invalid JSON body" };
  }
}
