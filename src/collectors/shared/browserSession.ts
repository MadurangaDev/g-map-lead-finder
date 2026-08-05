import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { logger } from "../../utils/logger";

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async getPage(): Promise<Page> {
    if (!this.browser || !this.context) {
      logger.info("Launching browser");
      this.browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      this.context = await this.browser.newContext();
    }
    return this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // ignore
      }
      this.context = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore
      }
      this.browser = null;
    }
  }
}