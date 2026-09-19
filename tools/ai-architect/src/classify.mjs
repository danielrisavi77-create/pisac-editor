const RULES = [
  ["security_review", /security|sigurnost|secret|token|vulnerab|xss|csrf|sql injection|auth/i],
  ["document_repair", /docx|word|ooxml|format|repair|poprav|field|bookmark|footnote|header|footer/i],
  ["architecture", /architect|arhitektur|system design|workflow|orchestrat|repo structure/i],
  ["coding", /code|bug|fix|implement|refactor|typescript|javascript|python|api|test|ci|github action/i],
  ["research", /research|istraž|literature|literatura|source synthesis|sintez.*izvor|web search|deep research/i],
  ["data_analysis", /statistic|analiz.*podat|dataset|csv|regression|correlation|anova|jamovi/i],
  ["rewrite", /rewrite|prepi|uredi|polish|improve|poboljš|sažmi|summari/i],
  ["grammar", /grammar|gramatik|pravopis|spelling|lekt/i]
];

const VERIFY_INTENT = /verify|verification|provjer|check|validate|validir|potvrd|točnost/i;
const CITATION_SIGNAL = /citation|citat|doi|reference|referenc|bibliograph|izvor/i;

export function classifyTask(text = "") {
  const normalized = String(text).trim();

  if (VERIFY_INTENT.test(normalized) && CITATION_SIGNAL.test(normalized)) {
    return "citation_verification";
  }

  for (const [kind, regex] of RULES) {
    if (regex.test(normalized)) return kind;
  }
  return "generic";
}

export function estimateComplexity(text = "", task = classifyTask(text)) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  let score = words > 180 ? 4 : words > 80 ? 3 : words > 25 ? 2 : 1;
  if (["architecture","research","citation_verification","security_review","document_repair","data_analysis"].includes(task)) score += 1;
  if (/multiple|više|entire|cijel|full repo|whole repo|production|release/i.test(text)) score += 1;
  return Math.max(1, Math.min(5, score));
}

export function estimateRisk(text = "", task = classifyTask(text)) {
  if (["security_review","citation_verification","document_repair"].includes(task)) return "high";
  if (/production|release|delete|payment|billing|medical|legal|security/i.test(text)) return "high";
  if (["research","architecture","data_analysis","coding"].includes(task)) return "medium";
  return "low";
}
