export function verifyResult({ text, analysis, verification = {}, profile = "balanced" }) {
  const failures = [];
  const trimmed = String(text || "").trim();
  if (!trimmed) failures.push(failure("empty_response", "The model returned no usable text.", true, "same-or-stronger"));

  const minChars = Number.isFinite(verification.minChars) ? verification.minChars : 1;
  if (trimmed.length < minChars) failures.push(failure("response_too_short", "Response is shorter than the required contract.", true, "same-or-stronger"));

  for (const pattern of verification.requiredPatterns || []) {
    const re = toRegex(pattern);
    if (re && !re.test(trimmed)) failures.push(failure("required_pattern_missing", "A required output pattern is missing.", true, "same-or-stronger"));
  }
  for (const pattern of verification.forbiddenPatterns || []) {
    const re = toRegex(pattern);
    if (re && re.test(trimmed)) failures.push(failure("forbidden_pattern_present", "A forbidden output pattern is present.", true, "same-or-stronger"));
  }

  if (analysis.verificationType === "structured" || verification.jsonSchema) {
    verifyStructured(trimmed, verification.jsonSchema, failures);
  }
  if (analysis.verificationType === "academic") {
    verifyAcademic(trimmed, verification, failures);
  }
  if (analysis.verificationType === "coding") {
    verifyCoding(verification, profile, failures);
  }

  const hardFailures = failures.filter((x) => x.severity !== "warning");
  const passed = hardFailures.length === 0;
  const score = passed ? Math.max(0.75, 1 - failures.length * 0.05) : Math.max(0, 1 - hardFailures.length * 0.25 - failures.length * 0.05);
  return {
    passed,
    score: round3(score),
    failures,
    retryable: hardFailures.some((x) => x.retryable),
    suggestedEscalation: hardFailures.find((x) => x.suggestedEscalation)?.suggestedEscalation || null,
    method: "deterministic-v1"
  };
}

function verifyStructured(text, schema, failures) {
  let value;
  try { value = JSON.parse(stripFence(text)); }
  catch {
    failures.push(failure("invalid_json", "Structured output is not valid JSON.", true, "same-or-stronger"));
    return;
  }
  if (!schema || typeof schema !== "object") return;
  if (schema.type && !matchesType(value, schema.type)) {
    failures.push(failure("schema_type_mismatch", "JSON output does not match the required top-level type.", true, "same-or-stronger"));
    return;
  }
  if (schema.type === "object" && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!(key in value)) failures.push(failure("required_field_missing", "Required field is missing: " + key, true, "same-or-stronger"));
    }
  }
  if (schema.type === "object" && schema.properties) {
    for (const [key, property] of Object.entries(schema.properties)) {
      if (key in value && property?.type && !matchesType(value[key], property.type)) {
        failures.push(failure("field_type_mismatch", "Field has the wrong type: " + key, true, "same-or-stronger"));
      }
    }
  }
}

function verifyAcademic(text, verification, failures) {
  if (verification.requireCitations) {
    const hasCitation = /\[[0-9,\s-]+\]|\([A-ZČĆŽŠĐ][^)]*,\s*\d{4}[a-z]?\)|https?:\/\/|doi:/i.test(text);
    if (!hasCitation) failures.push(failure("citation_signal_missing", "The response contract requires citations but none were detected.", true, "stronger"));
  }
  if (verification.requireReferencesSection && !/\b(references|literatura|bibliografija)\b/i.test(text)) {
    failures.push(failure("references_section_missing", "The response contract requires a references section.", true, "stronger"));
  }
}

function verifyCoding(verification, profile, failures) {
  const checks = verification.externalChecks || {};
  const named = ["syntax", "typecheck", "lint", "unit", "integration", "schema"];
  const supplied = named.filter((name) => checks[name] != null);
  for (const name of supplied) {
    const check = checks[name];
    const passed = typeof check === "boolean" ? check : Boolean(check?.passed);
    if (!passed) failures.push(failure("external_check_failed", "External check failed: " + name, true, "stronger"));
  }
  if (verification.requireExternalChecks && supplied.length === 0) {
    failures.push({
      ...failure("external_checks_missing", "Required deterministic code checks were not supplied.", false, null),
      severity: profile === "critical" ? "error" : "warning"
    });
  }
}

function failure(code, message, retryable, suggestedEscalation) {
  return { code, message, retryable, suggestedEscalation, severity: "error" };
}
function stripFence(text) {
  return text.replace(/^\s*~~~(?:json)?\s*/i, "").replace(/\s*~~~\s*$/i, "")
    .replace(/^\s*\u0060\u0060\u0060(?:json)?\s*/i, "").replace(/\s*\u0060\u0060\u0060\s*$/i, "");
}
function toRegex(pattern) {
  try { return pattern instanceof RegExp ? pattern : new RegExp(String(pattern), "i"); }
  catch { return null; }
}
function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}
function round3(value) { return Math.round(value * 1000) / 1000; }
