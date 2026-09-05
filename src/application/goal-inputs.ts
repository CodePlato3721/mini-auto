export type GoalInputEnvironment = {
  MINI_AUTO_PASSWORD?: string;
};

export function enrichInputsFromGoal(args: {
  inputs: Record<string, unknown>;
  goal?: string;
  env: GoalInputEnvironment;
}): Record<string, unknown> {
  const enriched = { ...args.inputs };

  if (enriched.password === undefined && args.env.MINI_AUTO_PASSWORD) {
    enriched.password = args.env.MINI_AUTO_PASSWORD;
  }

  if (enriched.username === undefined && args.goal) {
    const username = inferKnownUsername(args.goal);
    if (username) {
      enriched.username = username;
    }
  }

  if (enriched.productName === undefined && args.goal) {
    const productName = inferKnownProductName(args.goal);
    if (productName) {
      enriched.productName = productName;
    }
  }

  return enriched;
}

export function inferKnownUsername(goal: string): string | undefined {
  const knownUsernames = [
    "standard_user",
    "locked_out_user",
    "problem_user",
    "performance_glitch_user",
    "error_user",
    "visual_user"
  ];
  const normalizedGoal = goal.toLowerCase();
  return knownUsernames.find((username) => normalizedGoal.includes(username.toLowerCase()));
}

export function inferKnownProductName(goal: string): string | undefined {
  const knownProducts = [
    "Sauce Labs Backpack",
    "Sauce Labs Bike Light",
    "Sauce Labs Bolt T-Shirt",
    "Sauce Labs Fleece Jacket",
    "Sauce Labs Onesie",
    "Test.allTheThings() T-Shirt (Red)"
  ];
  const normalizedGoal = goal.toLowerCase();
  return knownProducts.find((product) => normalizedGoal.includes(product.toLowerCase()));
}
