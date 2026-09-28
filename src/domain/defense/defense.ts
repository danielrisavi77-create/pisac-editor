import type { AcademicDecision } from "../decision";

export type DefenseQuestion = {
  id: string;
  prompt: string;
  sourceDecisionIds: readonly string[];
  expectedConcepts: readonly { id: string; label: string; terms: readonly string[] }[];
};

export type AnswerCoverage = {
  questionId: string;
  covered: readonly string[];
  missing: readonly string[];
};

export function questionsFromDecisions(decisions: readonly AcademicDecision[]): DefenseQuestion[] {
  return decisions.map((d) => ({
    id: `defense:${d.id}`,
    prompt:
      d.kind === "methodology"
        ? `Zašto ste donijeli metodološku odluku: „${d.title}”?`
        : d.kind === "interpretation"
          ? `Kako obrazlažete interpretativnu odluku: „${d.title}”?`
          : `Zašto ste u istraživanju odlučili: „${d.title}”?`,
    sourceDecisionIds: [d.id],
    expectedConcepts: [
      { id: `${d.id}:reason`, label: "razlog odluke", terms: keywords(d.rationale) },
      ...d.affects.slice(0, 3).map((ref) => ({
        id: `${d.id}:${ref.type}:${ref.id}`,
        label: `${ref.type}:${ref.id}`,
        terms: [ref.id.toLocaleLowerCase("hr-HR")],
      })),
    ],
  }));
}

function keywords(text: string): string[] {
  const stop = new Set(["koji","koja","koje","zbog","nije","nego","kako","samo","ovaj","ova","ovo","bez","više","manje"]);
  return [...new Set((text.toLocaleLowerCase("hr-HR").match(/\p{L}{5,}/gu) ?? []).filter((w) => !stop.has(w)))].slice(0, 8);
}

export function evaluateAnswerCoverage(question: DefenseQuestion, answer: string): AnswerCoverage {
  const normalized = answer.toLocaleLowerCase("hr-HR");
  const covered: string[] = [];
  const missing: string[] = [];
  for (const concept of question.expectedConcepts) {
    const hit = concept.terms.length > 0 && concept.terms.some((term) => normalized.includes(term));
    (hit ? covered : missing).push(concept.label);
  }
  return { questionId: question.id, covered, missing };
}
