import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type Locator, type Page } from "playwright";

import type {
  BrowserSurface,
  FailureEvidenceContext,
  ObservedControl,
  ResolvedLocator
} from "../../application/ports/browser-surface.js";
import type { LocatorCandidate } from "../../domain/contracts.js";

export async function createPlaywrightSurface(options: { headless?: boolean } = {}): Promise<BrowserSurface> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const page = await browser.newPage();
  return new PlaywrightSurface(browser, page);
}

class PlaywrightSurface implements BrowserSurface {
  constructor(
    private readonly browser: Browser,
    private readonly page: Page
  ) {}

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async click(locator: ResolvedLocator): Promise<void> {
    await this.toLocator(locator).click();
  }

  async type(locator: ResolvedLocator, value: string): Promise<void> {
    await this.toLocator(locator).fill(value);
  }

  async wait(milliseconds: number): Promise<void> {
    await this.page.waitForTimeout(milliseconds);
  }

  async extractText(locator: ResolvedLocator): Promise<string> {
    return (await this.toLocator(locator).textContent())?.trim() ?? "";
  }

  async hasLocator(candidate: LocatorCandidate): Promise<boolean> {
    return (await this.toLocator({ candidate, key: locatorKey(candidate), stepId: "locator-check" }).count()) > 0;
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async visibleText(): Promise<string> {
    return await this.page.locator("body").innerText();
  }

  async title(): Promise<string> {
    return await this.page.title();
  }

  async interactiveControls(): Promise<ObservedControl[]> {
    return await this.page.locator("a,button,input,select,textarea,[role=button]").evaluateAll((nodes) =>
      nodes.slice(0, 50).map((node) => {
        const element = node as HTMLElement;
        const testId = element.getAttribute("data-test") ?? element.getAttribute("data-testid");
        const label =
          element.getAttribute("aria-label") ??
          element.getAttribute("name") ??
          element.innerText ??
          element.getAttribute("value") ??
          "";
        const locatorCandidates = testId
          ? [{ strategy: "testId" as const, value: testId }]
          : [{ strategy: "text" as const, value: label.trim() }];
        return {
          text: label.trim(),
          locatorCandidates
        };
      })
    );
  }

  async screenshot(context: { evidenceDir: string; name: string }): Promise<string> {
    await mkdir(context.evidenceDir, { recursive: true });
    const screenshotPath = path.resolve(context.evidenceDir, `${context.name}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async captureFailureEvidence(context: FailureEvidenceContext): Promise<string[]> {
    await mkdir(context.evidenceDir, { recursive: true });
    const base = path.resolve(context.evidenceDir, `${context.artifactId}-${context.stepId}`);
    const screenshotPath = `${base}.png`;
    const snapshotPath = `${base}.html`;
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    await writeFile(snapshotPath, context.redact(await this.page.content()), "utf8");
    return [screenshotPath, snapshotPath];
  }

  private toLocator(locator: ResolvedLocator): Locator {
    const { candidate } = locator;
    switch (candidate.strategy) {
      case "testId":
        return this.page.locator(`[data-test="${candidate.value}"], [data-testid="${candidate.value}"]`);
      case "role":
        return this.page.getByRole("button", { name: candidate.name ?? candidate.value });
      case "label":
        return this.page.getByLabel(candidate.value);
      case "text":
        return this.page.getByText(candidate.value);
      case "relativeText": {
        const [anchor, target] = candidate.value.split(">>").map((part) => part.trim());
        if (anchor && target) {
          return this.page
            .getByText(anchor, { exact: true })
            .locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' inventory_item ')][1]")
            .getByRole("button", { name: target });
        }
        return this.page.getByText(candidate.value);
      }
      case "css":
        return this.page.locator(candidate.value);
      case "xpath":
        return this.page.locator(`xpath=${candidate.value}`);
      case "url":
        return this.page.locator("body");
      case "visual":
        throw new Error("Visual locators are not supported by the Playwright adapter yet");
    }
  }
}

function locatorKey(candidate: LocatorCandidate): string {
  return `${candidate.strategy}:${candidate.value}`;
}
