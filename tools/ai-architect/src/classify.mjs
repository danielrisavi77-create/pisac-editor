const PURPOSE_TASK = {
  explain: "explanation",
  brainstorm: "brainstorm",
  language: "grammar",
  translate: "translation",
  restructure: "rewrite",
  generate: "generation",
  mentor: "mentor_feedback"
};

const RULES = [
  ["security_review", /security|sigurnost|secret|token|vulnerab|xss|csrf|sql injection|auth/i],
  ["document_repair", /docx|word|ooxml|format|repair|poprav|field|bookmark|footnote|header|footer/i],
  ["architecture", /architect|arhitektur|system design|workflow|orchestrat|repo structure/i],
  ["coding", /code|bug|fix|implement|refactor|typescript|javascript|python|api|test|ci|github action/i],
  ["mentor_feedback", /mentor feedback|komentar mentora|povratna informacija mentora|review rada/i],
  ["hallucination_check", /hallucinat|izmišlj|fabricat|ne izmišlj/i],
  ["source_synthesis", /source synthesis|sintez.*izvor|synthesize.*source/i],
  ["research", /research|istraž|literatur|pronađ.*izvor|web search|deep research/i],
  ["data_analysis", /statistic|analiz.*podat|dataset|csv|regression|correlation|anova|jamovi/i],
  ["translation", /translate|prijevod|preved/i],
  ["brainstorm", /brainstorm|ideje|mogući pravci/i],
  ["rewrite", /rewrite|prepi|uredi|polish|improve|poboljš|sažmi|summari|restruktur/i],
  ["grammar", /grammar|gramatik|pravopis|spelling|lekt|jezič/i],
  ["explanation", /explain|objasni|objašnjenje|što znači/i]
];

const VERIFY_INTENT = /verify|verification|provjer|check|validate|validir|potvrd|točnost/i;
const CITATION_SIGNAL = /citation|citat|doi|reference|referenc|bibliograph|izvor/i;

export function classifyTask(text = "", context = {}) {
  if (context.taskHint) return String(context.taskHint);
  if (context.purpose && PURPOSE_TASK[context.purpose]) return PURPOSE_TASK[context.purpose];

  const normalized = String(text).trim();
  if (VERIFY_INTENT.test(normalized) && CITATION_SIGNAL.test(normalized)) {
    return "citation_verification";
  }

  for (const [kind, regex] of RULES) {
    if (regex.test(normalized)) return kind;
  }
  return "generic";
}

export function estimateComplexity(text = "", task = classifyTask(text), context = {}) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  let score = words > 180 ? 4 : words > 80 ? 3 : words > 25 ? 2 : 1;
  if (["architecture","research","source_synthesis","citation_verification","security_review","document_repair","data_analysis"].includes(task)) score += 1;
  if (/multiple|više|entire|cijel|full repo|whole repo|production|release/i.test(text)) score += 1;
  if (context.selectedText && context.selectedText.length > 5000) score += 1;
  return Math.max(1, Math.min(5, score));
}

export function estimateRisk(text = "", task = classifyTask(text), context = {}) {
  if (context.riskOverride) return context.riskOverride;
  if (["security_review","citation_verification","document_repair","hallucination_check"].includes(task)) return "high";
  if (/production|release|delete|payment|billing|medical|legal|security/i.test(text)) return "high";
  if (["research","source_synthesis","architecture","data_analysis","coding","mentor_feedback"].includes(task)) return "medium";
  return "low";
}
