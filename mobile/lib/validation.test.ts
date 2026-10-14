import { checkPasswordRequirements, passwordRequirementList } from "./validation";

describe("checkPasswordRequirements", () => {
  test("a password meeting every requirement is valid", () => {
    expect(checkPasswordRequirements("Abcdef1!")).toEqual({ valid: true, missing: [] });
  });

  test("too short lists the length requirement", () => {
    expect(checkPasswordRequirements("Ab1!").missing).toContain("at least 8 characters");
  });

  test("missing an uppercase letter is reported", () => {
    expect(checkPasswordRequirements("abcdefg1!").missing).toContain("an uppercase letter");
  });

  test("missing a lowercase letter is reported", () => {
    expect(checkPasswordRequirements("ABCDEFG1!").missing).toContain("a lowercase letter");
  });

  test("missing a number is reported", () => {
    expect(checkPasswordRequirements("Abcdefgh!").missing).toContain("a number");
  });

  test("missing a symbol is reported", () => {
    expect(checkPasswordRequirements("Abcdefg1").missing).toContain("a symbol");
  });

  test("an empty password lists every requirement", () => {
    const result = checkPasswordRequirements("");
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(5);
  });
});

describe("passwordRequirementList", () => {
  it("marks every rule unmet for an empty password", () => {
    expect(passwordRequirementList("").every((rule) => !rule.met)).toBe(true);
  });

  it("marks only the rules a password satisfies", () => {
    const met = passwordRequirementList("abcdefgh1")
      .filter((rule) => rule.met)
      .map((rule) => rule.label);
    expect(met).toEqual([
      "At least 8 characters",
      "At least 1 lowercase letter",
      "At least 1 number",
    ]);
  });

  it("marks every rule met for a valid password", () => {
    expect(passwordRequirementList("Abcdef1!").every((rule) => rule.met)).toBe(true);
  });
});
