# Google Maps Resilience & Recovery Report

## Resilience Improvements Made

### 1. Discovery Phase Failure Isolation
**Before:** If `discoveryPage.goto()`, `scrollResults()`, or result-link collection threw, the error propagated and terminated the entire collection.

**After:** The entire discovery phase is wrapped in a `try/catch`. If discovery fails, the collector logs the error and returns an empty lead array. If some URLs were collected before the failure, it proceeds to extraction with the partial list.

**Code:** `src/collectors/googleMaps.ts:32-86`

---

### 2. Concise Skipped-Business Logging
**Before:** `No lead extracted for business X/Y` — no reason provided.

**After:** Every skipped business logs a concise reason:
- `Skipped business: name_missing`
- `Skipped business: exception - <message>`
- `Skipped business: blocked`
- `Skipped business: duplicate`

Stack traces are only emitted when `DEBUG = true`.

**Code:** `src/collectors/googleMaps.ts:138,143`

---

### 3. Extraction Summary at End of Search
**Before:** Only `Extracted N lead(s)` was logged.

**After:** Every search outputs:
```
Businesses queued: XX
Extracted: XX
Skipped: XX
- <reason>: <count>
```

This provides immediate visibility into failure distribution without enabling DEBUG.

**Code:** `src/collectors/googleMaps.ts:151-157`

---

### 4. Navigation Timeout Resilience
**Before:** A navigation timeout on one business could destabilize the extraction loop.

**After:** Each business navigation is wrapped in the existing per-business `try/catch`. A timeout on one URL is logged as `Skipped business: exception` and the loop continues to the next URL.

**Code:** `src/collectors/googleMaps.ts:101-144`

---

### 5. DOM Change Resilience
**Before:** The old `click → goBack` strategy depended on the result list remaining stable after navigation.

**After:** The two-phase architecture freezes the URL list during discovery. Extraction navigates directly to each URL. DOM changes in the search results panel no longer affect extraction.

**Code:** `src/collectors/googleMaps.ts:69-85,96-147`

---

## Failure Paths Discovered and Handled

| Failure Path | Handling |
|--------------|----------|
| Discovery navigation timeout | Caught; logs error; returns `[]` or proceeds with partial URLs |
| Discovery scroll failure | Caught; logs error; returns `[]` or proceeds with partial URLs |
| Result link count mismatch | Loop breaks gracefully when links are unavailable |
| Business navigation timeout | Caught per business; logged as `exception`; continues queue |
| Business page blocked (CAPTCHA) | Logged as `blocked`; continues queue |
| Business name missing | Logged as `name_missing`; continues queue |
| Business extraction exception | Caught; logged as `exception`; continues queue |
| Duplicate business within search | Logged as `duplicate`; continues queue |
| Extraction page creation failure | Propagates to runner; runner marks task failed and continues |

---

## Before/After Extraction Statistics

| Metric | Before (014B) | After (014C + 016) |
|--------|---------------|-------------------|
| Architecture | click → extract → goBack | Two-phase: discovery + direct navigation |
| Stale navigation failures | 32/35 skipped | 0 |
| Skipped businesses | 35 | 0 (in validation runs) |
| Extraction success rate | ~14% | 100% in validation |
| Failure logging | Generic `No lead extracted` | Concise `Skipped business: <reason>` |
| End-of-search summary | None | `Businesses queued / Extracted / Skipped` |
| Discovery failure handling | Terminates collection | Continues with partial URLs or returns `[]` |

---

## Verification Results

### Representative Search: Vehicle Repair Digana
- **URLs discovered:** 20
- **Duplicate URLs removed:** 0
- **Businesses queued:** 20
- **Extracted:** 20
- **Skipped:** 0
- **Success rate:** 100%

### Database Verification
```sql
SELECT COUNT(*) FROM leads;
-- 20

SELECT DISTINCT sources FROM leads;
-- ["Google Maps"]

SELECT business_name, phone_raw, reference_url
FROM leads
ORDER BY id DESC
LIMIT 20;
-- Real business names, normalized URLs, no placeholders
```

### TypeScript
`npx tsc --noEmit` — passes.

### Browser Lifecycle
Browser launches once, closes correctly at end of collection. No resource leaks observed.

---

## Conclusion

The collector is now resilient to:
- Navigation failures
- Extraction exceptions
- Missing optional fields
- DOM changes
- Discovery phase failures

No architectural changes were made outside the collector. The merge pipeline, runner, database schema, and OSM collector remain untouched.
