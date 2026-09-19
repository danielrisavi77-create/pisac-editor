import { createHash } from "node:crypto";

export function hashText(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function truncateText(value, maxChars = 8000) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[context truncated]";
}

export function buildExecutionContext(taskText, context = {}, maxChars = 8000) {
  const safe = {
    feature: context.feature || null,
    purpose: context.purpose || null,
    taskHint: context.taskHint || null,
    locale: context.locale || "hr",
    selectedText: context.selectedText ? truncateText(context.selectedText, Math.min(maxChars, 6000)) : null,
    retrievedEvidence: Array.isArray(context.retrievedEvidence)
      ? context.retrievedEvidence.slice(0, 20).map((item) => ({
          title: item?.title || null,
          source: item?.source || item?.url || null,
          excerpt: truncateText(item?.excerpt || item?.text || "", 1500)
        }))
      : null,
    constraints: context.constraints || null
  };

  const serialized = JSON.stringify(safe);
  if (serialized.length <= maxChars) return safe;

  return {
    feature: safe.feature,
    purpose: safe.purpose,
    taskHint: safe.taskHint,
    locale: safe.locale,
    selectedText: safe.selectedText ? truncateText(safe.selectedText, Math.max(1000, maxChars - 2000)) : null,
    retrievedEvidence: null,
    constraints: safe.constraints
  };
}

export function privacyEnvelope(taskText, outputText, extra = {}) {
  return {
    taskHash: hashText(taskText),
    taskChars: String(taskText || "").length,
    outputHash: outputText == null ? null : hashText(outputText),
    outputChars: outputText == null ? 0 : String(outputText).length,
    ...extra
  };
}
