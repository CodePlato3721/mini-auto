import { describe, expect, it } from "vitest";

import { enrichInputsFromGoal } from "../src/application/goal-inputs.js";

describe("goal input enrichment", () => {
  it("fills known username and product from the goal and password from the environment", () => {
    const inputs = { firstName: "Ada", lastName: "Lovelace" };

    const enriched = enrichInputsFromGoal({
      inputs,
      goal: "Log in as problem_user, add Sauce Labs Fleece Jacket to the cart, and complete checkout.",
      env: { MINI_AUTO_PASSWORD: "secret_sauce" }
    });

    expect(enriched).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      username: "problem_user",
      productName: "Sauce Labs Fleece Jacket",
      password: "secret_sauce"
    });
    expect(inputs).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("keeps explicit inputs when the goal and environment also contain defaults", () => {
    const enriched = enrichInputsFromGoal({
      inputs: {
        username: "standard_user",
        productName: "Sauce Labs Backpack",
        password: "provided"
      },
      goal: "Log in as problem_user and buy Sauce Labs Fleece Jacket.",
      env: { MINI_AUTO_PASSWORD: "secret_sauce" }
    });

    expect(enriched).toMatchObject({
      username: "standard_user",
      productName: "Sauce Labs Backpack",
      password: "provided"
    });
  });
});
