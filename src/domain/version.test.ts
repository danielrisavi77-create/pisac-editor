import { describe, expect, it } from "vitest";
import { F1_KERNEL_VERSION } from "./version";

describe("F1_KERNEL_VERSION", () => {
  it("is the seeded semantic version of the authoring kernel", () => {
    expect(F1_KERNEL_VERSION).toBe("0.0.1");
  });

  it("is a semantic version string", () => {
    expect(F1_KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
