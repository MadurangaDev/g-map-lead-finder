import type { Page } from "playwright";
import { logger } from "../../utils/logger";

export async function extractText(
  page: Page,
  selector: string,
): Promise<string | null> {
  try {
    const el = page.locator(selector).first();
    const text = await el.textContent();
    return text?.trim() || null;
  } catch {
    return null;
  }
}

export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(1500);
}

export async function scrollContainer(
  page: Page,
  selector: string,
): Promise<void> {
  const container = page.locator(selector).first();
  const count = await container.count();
  if (count === 0) return;

  await container.evaluate((el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(1500);
}