export function validateOutput(output, plan = {}) {
  const text = String(output ?? "").trim();
  const checks = [
    {
      id: "non-empty",
      passed: text.length > 0,
      reason: text.length > 0 ? null : "Provider returned an empty response."
    }
  ];

  if (plan?.task === "citation_verification") {
    const suspicious = /doi:\s*10\.\d{4,9}\//i.test(text) && !plan?.retrieval?.evidenceProvided;
    checks.push({
      id: "no-unverified-doi-invention",
      passed: !suspicious,
      reason: suspicious ? "Response contains a DOI although no retrieved evidence was supplied." : null
    });
  }

  return {
    passed: checks.every((c) => c.passed),
    checks
  };
}

export function parseVerifierVerdict(text = "") {
  const first = String(text).trim().split(/\r?\n/, 1)[0].toUpperCase();
  if (first.includes("VERDICT: PASS")) return { passed: true, raw: text };
  if (first.includes("VERDICT: FAIL")) return { passed: false, raw: text };
  return { passed: false, raw: text, malformed: true };
}
