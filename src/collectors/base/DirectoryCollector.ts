import { Page } from "playwright";
import { Zone } from "../../models/Zone";
import { Lead } from "../../models/Lead";
import { BrowserSession } from "../shared/browserSession";
import { detectBlocking } from "../shared/blockingDetector";
import { logger } from "../../utils/logger";
import type { BusinessExtractionResult } from "../types";

export abstract class DirectoryCollector {
  protected browserSession: BrowserSession;

  constructor(browserSession?: BrowserSession) {
    this.browserSession = browserSession ?? new BrowserSession();
  }

  protected abstract buildSearchUrl(
    zone: Zone,
    category: string,
    query: unknown,
  ): string;

  protected abstract discoverListings(
    page: Page,
    zone: Zone,
  ): Promise<string[]>;

  protected abstract extractBusiness(
    page: Page,
    url: string,
    zone: Zone,
    category: string,
  ): Promise<BusinessExtractionResult>;

  protected async loadSearchPage(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  protected async onBeforeCollect(): Promise<void> {}

  protected async onAfterCollect(): Promise<void> {}

  async collect(
    zone: Zone,
    category: string,
    query?: unknown,
  ): Promise<Lead[]> {
    await this.onBeforeCollect();

    const searchUrl = this.buildSearchUrl(zone, category, query);

    const discoveryPage = await this.browserSession.getPage();
    let urls: string[] = [];

    try {
      await this.loadSearchPage(discoveryPage, searchUrl);

      const blocking = await detectBlocking(discoveryPage);
      if (blocking.captcha || blocking.blocked) {
        logger.error(`Blocked on directory for "${searchUrl}"`);
        return [];
      }

      urls = await this.discoverListings(discoveryPage, zone);
    } catch (err) {
      logger.error(
        `Discovery failed for "${searchUrl}": ${(err as Error).message}`,
      );
      if (urls.length === 0) {
        return [];
      }
      logger.info(
        `Proceeding with ${urls.length} URLs collected before failure`,
      );
    } finally {
      await discoveryPage.close();
    }

    const leads: Lead[] = [];
    const seenBusinessKeys = new Set<string>();
    const failureCounts: Record<string, number> = {};

    const extractionPage = await this.browserSession.getPage();

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      try {
        await extractionPage.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await extractionPage.waitForTimeout(2000);

        const bizDetection = await detectBlocking(extractionPage);
        if (bizDetection.captcha || bizDetection.blocked) {
          logger.error(
            `Blocked while opening business ${i + 1}/${urls.length}`,
          );
          failureCounts["blocked"] = (failureCounts["blocked"] || 0) + 1;
          continue;
        }

        const { lead, reason } = await this.extractBusiness(
          extractionPage,
          url,
          zone,
          category,
        );
        if (lead) {
          const key = this.makeBusinessKey(lead);
          if (seenBusinessKeys.has(key)) {
            logger.info(
              `Duplicate business skipped: ${lead.business_name}`,
            );
            failureCounts["duplicate"] =
              (failureCounts["duplicate"] || 0) + 1;
            continue;
          }
          seenBusinessKeys.add(key);
          leads.push(lead);
        } else {
          const failureReason = reason || "unknown";
          failureCounts[failureReason] = (failureCounts[failureReason] || 0) + 1;
          logger.warn(`Skipped business: ${failureReason}`);
        }
      } catch (err) {
        logger.warn(
          `Skipped business: exception - ${(err as Error).message}`,
        );
        failureCounts["exception"] = (failureCounts["exception"] || 0) + 1;
      }
    }

    await extractionPage.close();

    await this.onAfterCollect();

    return leads;
  }

  protected makeBusinessKey(lead: Lead): string {
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
}