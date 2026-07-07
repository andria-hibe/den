import { describe, it, expect } from "vitest";
import { tidyTitle } from "./discover.ts";

describe("tidyTitle", () => {
  it("collapses whitespace", () => {
    expect(tidyTitle("fix   the\n\n  bug")).toBe("fix the bug");
  });

  it("strips leading markdown / emoji / punctuation noise", () => {
    expect(tidyTitle("### Heading here")).toBe("Heading here");
    expect(tidyTitle("> quoted line")).toBe("quoted line");
    expect(tidyTitle("- bullet point")).toBe("bullet point");
    expect(tidyTitle("— dashed")).toBe("dashed");
  });

  it("caps at 80 characters", () => {
    expect(tidyTitle("x".repeat(200))).toHaveLength(80);
  });

  it("falls back for empty / noise-only input", () => {
    expect(tidyTitle("")).toBe("(untitled session)");
    expect(tidyTitle("###   ")).toBe("(untitled session)");
  });
});
