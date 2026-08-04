import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ─── Configuration ───────────────────────────────────────────────────────────
const OUTPUT_DIR = path.resolve(__dirname, "output");
const LOG_FILE = path.join(OUTPUT_DIR, "google-maps-feasibility.log");
const REPORT_FILE = path.join(OUTPUT_DIR, "google-maps-feasibility-report.md");
const DELAY_BETWEEN_SEARCHES_MS = 3000;
const DELAY_BETWEEN_BUSINESSES_MS = 1500;
const NAVIGATION_TIMEOUT_MS = 30000;
const HEADLESS_MODE = true;

// ─── Types ───────────────────────────────────────────────────────────────────
interface SearchRecord {
  searchNumber: number;
  term: string;
  success: boolean;
  captcha: boolean;
  blocked: boolean;
  timeout: boolean;
  error?: string;
  businessPagesOpened: number;
  durationMs: number;
}

interface TestResult {
  testName: string;
  passed: boolean;
  details: string;
}

interface DetectionResult {
  captcha: boolean;
  blocked: boolean;
}

// ─── File Logger ─────────────────────────────────────────────────────────────
class FileLogger {
  private stream: fs.WriteStream;

  constructor(filePath: string) {
    this.stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  log(message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}`;
    this.stream.write(line + "\n");
    console.log(line);
  }

  close(): void {
    this.stream.end();
  }
}

// ─── Global State ─────────────────────────────────────────────────────────────
const logger = new FileLogger(LOG_FILE);
const searchRecords: SearchRecord[] = [];
const testResults: TestResult[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function detectCaptchaOrBlock(page: Page): Promise<DetectionResult> {
  try {
    const url = page.url();
    const content = await page.content();
    const title = await page.title();

    const lowerContent = content.toLowerCase();
    const lowerTitle = title.toLowerCase();

    const captcha =
      url.toLowerCase().includes("captcha") ||
      url.toLowerCase().includes("recaptcha") ||
      lowerContent.includes("captcha") ||
      lowerContent.includes("verify you're a human") ||
      lowerContent.includes("our systems have detected unusual traffic") ||
      lowerContent.includes("unusual traffic from your computer network") ||
      lowerContent.includes("why am i seeing this page") ||
      lowerTitle.includes("captcha") ||
      lowerTitle.includes("unusual traffic");

    const blocked =
      url.toLowerCase().includes("blocked") ||
      lowerContent.includes("access denied") ||
      lowerContent.includes("403 forbidden") ||
      lowerContent.includes("service unavailable");

    return { captcha, blocked };
  } catch {
    return { captcha: false, blocked: false };
  }
}

async function saveFailureEvidence(
  page: Page,
  searchNumber: number,
  term: string
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTerm = term.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
  const baseName = `failure-${searchNumber}-${safeTerm}-${timestamp}`;

  const screenshotPath = path.join(OUTPUT_DIR, `${baseName}.png`);
  const htmlPath = path.join(OUTPUT_DIR, `${baseName}.html`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(htmlPath, html);
    logger.log(`Saved failure evidence: ${path.basename(screenshotPath)}, ${path.basename(htmlPath)}`);
  } catch (err) {
    logger.log(`Failed to save evidence: ${(err as Error).message}`);
  }
}

// ─── Core Actions ─────────────────────────────────────────────────────────────
async function openGoogleMaps(page: Page): Promise<boolean> {
  try {
    await page.goto("https://www.google.com/maps", {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await sleep(2000);

    const { captcha, blocked } = await detectCaptchaOrBlock(page);
    if (captcha || blocked) {
      await saveFailureEvidence(page, 0, "homepage");
      return false;
    }

    // Verify page actually loaded
    const title = await page.title();
    return title.toLowerCase().includes("google maps");
  } catch (err) {
    logger.log(`Failed to open Google Maps homepage: ${(err as Error).message}`);
    return false;
  }
}

async function performSearch(
  page: Page,
  term: string,
  searchNumber: number
): Promise<SearchRecord> {
  const startTime = Date.now();
  const record: SearchRecord = {
    searchNumber,
    term,
    success: false,
    captcha: false,
    blocked: false,
    timeout: false,
    businessPagesOpened: 0,
    durationMs: 0,
  };

  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(term)}`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await sleep(2000);

    const detection = await detectCaptchaOrBlock(page);
    record.captcha = detection.captcha;
    record.blocked = detection.blocked;

    if (record.captcha || record.blocked) {
      await saveFailureEvidence(page, searchNumber, term);
      record.durationMs = Date.now() - startTime;
      return record;
    }

    // Locate result links
    const resultLinks = page.locator('a[href*="/maps/place/"]');
    const count = await resultLinks.count();

    if (count > 0) {
      record.success = true;
      const maxBusinesses = Math.min(count, 2);

      for (let i = 0; i < maxBusinesses; i++) {
        try {
          const links = page.locator('a[href*="/maps/place/"]');
          const currentCount = await links.count();
          if (i >= currentCount) break;

          await links.nth(i).click({ timeout: 10000 });
          await sleep(DELAY_BETWEEN_BUSINESSES_MS);

          const bizDetection = await detectCaptchaOrBlock(page);
          if (bizDetection.captcha || bizDetection.blocked) {
            await saveFailureEvidence(page, searchNumber, `${term}-biz-${i}`);
            break;
          }

          record.businessPagesOpened++;

          await page.goBack({ waitUntil: "domcontentloaded" });
          await sleep(1000);
        } catch (err) {
          logger.log(`Error opening business ${i} for "${term}": ${(err as Error).message}`);
          try {
            await page.goBack({ waitUntil: "domcontentloaded" });
            await sleep(1000);
          } catch {
            // ignore
          }
        }
      }
    } else {
      record.success = true;
    }

    record.durationMs = Date.now() - startTime;
  } catch (err: any) {
    record.timeout =
      err.message?.toLowerCase().includes("timeout") ||
      err.message?.toLowerCase().includes("timeout");
    record.error = err.message;
    record.durationMs = Date.now() - startTime;
    logger.log(`Error searching "${term}": ${err.message}`);
  }

  logger.log(
    `Search #${searchNumber} "${term}" => success=${record.success}, ` +
      `captcha=${record.captcha}, blocked=${record.blocked}, ` +
      `timeout=${record.timeout}, businesses=${record.businessPagesOpened}, ` +
      `duration=${record.durationMs}ms`
  );

  return record;
}

// ─── Test Runners ─────────────────────────────────────────────────────────────
async function runTest1(browser: Browser): Promise<TestResult> {
  logger.log("\n--- Test 1: Browser Launch ---");
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const launched = await openGoogleMaps(page);

    if (launched) {
      logger.log("Test 1: PASS");
      return { testName: "Test 1 - Browser Launch", passed: true, details: "Chromium launched and Google Maps opened successfully" };
    } else {
      logger.log("Test 1: FAIL");
      return { testName: "Test 1 - Browser Launch", passed: false, details: "Failed to open Google Maps" };
    }
  } catch (err) {
    logger.log(`Test 1: FAIL - ${(err as Error).message}`);
    return { testName: "Test 1 - Browser Launch", passed: false, details: `Error: ${(err as Error).message}` };
  }
}

async function runTest2(browser: Browser): Promise<TestResult> {
  logger.log("\n--- Test 2: Single Search ---");
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const result = await performSearch(page, "Kandy vehicle repair", 1);
    searchRecords.push(result);
    await context.close();

    if (result.success && !result.captcha && !result.blocked) {
      logger.log(`Test 2: PASS - ${result.businessPagesOpened} businesses opened`);
      return { testName: "Test 2 - Single Search", passed: true, details: `Search successful, ${result.businessPagesOpened} businesses opened` };
    } else {
      logger.log(`Test 2: FAIL - captcha=${result.captcha}, blocked=${result.blocked}`);
      return { testName: "Test 2 - Single Search", passed: false, details: `captcha=${result.captcha}, blocked=${result.blocked}` };
    }
  } catch (err) {
    logger.log(`Test 2: FAIL - ${(err as Error).message}`);
    return { testName: "Test 2 - Single Search", passed: false, details: `Error: ${(err as Error).message}` };
  }
}

async function runTest3(browser: Browser): Promise<TestResult> {
  logger.log("\n--- Test 3: Multiple Searches ---");
  const terms = [
    "Kandy vehicle repair",
    "Kandy logistics",
    "Kundasale garage",
    "Peradeniya transport",
    "Digana auto repair",
  ];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    for (let i = 0; i < terms.length; i++) {
      const result = await performSearch(page, terms[i], i + 2);
      searchRecords.push(result);
      await sleep(DELAY_BETWEEN_SEARCHES_MS + Math.floor(Math.random() * 2000));
    }

    await context.close();

    const blocked = searchRecords.filter((r) => r.captcha || r.blocked).length;
    const success = searchRecords.filter((r) => r.success && !r.captcha && !r.blocked).length;

    if (blocked === 0) {
      logger.log(`Test 3: PASS - ${success}/${terms.length} successful`);
      return { testName: "Test 3 - Multiple Searches", passed: true, details: `${success}/${terms.length} successful, no blocking` };
    } else {
      logger.log(`Test 3: FAIL - ${blocked} blocked/captcha`);
      return { testName: "Test 3 - Multiple Searches", passed: false, details: `${blocked}/${terms.length} blocked or CAPTCHA` };
    }
  } catch (err) {
    logger.log(`Test 3: FAIL - ${(err as Error).message}`);
    return { testName: "Test 3 - Multiple Searches", passed: false, details: `Error: ${(err as Error).message}` };
  }
}

async function runTest4(browser: Browser): Promise<TestResult> {
  logger.log("\n--- Test 4: Sustained Load ---");
  const terms = [
    "Kandy vehicle repair",
    "Kandy logistics",
    "Kundasale garage",
    "Peradeniya transport",
    "Digana auto repair",
    "Kandy auto parts",
    "Kandy car service",
    "Kandy van repair",
    "Kandy truck service",
    "Kandy motorcycle repair",
    "Gampola garage",
    "Akurana auto",
    "Katugastota vehicle",
    "Pallekele auto repair",
    "Kandy battery shop",
    "Kandy tyre service",
    "Kandy diesel mechanic",
    "Kandy auto electrical",
    "Kandy spray paint",
    "Kandy auto accessories",
    "Kandy car wash",
    "Kandy vehicle hire",
    "Kandy driving school",
    "Kandy number plate",
    "Kandy insurance agent",
  ];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const results: SearchRecord[] = [];

    for (let i = 0; i < terms.length; i++) {
      logger.log(`Sustained search ${i + 1}/${terms.length}: ${terms[i]}`);
      const result = await performSearch(page, terms[i], searchRecords.length + results.length + 1);
      results.push(result);
      await sleep(DELAY_BETWEEN_SEARCHES_MS + Math.floor(Math.random() * 2000));
    }

    await context.close();
    searchRecords.push(...results);

    const blocked = results.filter((r) => r.captcha || r.blocked).length;
    const success = results.filter((r) => r.success && !r.captcha && !r.blocked).length;
    const businesses = results.reduce((sum, r) => sum + r.businessPagesOpened, 0);

    if (blocked === 0) {
      logger.log(`Test 4: PASS - ${success}/${terms.length} searches, ${businesses} business pages`);
      return { testName: "Test 4 - Sustained Load", passed: true, details: `${success}/${terms.length} searches, ${businesses} business pages opened` };
    } else {
      logger.log(`Test 4: PARTIAL - ${blocked} blocked, ${businesses} business pages`);
      return { testName: "Test 4 - Sustained Load", passed: false, details: `${blocked}/${terms.length} blocked, ${businesses} business pages opened` };
    }
  } catch (err) {
    logger.log(`Test 4: FAIL - ${(err as Error).message}`);
    return { testName: "Test 4 - Sustained Load", passed: false, details: `Error: ${(err as Error).message}` };
  }
}

async function runTest5(browser: Browser): Promise<TestResult> {
  logger.log("\n--- Test 5: Recovery ---");
  const terms = ["Kandy mechanic", "Kandy panel beater", "Kandy radiator repair"];

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let recoverySuccess = 0;

    for (const term of terms) {
      const result = await performSearch(page, term, searchRecords.length + 1);
      searchRecords.push(result);

      if (result.captcha || result.blocked) {
        logger.log("CAPTCHA/block detected, attempting recovery...");
        await sleep(10000);
        try {
          await page.reload({ waitUntil: "domcontentloaded" });
          await sleep(5000);

          const detection = await detectCaptchaOrBlock(page);
          if (!detection.captcha && !detection.blocked) {
            recoverySuccess++;
            logger.log("Recovery succeeded after reload");
          } else {
            logger.log("Recovery failed after reload");
          }
        } catch {
          logger.log("Recovery reload failed");
        }
      } else if (result.success) {
        recoverySuccess++;
      }

      await sleep(4000);
    }

    await context.close();

    const passed = recoverySuccess >= terms.length / 2;
    logger.log(`Test 5: ${passed ? "PASS" : "FAIL"} - ${recoverySuccess}/${terms.length} recovered`);
    return { testName: "Test 5 - Recovery", passed, details: `${recoverySuccess}/${terms.length} recovered successfully` };
  } catch (err) {
    logger.log(`Test 5: FAIL - ${(err as Error).message}`);
    return { testName: "Test 5 - Recovery", passed: false, details: `Error: ${(err as Error).message}` };
  }
}

async function runTest6(): Promise<TestResult> {
  logger.log("\n--- Test 6: Restart Test ---");
  let browser2: Browser | null = null;

  try {
    await sleep(5000);
    browser2 = await chromium.launch({
      headless: HEADLESS_MODE,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser2.newContext();
    const page = await context.newPage();

    const terms = ["Kandy auto repair", "Kandy vehicle service"];
    let successCount = 0;

    for (const term of terms) {
      const result = await performSearch(page, term, searchRecords.length + 1);
      searchRecords.push(result);
      if (result.success && !result.captcha && !result.blocked) {
        successCount++;
      }
      await sleep(3000);
    }

    await context.close();

    const passed = successCount === terms.length;
    logger.log(`Test 6: ${passed ? "PASS" : "FAIL"} - ${successCount}/${terms.length} successful after restart`);
    return { testName: "Test 6 - Restart Test", passed, details: `${successCount}/${terms.length} successful after new browser session` };
  } catch (err) {
    logger.log(`Test 6: FAIL - ${(err as Error).message}`);
    return { testName: "Test 6 - Restart Test", passed: false, details: `Error: ${(err as Error).message}` };
  } finally {
    if (browser2) {
      await browser2.close();
    }
  }
}

// ─── Report Generation ────────────────────────────────────────────────────────
async function generateReport(): Promise<void> {
  const totalSearches = searchRecords.length;
  const successfulSearches = searchRecords.filter((r) => r.success && !r.captcha && !r.blocked).length;
  const blockedSearches = searchRecords.filter((r) => r.blocked).length;
  const captchaSearches = searchRecords.filter((r) => r.captcha).length;
  const totalBusinessPages = searchRecords.reduce((sum, r) => sum + r.businessPagesOpened, 0);
  const avgTimeMs =
    totalSearches > 0
      ? Math.round(searchRecords.reduce((sum, r) => sum + r.durationMs, 0) / totalSearches)
      : 0;

  const allPassed = testResults.every((t) => t.passed);
  const recommendation = allPassed
    ? "SAFE TO PROCEED"
    : testResults.filter((t) => !t.passed).length <= 2
      ? "PROCEED WITH CAUTION"
      : "NOT FEASIBLE";

  const report = `# Google Maps Feasibility Report

## Environment

- OS: ${process.platform}
- Node version: ${process.version}
- Playwright version: ${require("playwright/package.json").version}
- Browser: Chromium (Playwright headless: true)

## Test Results

${testResults
  .map(
    (t) =>
      `### ${t.testName}\n\n${t.passed ? "PASS" : "FAIL"}\n\n${t.details}`
  )
  .join("\n\n")}

## Statistics

- Total searches: ${totalSearches}
- Successful searches: ${successfulSearches}
- Blocked searches: ${blockedSearches}
- CAPTCHAs: ${captchaSearches}
- Business pages opened: ${totalBusinessPages}
- Average time per search: ${avgTimeMs}ms

## Recommendation

**${recommendation}**

${
  recommendation === "SAFE TO PROCEED"
    ? "All tests passed. Google Maps scraping from this Codespaces environment appears reliable for a production collector."
    : recommendation === "PROCEED WITH CAUTION"
    ? "Most tests passed but some blocking was detected. Additional mitigation (delays, proxy rotation, user-agent rotation) may be needed for a production collector."
    : "Significant blocking was detected. Google Maps scraping is likely not feasible from this environment without significant mitigation."
}

## Risks

- Results reflect the current GitHub Codespaces IP at the time of testing.
- Codespaces uses shared cloud IP ranges.
- A successful test today does not guarantee future reliability if the IP reputation changes.
- Google actively detects and blocks automated scraping. This test represents a snapshot in time only.
- Headless browsers are more likely to be detected than real user browsers.
`;

  fs.writeFileSync(REPORT_FILE, report);
  logger.log(`\nReport generated: ${REPORT_FILE}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  ensureOutputDir();
  logger.log("=== Google Maps Feasibility Spike Started ===");

  let browser: Browser | null = null;

  try {
    logger.log("Launching Chromium...");
    browser = await chromium.launch({
      headless: HEADLESS_MODE,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const test1 = await runTest1(browser);
    testResults.push(test1);

    if (!test1.passed) {
      logger.log("Test 1 failed — browser did not launch properly. Aborting.");
      testResults.push({ testName: "Test 2-6", passed: false, details: "Skipped due to Test 1 failure" });
      return;
    }

    const test2 = await runTest2(browser);
    testResults.push(test2);

    const test3 = await runTest3(browser);
    testResults.push(test3);

    const test4 = await runTest4(browser);
    testResults.push(test4);

    const test5 = await runTest5(browser);
    testResults.push(test5);

    const test6 = await runTest6();
    testResults.push(test6);
  } catch (err) {
    logger.log(`Fatal error: ${(err as Error).message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    logger.log("\n=== Google Maps Feasibility Spike Ended ===");
    generateReport();
  }
}

main();
