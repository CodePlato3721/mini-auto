import {
  DiscoveryError,
  type BrowserObservation,
  type DecisionEngine,
  type DiscoveryContext
} from "../../application/discovery.js";

export function createOpenAiDecisionEngine(env: NodeJS.ProcessEnv = process.env): DecisionEngine {
  return new OpenAiDecisionEngine(env.MINI_AUTO_MODEL_API_KEY);
}

class OpenAiDecisionEngine implements DecisionEngine {
  constructor(
    private readonly apiKey?: string,
    private readonly model = "gpt-5-mini"
  ) {}

  async decide(observation: BrowserObservation, context: DiscoveryContext): Promise<unknown> {
    if (!this.apiKey) {
      throw new DiscoveryError("decision", "MINI_AUTO_MODEL_API_KEY", "Missing model API key");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: "system",
            content: [
              "You are discovering a browser workflow and must choose the next single action that moves toward the user's goal.",
              "Return only JSON. Do not include prose.",
              "",
              "Return either a completion object when the goal is satisfied:",
              "{\"complete\":true,\"reason\":\"Goal is satisfied.\"}",
              "",
              "Or return one action object with this shape:",
              "{\"action\":\"click\",\"description\":\"Click the matching control.\",\"target\":{\"locatorCandidates\":[{\"strategy\":\"testId\",\"value\":\"example-id\"}]},\"inputBindings\":{},\"outputBindings\":{},\"risk\":\"safe\"}",
              "",
              "Choose controls by matching the goal, visible text, interactive controls, prior steps, and inputs.",
              "Prefer stable locator candidates from interactiveControls, especially testId/data-testid. Use text/role/label when stable ids are unavailable.",
              "When the goal names a product or record, choose the control associated with that exact item. For product lists, prefer relativeText like \"<productName> >> Add to cart\" when needed.",
              "For type actions, set inputBindings.value to the input name, not the input value. Example: {\"inputBindings\":{\"value\":\"username\"}}.",
              "Do not copy passwords or other sensitive input values into the action JSON.",
              "",
              "Allowed action values are exactly: navigate, click, type, wait, extract, checkpoint.",
              "Allowed locator strategies are exactly: testId, role, label, text, css, xpath, url, relativeText, visual.",
              "Allowed risk values are exactly: safe, risky, irreversible.",
              "",
              "Risk rules:",
              "- safe: navigation, reading/extracting text, waiting, opening views, typing into fields, logging in or signing in to establish the session, add-to-cart/cart setup in a demo store, or other reversible local UI movement.",
              "- risky: final business submissions such as finishing/finalizing checkout, placing or confirming orders, saving changes, sending messages, approving workflow steps, or committing business state changes.",
              "- irreversible: deleting records, transferring money, closing accounts, final external payments, or actions that are hard or impossible to undo.",
              "Always include risk. Discovery records the risk label; replay uses it later for handoff or blocking.",
              "",
              "Examples:",
              "{\"action\":\"type\",\"description\":\"Enter username.\",\"target\":{\"locatorCandidates\":[{\"strategy\":\"testId\",\"value\":\"username\"}]},\"inputBindings\":{\"value\":\"username\"},\"outputBindings\":{},\"risk\":\"safe\"}",
              "{\"action\":\"click\",\"description\":\"Add the requested product to the cart.\",\"target\":{\"locatorCandidates\":[{\"strategy\":\"relativeText\",\"value\":\"Sauce Labs Backpack >> Add to cart\"}]},\"inputBindings\":{},\"outputBindings\":{},\"risk\":\"safe\"}",
              "{\"action\":\"click\",\"description\":\"Finish checkout.\",\"target\":{\"locatorCandidates\":[{\"strategy\":\"testId\",\"value\":\"finish\"}]},\"inputBindings\":{},\"outputBindings\":{},\"risk\":\"risky\"}"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ observation: sanitizeObservation(observation), context })
          }
        ]
      })
    });

    if (!response.ok) {
      throw new DiscoveryError("decision", "Successful model response", `${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as unknown;
    const outputText = extractResponseText(body);
    if (!outputText) {
      throw new DiscoveryError("decision", "Model output_text JSON", JSON.stringify(body));
    }

    return JSON.parse(outputText) as unknown;
  }
}

function sanitizeObservation(observation: BrowserObservation): BrowserObservation {
  return {
    ...observation,
    visibleText: observation.visibleText.slice(0, 4000),
    interactiveControls: observation.interactiveControls.slice(0, 50)
  };
}

function extractResponseText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  if ("output_text" in body && typeof body.output_text === "string") {
    return body.output_text;
  }

  const output = "output" in body && Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (typeof content === "object" && content !== null && "text" in content && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return undefined;
}
