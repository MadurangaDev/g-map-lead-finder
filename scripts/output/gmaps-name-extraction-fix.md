# Google Maps Business Name Extraction Fix — Report

## Selector Chosen

**Primary:** `[data-attrid="title"], h1.fontHeadlineLarge, h1.fontHeadlineMedium`

Google Maps does not currently expose a stable `data-attrid="title"` element on business detail pages in this environment. The fallback chain compensates for this.

---

## Fallback Chain Implemented

1. **Preferred Google Maps selector:** `[data-attrid="title"], h1.fontHeadlineLarge, h1.fontHeadlineMedium`
2. **Filtered `<h1>` elements:** Iterates all `h1` elements, skipping generic headings (`Results`, `Search Results`, `Directions`, `Overview`, `Google Maps`), and returns the first valid candidate.
3. **`page.title()` fallback:** Strips the trailing `" - Google Maps"` suffix, trims whitespace, and rejects empty or generic values.

---

## Fallback Usage During Verification

During the `Vehicle Repair Digana` verification run:

- **Most businesses** resolved via **filtered h1** (e.g., `Automotive Car station`, `DAYAN ENGINEERING WORKS`).
- **Some businesses** fell back to **page.title()** when the detail page did not expose a distinct non-generic h1 (e.g., when the click opened a search-result overlay instead of a full detail page).
- The preferred Google Maps `data-attrid="title"` selector was **not observed** in the current page DOM, so it did not contribute during this run.

---

## Verification Results

### Extraction Count
| Search Term | Businesses Found | Extracted |
|-------------|------------------|-----------|
| Vehicle Repair Digana | 40 | 8 |

### Database Verification
```sql
SELECT business_name, reference_url
FROM leads
WHERE sources LIKE '%Google Maps%'
ORDER BY id DESC
LIMIT 20;
```

Results confirmed:
- Business names are real business names (`Automotive Car station`, `DAYAN ENGINEERING WORKS`, `The Garage Hub (PVT) LTD`, etc.)
- **No entries contain "Results"**
- **No empty business names**
- Reference URLs remain normalized (no query params, no `/data=...`)

---

## Original "Results" Issue

**Fully resolved.**

The previous failure mode where every business was rejected because the first `h1` was `"Results"` no longer occurs. The filtered h1 chain correctly skips generic headings and selects the actual business name.

---

## TypeScript

`npx tsc --noEmit` — passes.

---

## Files Modified

- `src/collectors/googleMaps.ts` — Replaced single-selector name extraction with a 3-tier fallback chain and updated DEBUG diagnostics to report the name source.
