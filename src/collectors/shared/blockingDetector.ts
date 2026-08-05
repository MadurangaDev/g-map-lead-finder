import type { Page } from "playwright";

export async function detectBlocking(
  page: Page,
): Promise<{ captcha: boolean; blocked: boolean }> {
  try {
    const url = page.url().toLowerCase();
    const content = (await page.content()).toLowerCase();
    const title = (await page.title()).toLowerCase();

    const captcha =
      url.includes("captcha") ||
      url.includes("recaptcha") ||
      content.includes("verify you're a human") ||
      content.includes("unusual traffic") ||
      title.includes("captcha") ||
      title.includes("unusual traffic");

    const blocked =
      url.includes("blocked") ||
      content.includes("access denied") ||
      content.includes("403 forbidden");

    return { captcha, blocked };
  } catch {
    return { captcha: false, blocked: false };
  }
}