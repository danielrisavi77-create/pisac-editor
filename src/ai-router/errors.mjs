export class RouterError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "RouterError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.safe = true;
  }
}

export function safeErrorPayload(error) {
  if (error?.safe) {
    return {
      code: error.code || "ROUTER_ERROR",
      message: String(error.message || "AI Router request failed.").slice(0, 300),
      ...(error.details ? { details: error.details } : {})
    };
  }
  return { code: "ROUTER_ERROR", message: "AI Router request failed." };
}
