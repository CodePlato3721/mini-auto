import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import type { HumanHandoffController } from "../application/ports/human-handoff.js";

export function createTerminalHandoffController(
  input: Readable = process.stdin,
  output: Writable = process.stdout
): HumanHandoffController {
  return {
    async waitForResume(context) {
      output.write(
        [
          "",
          "Human handoff requested.",
          `Goal: ${context.request.goal}`,
          `Step: ${context.request.stepId}`,
          `Reason: ${context.request.reason}`,
          `Observed: ${context.request.observed}`,
          `Evidence: ${context.request.evidence.join(", ")}`,
          "",
          "Use the visible Chromium window to inspect or fix the live session.",
          "",
          "Operator choices:",
          "- Fix the issue in the visible browser, then type: resume",
          "- If it cannot be fixed, type: fail <reason>",
          ""
        ].join("\n")
      );
      const readline = createInterface({ input, output });
      try {
        while (true) {
          const command = (await readline.question("Operator command: ")).trim();
          if (command === "resume" || command.startsWith("resume:") || command.startsWith("resume ")) {
            const inlineDescription = command === "resume" ? "" : command.slice("resume".length).replace(/^:/, "").trim();
            const description =
              inlineDescription.length > 0 ? inlineDescription : await readline.question("Human activity summary (optional): ");
            return {
              signal: "resume",
              activities: description.trim().length > 0 ? [{ description }] : [{ description: "Human resumed automation." }]
            };
          }

          if (command.startsWith("fail ")) {
            const reason = command.slice("fail ".length).trim();
            if (reason.length > 0) {
              return {
                signal: "fail",
                reason,
                activities: [{ description: `Human could not resolve handoff: ${reason}` }]
              };
            }
          }

          output.write("Type 'resume' or 'fail <reason>'.\n");
        }
      } finally {
        readline.close();
      }
    }
  };
}
