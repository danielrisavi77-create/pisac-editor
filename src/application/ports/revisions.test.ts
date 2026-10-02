import { describe, expect, it } from "vitest";

import { asAcademicObjectRevision, asDocumentRevision } from "./revisions";

describe("explicit revision vocabulary", () => {
  it("allows document revision zero but academic object revisions start at one", () => {
    expect(asDocumentRevision(0)).toBe(0);
    expect(asAcademicObjectRevision(1)).toBe(1);
    expect(() => asAcademicObjectRevision(0)).toThrow("invalid academic object revision");
  });

  it("refuses unsafe, fractional and negative revisions", () => {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => asDocumentRevision(value)).toThrow("invalid document revision");
    }
  });
});
