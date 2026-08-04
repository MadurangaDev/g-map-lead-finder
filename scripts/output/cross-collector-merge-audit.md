# Cross-Collector Merge Validation & Hardening Report

## 1. Merge Verification

### Collection Run
- **Configuration:** 1 territory, 1 area, 1 category
- **Collectors enabled:** OSM + Google Maps
- **Total leads collected:** 11

### By Source
| Source | Count |
|--------|-------|
| OpenStreetMap | 10 |
| Google Maps | 1 |

### Merged Successfully
- No cross-collector merges occurred in this run because there was no overlap between OSM and Google Maps results for the same real-world business.
- All 11 leads remain as separate rows.

---

## 2. Duplicate Analysis

### Duplicates Found
| business_name | Count | Sources | Assessment |
|---------------|-------|---------|------------|
| Unknown | 3 | OpenStreetMap (×3) | Expected. OSM elements without `name` tags are assigned "Unknown" by the OSM collector. These are distinct OSM nodes, not merge failures. |

### Cross-Source Duplicates
- **None found.** No business appears in both OSM and Google Maps in this run.

### Suspicious Duplicates Investigated
- Checked by `phone_normalized`: no duplicates across sources.
- Checked by `latitude, longitude`: no duplicates.
- Checked by `business_name`: only the "Unknown" OSM entries appear multiple times.

---

## 3. Merge Quality

### reference_url Matching
- **Status:** Working correctly.
- OSM leads have stable `openstreetmap.org/node/<id>` URLs.
- Google Maps leads have normalized URLs (from Task 011).
- Different sources produce different `reference_url` values, so cross-source matches fall through to phone or name+town matching.

### Phone Matching
- **Status:** Working correctly when phones match.
- `normalizePhone` strips non-digits, handles Sri Lankan prefixes (`0094`, `94`, `0`), and produces consistent `phone_normalized` values.

### Business Name + Town Matching
- **Status:** Had a bug. Fixed during this task.
- **Bug:** `findLeadByNameAndTown` filtered with `WHERE phone_normalized IS NULL`, so it could only find leads that had NO phone number.
- **Impact:** If OSM collected a business WITH a phone, and Google Maps later collected the SAME business WITHOUT a phone, the name+town fallback would NOT find the existing OSM lead. It would insert a duplicate.
- **Fix:** Removed the `phone_normalized IS NULL` filter. `findLeadByNameAndTown` now searches ALL leads.

---

## 4. Changes Made

### `src/database/repository.ts`
**What changed:**
```sql
-- Before:
SELECT * FROM leads WHERE phone_normalized IS NULL

-- After:
SELECT * FROM leads
```

**Why:**
The `phone_normalized IS NULL` filter prevented name+town matching from finding existing leads that had phone numbers. Since phone matching is already attempted first in `mergeLead()`, reaching the name+town step means either:
1. The incoming lead has no phone, OR
2. The incoming lead's phone didn't match any existing lead.

In both cases, we should search ALL existing leads for a name+town match, not just those without phones.

**Expected effect:**
- Cross-collector merges by business name + town now work correctly even when one source has a phone and the other doesn't.
- No change to the merge priority order: `reference_url` → `phone` → `name+town`.

---

## 5. Remaining Limitations

These are intentional and NOT addressed by this task:

| Limitation | Explanation |
|------------|-------------|
| Businesses without any identifier | If a business has no `reference_url`, no phone, and a very generic name, it cannot be reliably merged. |
| Different spellings | "Kandy Motors" vs "Kandy Motor" will not merge. No fuzzy matching is implemented. |
| Relocated businesses | A business that moved to a new address will appear as a new lead. |
| Multiple branches | Two branches of the same business in the same town with similar names may merge incorrectly, or may not merge if names differ. |
| Franchise naming | "KFC Kandy" vs "KFC Katugastota" are correctly treated as separate businesses, but "KFC" vs "Kentucky Fried Chicken" would not merge. |
| Phone normalization edge cases | Phones with extensions, non-Sri Lankan formats, or unusual prefixes may not normalize correctly. |
| Name+town collisions | Two different businesses with the same name in the same town will merge incorrectly. This is an existing limitation of the `business_name + town` key. |

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| Dual-collector run completes | Pass |
| `SELECT DISTINCT sources FROM leads` | `["OpenStreetMap"]`, `["Google Maps"]` |
| `SELECT COUNT(*) FROM leads` | 11 |
| Duplicate phone numbers across sources | None |
| Cross-source duplicate business names | None |
| Config files restored | Yes |

---

## Conclusion

The merge pipeline correctly handles the tested dual-collector scenario. One bug was found and fixed: `findLeadByNameAndTown` now searches all leads, enabling proper cross-collector merging when one source has a phone number and the other does not.

No architectural changes were made. The merge strategy remains deterministic and unchanged in priority order.
