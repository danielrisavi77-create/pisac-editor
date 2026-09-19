const RULES = [
  ["translation", /\b(translate|translation|prevedi|prijevod|prevesti)\w*/i],
  ["summarization", /\b(summar|sažmi|sažetak|rezimir|summary)\w*/i],
  ["rewrite", /\b(rewrite|rephrase|proofread|polish|preformul|prepi|ispravi|uredi tekst)\w*/i],
  ["citation_verification", /\b(citation|reference|bibliograph|izvor|citat|provjeri izvore|verify sources)\w*/i],
  ["debugging", /\b(debug|bug|error|exception|stack trace|failing test|pada test|grešk)\w*/i],
  ["repository_analysis", /\b(repo|repository|codebase|cijeli projekt|whole project|architecture audit)\b/i],
  ["architecture_design", /\b(architecture|arhitektur|system design|design system|workflow design)\w*/i],
  ["coding", /\b(code|typescript|javascript|python|function|class|implement|refactor|api|sql|programir)\w*/i],
  ["data_analysis", /\b(data analysis|dataset|csv|regression|statistic|analiza podataka|jamovi|excel)\w*/i],
  ["academic_writing", /\b(diplom|seminar|thesis|academic writing|napiši rad|teorijski uvod)\w*/i],
  ["academic_analysis", /\b(academic analysis|research paper|methodolog|istraživ|hipotez|literature review)\w*/i],
  ["extraction", /\b(extract|izvuci|izdvoji|parse|fields?|entities|entitet)\w*/i],
  ["classification", /\b(classif|klasific|categor|kategoriz)\w*/i],
  ["structured_output", /\b(json|schema|structured output|xml|yaml|csv format)\b/i],
  ["creative_writing", /\b(story|poem|creative|prič|pjesm|scenarij|script)\w*/i],
  ["simple_qa", /\b(what is|who is|when is|što je|tko je|kada je|objasni kratko)\b/i]
];

const HIGH_RISK = /\b(production|release|merge|deploy|security|payment|delete|migration|legal|medical|submit|predaj|objav|sigurn|pla[ćc]anj|bris|database migration|auth)\w*/gi;
const TOOL_SIGNAL = /\b(search|browse|web|github|gmail|drive|tool|function call|pretraži|otvori|provjeri online|repo)\w*/i;
const MULTI_STEP = /\b(and then|after that|zatim|onda|nakon toga|te potom|korak|step|first.*then)\b/gi;

const TYPE_DEFAULTS = {
  simple_qa: ["low", "low", "short", "general"], summarization: ["medium", "low", "medium", "general"],
  rewrite: ["medium", "low", "medium", "general"], translation: ["medium", "low", "medium", "general"],
  academic_writing: ["high", "high", "long", "academic"], academic_analysis: ["high", "high", "long", "academic"],
  citation_verification: ["high", "high", "medium", "academic"], coding: ["medium", "medium", "medium", "coding"],
  debugging: ["high", "high", "medium", "coding"], repository_analysis: ["high", "high", "long", "coding"],
  architecture_design: ["high", "high", "long", "general"], data_analysis: ["high", "high", "medium", "structured"],
  extraction: ["medium", "low", "short", "structured"], classification: ["low", "low", "short", "structured"],
  structured_output: ["medium", "medium", "medium", "structured"], creative_writing: ["medium", "medium", "long", "general"],
  general: ["medium", "medium", "medium", "general"]
};

export function analyzeTaskV2({ prompt, context = "", contextSegments = [], profile = "balanced", requirements = {} }) {
  const promptText = String(prompt || "");
  const contextText = String(context || "") + "\n" + contextSegments.map((x) => x?.text || "").join("\n");
  const combined = promptText + "\n" + contextText;
  const taskType = RULES.find(([, re]) => re.test(promptText))?.[0] || "general";
  const defaults = TYPE_DEFAULTS[taskType] || TYPE_DEFAULTS.general;
  const chars = combined.length;
  const words = combined.trim() ? combined.trim().split(/\s+/).length : 0;
  const riskHits = (combined.match(HIGH_RISK) || []).length;
  const steps = (promptText.match(MULTI_STEP) || []).length;
  const toolNeed = Boolean(requirements.tools || TOOL_SIGNAL.test(promptText));
  const codeEvidence = /\b(npm|pnpm|git|stack trace|exception|typescript|javascript|python|sql)\b/i.test(combined);
  const longContext = chars > 120000;
  const complexity = clamp(
    0.10 + Math.min(0.36, Math.log10(Math.max(chars, 100)) * 0.075) + Math.min(steps, 5) * 0.055 +
    (codeEvidence ? 0.08 : 0) + (toolNeed ? 0.06 : 0) + (longContext ? 0.10 : 0) +
    (["academic_analysis", "repository_analysis", "architecture_design", "debugging"].includes(taskType) ? 0.12 : 0),
    0.05, 1
  );
  const risk = clamp(0.06 + Math.min(riskHits, 6) * 0.14 + (profile === "critical" ? 0.08 : 0), 0.05, 1);
  const contextNeed = longContext ? "high" : defaults[0];
  const reasoningNeed = complexity >= 0.76 ? "high" : complexity <= 0.32 ? "low" : defaults[1];
  const expectedOutputSize = requirements.expectedOutputSize || defaults[2];
  const verificationType = requirements.verificationType || defaults[3];
  const requiredCapabilityRank = inferRequiredCapability({ taskType, complexity, risk, reasoningNeed });
  return {
    taskType, chars, words, complexity, risk, contextNeed, reasoningNeed, toolNeed, expectedOutputSize, verificationType,
    requiredCapabilityRank,
    requiredCapabilities: {
      tools: Boolean(requirements.tools),
      structuredOutput: Boolean(requirements.structuredOutput || verificationType === "structured"),
      images: Boolean(requirements.images),
      files: Boolean(requirements.files)
    },
    qualityEstimateSource: "heuristic"
  };
}

function inferRequiredCapability({ taskType, complexity, risk, reasoningNeed }) {
  let rank = 1;
  if (complexity >= 0.36 || reasoningNeed === "medium") rank = 2;
  if (complexity >= 0.64 || reasoningNeed === "high") rank = 3;
  if (risk >= 0.62 || (["repository_analysis", "academic_analysis"].includes(taskType) && complexity >= 0.72)) rank = 4;
  return Math.min(5, rank);
}

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
