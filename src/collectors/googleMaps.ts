import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { Zone } from "../models/Zone";
import { Lead } from "../models/Lead";
import { logger } from "../utils/logger";

const DEBUG = false;
let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function getBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  if (!browser || !context) {
    logger.info("Launching Google Maps browser");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    context = await browser.newContext();
  }
  return { browser, context };
}

export async function collectGoogleMaps(zone: Zone, category: string): Promise<Lead[]> {
  const { context } = await getBrowser();

  try {
    const searchTerm = `${category} ${zone.town}`;
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;

    logger.info(`Searching Google Maps: ${zone.town} [${category}]`);

    const discoveryPage = await context.newPage();
    let urls: string[] = [];

    try {
      await discoveryPage.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await discoveryPage.waitForTimeout(3000);

      const pageUrl = discoveryPage.url();
      const pageTitle = await discoveryPage.title();
      logger.info(`Landed on: ${pageUrl} | title: ${pageTitle}`);

      const detection = await detectBlocking(discoveryPage);
      if (detection.captcha || detection.blocked) {
        logger.error(`Blocked on Google Maps for "${searchTerm}"`);
        return [];
      }

      await scrollResults(discoveryPage);

      const resultLinks = discoveryPage.locator('a[href*="/maps/place/"]');
      const count = await resultLinks.count();

      if (count === 0) {
        const directName = await extractText(discoveryPage, 'h1, [data-attrid="title"]');
        if (directName) {
          logger.info(`Search redirected to business page: ${directName}`);
          const { lead } = await extractBusinessDetails(discoveryPage, category, zone);
          if (lead) {
            return [lead];
          }
        }
        logger.warn(`No results found for "${searchTerm}"`);
        return [];
      }

      logger.info(`Found ${count} businesses for "${searchTerm}"`);

      const seenHrefs = new Set<string>();

      for (let i = 0; i < count; i++) {
        const links = discoveryPage.locator('a[href*="/maps/place/"]');
        const currentCount = await links.count();
        if (i >= currentCount) break;

        const href = await links.nth(i).getAttribute("href");
        if (!href) continue;

        const normalized = normalizeGoogleMapsUrl(href);
        if (!seenHrefs.has(normalized)) {
          seenHrefs.add(normalized);
          urls.push(href);
        }
      }

      logger.info(`Discovery complete`);
      logger.info(`URLs discovered: ${count}`);
      logger.info(`Duplicate URLs removed: ${count - urls.length}`);
      logger.info(`Businesses queued: ${urls.length}`);
    } catch (err) {
      logger.error(`Discovery failed for "${searchTerm}": ${(err as Error).message}`);
      if (urls.length === 0) {
        return [];
      }
      logger.info(`Proceeding with ${urls.length} URLs collected before failure`);
    } finally {
      await discoveryPage.close();
    }

    const leads: Lead[] = [];
    const seenBusinessKeys = new Set<string>();
    const failureCounts: Record<string, number> = {};

    const extractionPage = await context.newPage();

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      try {
        debugLog(`Business ${i + 1}/${urls.length}`);
        debugLog(`URL: ${url}`);

        await extractionPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await extractionPage.waitForTimeout(2000);

        const afterClickUrl = extractionPage.url();
        const afterClickTitle = await extractionPage.title();
        debugLog(`URL after navigation: ${afterClickUrl}`);
        debugLog(`Title after navigation: ${afterClickTitle}`);

        const bizDetection = await detectBlocking(extractionPage);
        if (bizDetection.captcha || bizDetection.blocked) {
          logger.error(`Blocked while opening business ${i + 1}/${urls.length}`);
          failureCounts["blocked"] = (failureCounts["blocked"] || 0) + 1;
          continue;
        }

        debugLog(`Detail panel detected: ${await extractionPage.locator('[data-attrid="title"], [role="main"]').count() > 0 ? "yes" : "no"}`);
        debugLog(`Extraction started for business ${i + 1}/${urls.length}`);

        const { lead, reason } = await extractBusinessDetails(extractionPage, category, zone);
        if (lead) {
          const key = makeBusinessKey(lead);
          if (seenBusinessKeys.has(key)) {
            logger.info(`Duplicate Google Maps business skipped: ${lead.business_name}`);
            failureCounts["duplicate"] = (failureCounts["duplicate"] || 0) + 1;
            continue;
          }
          seenBusinessKeys.add(key);
          leads.push(lead);
          debugLog(`Extraction succeeded for business ${i + 1}/${urls.length}: ${lead.business_name}`);
        } else {
          debugLog(`Extraction returned null for business ${i + 1}/${urls.length}`);
          const failureReason = reason || "unknown";
          failureCounts[failureReason] = (failureCounts[failureReason] || 0) + 1;
          logger.warn(`Skipped business: ${failureReason}`);
        }
      } catch (err) {
        debugLog(`Exception for business ${i + 1}/${urls.length}: ${(err as Error).message}`);
        failureCounts["exception"] = (failureCounts["exception"] || 0) + 1;
        logger.warn(`Skipped business: exception - ${(err as Error).message}`);
      }
    }

    await extractionPage.close();

    logger.success(`Extracted ${leads.length} lead(s) from ${searchTerm}`);

    const skipped = urls.length - leads.length;
    if (skipped > 0 || Object.keys(failureCounts).length > 0) {
      logger.info("Extraction Summary");
      logger.info(`Extracted: ${leads.length}`);
      logger.info(`Skipped: ${skipped}`);
      for (const [reason, cnt] of Object.entries(failureCounts)) {
        logger.info(`- ${reason}: ${cnt}`);
      }
    } else {
      logger.info("Extraction Summary");
      logger.info(`Extracted: ${leads.length}`);
      logger.info(`Skipped: ${skipped}`);
    }

    return leads;
  } finally {
    // page is closed by caller in collectGoogleMaps's finally block
  }
}

async function scrollResults(page: Page): Promise<void> {
  const maxScrolls = 5;

  for (let i = 0; i < maxScrolls; i++) {
    const scrollable = page.locator('[role="feed"]').first();
    const countBefore = await page.locator('a[href*="/maps/place/"]').count();

    if (await scrollable.count() > 0) {
      await scrollable.evaluate((el: HTMLElement) => {
        el.scrollTop = el.scrollHeight;
      });
    } else {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    }

    await page.waitForTimeout(2000);
    const countAfter = await page.locator('a[href*="/maps/place/"]').count();

    if (countAfter === countBefore) break;
  }
}

interface ExtractionResult {
  lead: Lead | null;
  reason?: string;
}

async function extractBusinessDetails(page: Page, category: string, zone: Zone): Promise<ExtractionResult> {
  try {
    const nameSource = await extractBusinessName(page);
    const safeName = nameSource.name;

    const address = await extractText(page, '[data-attrid="address"] button, button[aria-label*="Address"]');
    const phoneRaw = await extractText(page, 'a[href^="tel:"], [data-attrid="phone"] button, button[aria-label*="Phone"]');
    const ratingText = await extractText(page, '[data-attrid="rating"] span, .MW4etd, span[aria-label*="stars"]');
    const rating = ratingText ? parseFloat(ratingText) : null;

    let latitude = zone.latitude;
    let longitude = zone.longitude;

    try {
      const url = page.url();
      const matches = [...url.matchAll(/@(-?\d+\.\d+),(-?\d+\.\d+)/g)];
      for (const match of matches) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          latitude = lat;
          longitude = lng;
          break;
        }
      }
    } catch {
      // keep zone coordinates as fallback
    }

    debugLog(`Fields: name=${safeName ? "yes" : "no"}, address=${address ? "yes" : "no"}, phone=${phoneRaw ? "yes" : "no"}, rating=${ratingText ? "yes" : "no"}, coords=${(latitude !== zone.latitude || longitude !== zone.longitude) ? "yes" : "no"}, reference_url=${page.url() ? "yes" : "no"}`);
    debugLog(`Name source: ${nameSource.source}`);

    if (!safeName) {
      debugLog(`Reason: business name not found`);
      return { lead: null, reason: "name_missing" };
    }

    return {
      lead: {
        business_name: safeName,
        phone_raw: phoneRaw,
        address,
        category,
        town: zone.town,
        zone: zone.name,
        latitude,
        longitude,
        rating: isNaN(rating as number) ? null : rating,
        reference_url: normalizeGoogleMapsUrl(page.url()),
        sources: ["Google Maps"],
        notes: null,
      },
    };
  } catch (err) {
    debugLog(`Reason: exception - ${(err as Error).message}`);
    logger.warn(`Failed to extract business details: ${(err as Error).message}`);
    return { lead: null, reason: "exception" };
  }
}

interface NameSource {
  name: string | null;
  source: string;
}

const GENERIC_HEADINGS = new Set([
  "results",
  "search results",
  "directions",
  "overview",
  "google maps",
]);

async function extractBusinessName(page: Page): Promise<NameSource> {
  const title = await page.title();
  const titleBusinessName = title
    .replace(/\s*-\s*Google Maps\s*$/i, "")
    .trim();

  // 1. Preferred Google Maps business-name selector
  const preferredName = await extractText(page, '[data-attrid="title"], h1.fontHeadlineLarge, h1.fontHeadlineMedium');
  if (preferredName && !GENERIC_HEADINGS.has(preferredName.toLowerCase())) {
    return { name: preferredName, source: "business selector" };
  }

  // 2. Filtered h1 elements
  const h1Elements = page.locator("h1");
  const h1Count = await h1Elements.count();
  for (let i = 0; i < h1Count; i++) {
    const text = await h1Elements.nth(i).textContent();
    const candidate = text?.trim();
    if (candidate && !GENERIC_HEADINGS.has(candidate.toLowerCase())) {
      return { name: candidate, source: "filtered h1" };
    }
  }

  // 3. page.title() fallback
  if (titleBusinessName && !GENERIC_HEADINGS.has(titleBusinessName.toLowerCase())) {
    return { name: titleBusinessName, source: "page.title fallback" };
  }

  return { name: null, source: "none" };
}

function debugLog(message: string): void {
  if (DEBUG) {
    logger.info(`[DEBUG] ${message}`);
  }
}

function normalizeGoogleMapsUrl(url: string): string {
  let normalized = url.split('?')[0];
  normalized = normalized.replace(/\/data=.*$/, '');
  return normalized;
}

function makeBusinessKey(lead: Lead): string {
  const url = lead.reference_url?.trim();
  if (url) {
    return `url:${url}`;
  }

  const name = (lead.business_name ?? "").trim().toLowerCase();
  const address = (lead.address ?? "").trim().toLowerCase();
  if (name && address) {
    return `name+address:${name}|${address}`;
  }

  const lat = lead.latitude?.toString() ?? "";
  const lng = lead.longitude?.toString() ?? "";
  if (name && lat && lng) {
    return `name+coords:${name}|${lat},${lng}`;
  }

  return `name:${name}`;
}

async function extractText(page: Page, selector: string): Promise<string | null> {
  try {
    const el = page.locator(selector).first();
    const text = await el.textContent();
    return text?.trim() || null;
  } catch {
    return null;
  }
}

async function detectBlocking(page: Page): Promise<{ captcha: boolean; blocked: boolean }> {
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

export async function closeGoogleMapsBrowser(): Promise<void> {
  if (context) {
    try {
      await context.close();
    } catch {
      // ignore
    }
    context = null;
  }
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    browser = null;
  }
}
