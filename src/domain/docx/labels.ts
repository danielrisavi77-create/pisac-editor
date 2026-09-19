/**
 * What the author is told after an export (F1-6). Croatian, pure, testable.
 *
 * Two claims are kept apart, exactly as the sync states keep durability and
 * server state apart:
 *
 *   1. Fidelity — what the FILE carries. Either every node and mark was mapped
 *      exactly, or some were not and the count says how many. No percentage:
 *      "97% vjerno" is a number nobody can act on, and it reads as a promise.
 *   2. Provenance — which VERSION the file was built from. The export is built
 *      from the document in this tab, so whenever the local queue is not
 *      demonstrably empty (or the state is not SYNCED) the message says the
 *      file contains local changes. It must never be read as "this is the
 *      version on the server".
 */

import { partsHr, pluralHr } from "@/lib/i18n/hr";

import type { ExportManifest } from "./manifest";

export const EXPORT_FIDELITY_FULL = "Izvezeno. Vjernost: potpuna.";

/** Added whenever the exported text is not provably the server's version. */
export const EXPORT_LOCAL_CHANGES_NOTE = "Izvoz sadrži lokalne promjene.";

/**
 * The count and the predicate that agrees with it (F1-9b).
 *
 * Croatian makes the verb and the adjective follow the number as well as the
 * noun — "1 dio je približan", "2 dijela su približna", "5 dijelova je
 * približno" — so both halves go through the same rule. The alternative, a
 * bare "(3)" in brackets, was shorter and read like a machine talking.
 */
function approximatePartsClause(count: number): string {
  const predicate = pluralHr(
    count,
    "je približan ili nepoznat",
    "su približna ili nepoznata",
    "je približno ili nepoznato",
  );
  return `${partsHr(count)} ${predicate}`;
}

export function exportFidelitySentence(manifest: ExportManifest): string {
  if (manifest.overallLabel === "SUPPORTED_EXACT") {
    return EXPORT_FIDELITY_FULL;
  }
  return `Izvezeno. ${approximatePartsClause(manifest.entries.length)}.`;
}

/** The whole line: fidelity, plus the provenance note when it applies. */
export function exportSummaryMessage(
  manifest: ExportManifest,
  localChangesIncluded: boolean,
): string {
  const fidelity = exportFidelitySentence(manifest);
  return localChangesIncluded
    ? `${fidelity} ${EXPORT_LOCAL_CHANGES_NOTE}`
    : fidelity;
}
