# Vehicle Lead Finder — Project Briefing (Handoff Document)

> Written as a full-context handoff for another AI assistant or developer picking this project up. Read this top to bottom before touching code.

---

## 1. What this project is

**Vehicle Lead Finder** (repo: `g-map-lead-finder`) is a local Node.js/TypeScript CLI tool built for a single operator ("Shehan") as a first assignment at a new workplace. It is **not** a maintained/recurring system — it's a one-time data collection effort.

**Goal:** discover businesses in Central Province, Sri Lanka that are likely to own/operate vehicles — the target customer base for vehicle repair, parts, transport/logistics, construction, and similar B2B services. Collect them into a clean, deduplicated list and export a marketing-ready Excel file for the sales/marketing team's outbound campaigns (phone, WhatsApp, email, field visits).

**Definition of done:** every town on a target list has been searched against every business category in a config file, across all planned data sources. Success = **coverage of the search matrix (towns × categories × sources)**, not a specific lead count.

**Guiding philosophy — coverage over accuracy:** incomplete records (missing phone/address) are kept, not discarded. Marketing would rather have an imperfect lead than no lead.

**Explicitly out of scope (v1):** website/social scraping of individual businesses, hosted/multi-user version, scheduled re-collection, automated outreach (this tool only produces the list, never contacts anyone).

---

## 2. How we got here (project history)

The project went through four documented stages before arriving at the current codebase:

1. **Initial exploration (ChatGPT, casual)** — started as "how do I get a business list from Google Maps into Excel." Explored paid Places API, browser extensions, Outscraper, and a throwaway browser-console script, before escalating into full product design (towns/zones/categories/SQLite/Excel).
2. **Formal requirements doc** — turned the exploration into a proper spec: 4 sources (Google Maps via Playwright, Yellow Pages LK, Rainbow Pages LK, OpenStreetMap via Overpass), zone auto-subdivision, phone-based cross-source dedup, SQLite storage, Excel export. Flagged open questions (resume-on-crash, zone radius, review-flagging for ambiguous merges) that were largely left as accepted defaults rather than resolved.
3. **Implementation roadmap** — written mid-build, after `collectorRunner.ts` and the OSM collector already existed. Laid out remaining phases A–J (see §6 below).
4. **Implementation conversation** — the actual build log: scaffolding, config loader, schema, phone normalization, zone generation, `Collector` interface, OSM collector, Overpass multi-server retry logic, and the collector runner. Ended mid-debugging a duplicate-lead problem (see §5).

---

## 3. Current architecture (as it actually exists in the codebase — verified by direct inspection, not just prior chat)

```
g-map-lead-finder/
├── config/
│   ├── categories.json      # 3 categories defined (Vehicle Repair, Transport & Logistics, Vehicle Parts)
│   └── towns.json           # 3 towns defined (Kandy, Matale, Nuwara Eliya)
├── src/
│   ├── cli/
│   │   ├── index.ts         # entry point — initializes DB, calls runCollection()
│   │   └── commands/        # ad-hoc test scripts (testMerge, testOSM, testZones) — not wired into a real CLI command structure yet (no Commander subcommands registered)
│   ├── config/loader.ts     # loadJson<T>() — throws clear errors on missing/malformed JSON
│   ├── collectors/
│   │   └── osm.ts           # the ONLY collector implemented so far
│   ├── database/
│   │   ├── db.ts            # better-sqlite3 connection + initializeDatabase()
│   │   ├── schema.ts        # leads, lead_sources, zones, collection_runs tables
│   │   ├── repository.ts    # findLeadByPhone, insertLead, updateLead
│   │   ├── zoneRepository.ts# insertZone, getZonesByTown, markZoneCompleted
│   │   └── inspect.ts       # listLeads() debug helper
│   ├── models/
│   │   ├── Lead.ts
│   │   └── Zone.ts
│   ├── services/
│   │   ├── collectorRunner.ts   # main orchestrator: towns → zones → collector → merge
│   │   ├── leadMerge.ts         # phone-based dedup/merge logic
│   │   ├── overpassClient.ts    # multi-server Overpass query with failover + "preferred server" memory
│   │   ├── phone.ts             # normalizePhone()
│   │   └── zones.ts             # generateZones() — fixed 5-point cross pattern
│   └── test/testOverpass.ts     # standalone Overpass smoke test
├── package.json
└── tsconfig.json
```

**Stack actually in use:** TypeScript, `better-sqlite3`, `axios`, `commander` (installed but not yet used for subcommands), `chalk`, `dotenv`. **Not yet installed:** `playwright`, `cheerio`, `exceljs`/`SheetJS` — meaning Google Maps, Yellow Pages, Rainbow Pages collectors and the Excel export literally cannot run yet; the dependencies aren't even in `package.json`.

### Data model as built
- `leads`: business_name, phone_normalized (UNIQUE), phone_raw, address, category, town, zone, latitude, longitude, rating, reference_url, collected_at, notes, **sources (TEXT — JSON-stringified array, stored directly on the row)**.
- `lead_sources`: a normalized child table (lead_id, source, source_url) — **exists in schema but is currently unused/dead**. The repository layer never inserts into it; it still serializes `sources` as a JSON string on `leads.sources` instead, which is exactly the anti-pattern the implementation conversation said to avoid ("don't store `sources:'google,osm,yellow'` as a text field").
- `zones`: persisted town→zone breakdown for audit/resume — populated by `insertZone`, but `collectorRunner.ts` currently doesn't call it (zones are generated in-memory each run, not persisted/resumed from this table).
- `collection_runs`: exists in schema, **completely unused** — no code reads or writes it yet. This is the Phase A progress/resume table from the roadmap; only the empty shell exists.

### Zone generation as built
`generateZones()` produces a **fixed 5-zone cross pattern** per town (center/north/south/east/west, ±0.03° lat/lng offset, fixed 3km radius) — not the adaptive "split further if results are capped" behavior described in the original requirements (§8.2 of the requirements doc). This is a simplification that was never revisited.

### OSM collector as built
`collectOSM(zone, keyword)` queries Overpass for `["shop"="car_repair"]` **unconditionally** — the `keyword` parameter is accepted but ignored (there's a TODO comment saying so directly in the source). This means Phase B (category → OSM tag mapping) from the roadmap has not been done at all; right now, no matter what category/keyword is passed in, OSM always searches for car repair shops specifically.

### Collector runner as built
`runCollection()` in `collectorRunner.ts`:
- Loads `categories.json` and `towns.json` — **but only ever uses `towns`**. `categories` is loaded and its length logged, then never iterated over.
- Loops `towns → zones` and calls `collectOSM(zone, "car")` with a **hardcoded literal `"car"` keyword** — not driven by the loaded categories at all.
- So currently, a full run only ever searches OSM for "car"-tagged shops across the 3 configured towns' 5 generated zones each. It does not exercise the category list, and no other source is wired in (`collectors` is not an array/list here — it's a single direct function call, not the pluggable `Collector` interface pattern described in the roadmap/implementation chat).

### Merge logic as built
`mergeLead(incoming)`:
1. Normalizes phone.
2. **If no phone → always `insertLead()` unconditionally** — no fallback matching at all currently.
3. If phone exists → `findLeadByPhone()`; if found, `updateLead()` (COALESCE-based partial update, keeps existing non-null fields where incoming is null); if not found, `insertLead()`.

---

## 4. What's genuinely working right now (verified, not aspirational)

- Config loading with proper error handling for missing/malformed JSON.
- Phone normalization to a canonical `94XXXXXXXXXX` format (verified via a manual SQLite check — a duplicate-phone query returned zero rows after real collection).
- OSM collection via Overpass, with real data pulled successfully in a live test (17 leads collected in one documented session).
- Multi-server Overpass failover with "preferred server" memory (avoids repeatedly hitting a server that just failed, within a single process run — this resets on process restart, which was accepted as fine for this use case).
- End-to-end insert path: OSM → normalize → merge → SQLite, confirmed working via direct `sqlite3` CLI inspection.

---

## 5. What went wrong, and what's still wrong (the important part)

### 5a. Found and diagnosed (not yet fixed in code)
During a live test run, a manual SQLite check surfaced this:
```sql
SELECT business_name, sources FROM leads;
-- showed repeated rows like:
-- Baba Batiks | ["OpenStreetMap"]
-- Baba Batiks | ["OpenStreetMap"]
-- Pradeep Motors | ["OpenStreetMap"]
-- Pradeep Motors | ["OpenStreetMap"]
```
Phone-based dedup was confirmed working (a duplicate-phone query returned nothing), but **businesses with no phone number were being inserted repeatedly** whenever the same real-world business appeared in overlapping zones (e.g. the same shop showing up in both `Kandy-center` and `Kandy-east` search radii). OSM data frequently lacks phone numbers, so this is a real and recurring problem, not an edge case.

**The agreed fix (discussed, never implemented):**
- If phone exists → match by phone (already works).
- If no phone but a real business name exists → fall back to matching on `business_name + town`, and update rather than insert.
- If the name is literally `"Unknown"` → never merge on the name+town fallback, since `"Unknown" + Kandy"` could represent many different places and merging on that would silently corrupt distinct leads together.

**Current state:** this fallback is **not present in the code**. `leadMerge.ts` still does a blanket `if (!phone) return insertLead(incoming)`. This is the single most concrete, already-diagnosed bug waiting to be fixed. It will get worse as soon as more categories/zones are run, since the surface area for the same real business to be re-found grows with every added keyword and zone.

### 5b. Discovered during this review (not previously flagged)
- `collectorRunner.ts` loads `categories.json` but never uses it — every run only ever searches "car" via OSM. The category matrix from the requirements (towns × categories × sources) is not actually being exercised yet, despite categories.json having 3 real categories defined.
- `osm.ts` ignores its own `keyword` parameter and hardcodes `shop=car_repair` — so even once the runner is fixed to loop categories, OSM collection needs its own fix (the Phase B tag-mapping work) before it will return different results per category.
- The `lead_sources` normalized table exists in schema but nothing writes to it — sources are still stored as a JSON string directly on `leads.sources`, which is the exact pattern the implementation conversation explicitly said to avoid when it proposed this table in the first place. Either finish wiring `lead_sources`, or consciously abandon it and drop it from schema — right now it's dead, misleading structure.
- `collection_runs` table (Phase A: resume/progress tracking) exists in schema only — no code inserts/reads from it. A crash mid-run currently has no resume path at all, despite the schema suggesting otherwise.
- `zones` table + `zoneRepository.ts` exist and are functional in isolation (tested via `testZones.ts`), but `collectorRunner.ts` doesn't use them — zones are regenerated in memory every run rather than persisted/read back for audit or resume.
- No pluggable `Collector` interface is actually in use in the runner (despite being designed in the implementation conversation) — `collectOSM` is called directly by name. Adding a second collector (Yellow Pages, etc.) will currently require editing `collectorRunner.ts`'s internals rather than just adding to an array.
- `src/cli/commands/*` test scripts exist but aren't wired into any real CLI subcommand structure — `commander` is a dependency but there's no actual multi-command CLI yet (`collect`, `export`, `inspect` as real subcommands per the original design). Right now there is exactly one entry point (`npm start`) that always does the same hardcoded thing.

### 5c. Not yet built at all (confirmed by absent dependencies, not just absent code)
`playwright`, `cheerio`, and `exceljs`/`xlsx` are not in `package.json`. This confirms:
- **Google Maps collector** (Phase E) — not started. This was flagged from the very beginning as the highest-risk piece (CAPTCHA/blocking risk, needs detail-panel extraction not just results-list scraping, recommended to run the real collection from a local machine rather than a cloud/Codespaces IP).
- **Yellow Pages LK collector** (Phase C) and **Rainbow Pages LK collector** (Phase D) — not started. Both explicitly require inspecting the real site HTML structure first (never done — this was flagged as unconfirmed back in the original requirements doc and still is).
- **Excel export** (Phase G) — not started. There is currently no way to get data out of SQLite into the marketing-ready format that is literally the deliverable of this whole project.

---

## 6. Full roadmap status (Phases A–J from the implementation roadmap)

| Phase | Description | Status |
|---|---|---|
| A | Progress/resume tracking (`collection_runs`) | Schema exists, **not wired up** |
| B | OSM category→tag mapping | **Not done** — OSM hardcoded to `car_repair` regardless of keyword |
| C | Yellow Pages collector | **Not started** — site structure never inspected, dependency not installed |
| D | Rainbow Pages collector | **Not started** — same as C |
| E | Google Maps collector (Playwright) | **Not started** — highest-risk piece, dependency not installed |
| F | Shared hardening (rate limits, retries, structured logs) | Partial — OSM has retry/failover; no structured per-run JSON logs yet; no per-source-tuned rate limiting (only a flat delay in the runner) |
| G | Excel export | **Not started** — dependency not installed |
| H | Dry run / QA (one town, one category, all collectors) | **Not reached** — can't be reached until C/D/E/G exist |
| I | Full production run (local machine, `collect --resume`) | **Not reached** |
| J | Handoff to marketing | **Not reached** |

**Bottom line: the project is still early-stage.** Only the OSM path works end-to-end, and even that has a known, diagnosed, unfixed duplicate-record bug, plus the runner isn't actually driving it off the category config yet.

---

## 7. Key decisions worth knowing (so they aren't re-litigated by accident)

- **Merge key = normalized phone number.** Accepted tradeoff: businesses without a phone can't be merged this way (hence the name+town fallback being added as a secondary key, not a replacement).
- **Coverage over accuracy** — never silently drop a record for being incomplete.
- **better-sqlite3 chosen over an ORM** (Drizzle was considered, not used).
- **exceljs was the fallback choice over SheetJS** for Excel export (not yet implemented either way) — either library is fine, this was explicitly called a non-blocking choice.
- **OSM should be built before Google Maps** — no browser automation, structured response, easiest to get a real pipeline working end-to-end first. This succeeded as a sequencing strategy.
- **Google Maps collection must happen from a local/office machine, not the cloud dev environment** — cloud IPs are far more likely to get CAPTCHA'd/blocked. This is a hard constraint for whenever Phase E happens, not a suggestion.
- **CAPTCHA handling behavior for Google Maps is still an open decision** (pause-and-wait for manual solve vs. log-and-skip-and-retry-later) — must be decided before writing Phase E, since it changes whether the CLI needs an interactive pause capability.
- **Scraping was confirmed acceptable by the stakeholder** for this internal use case — treated as a settled non-legal-risk assumption in the docs, not independently re-verified by any AI involved.

---

## 8. Open questions carried forward (never resolved, still relevant)

- Should ambiguous/low-confidence merges (e.g. name similar but phone format didn't normalize cleanly) get a `needs_review` flag in the schema? Proposed early, never implemented, explicitly deferred to "once real duplicate data is visible" — which it now is (§5a). This is a good moment to actually decide it.
- Exact CAPTCHA-handling behavior for Google Maps (see §7).
- Whether the fixed 5-zone cross pattern (current) is sufficient, or whether adaptive splitting (per the original requirements' §8.2) is actually needed for towns where a zone's results hit Overpass/Maps per-search limits — untested at current scale (only 17 leads/1 zone tested so far, category default "car").

---

## 9. Recommended immediate next steps, in order

1. **Fix `leadMerge.ts`** — add the business_name+town fallback for phone-less records, with the explicit "Unknown" exclusion. This is the one already-diagnosed, agreed-upon fix that's just sitting unimplemented.
2. **Wire the category loop into `collectorRunner.ts`** — it's already loading `categories.json`, just not using it. Replace the hardcoded `"car"` keyword with a real loop over `categories[].keywords`.
3. **Fix `osm.ts` to build queries from keyword/category** (at least a name-match fallback per Phase B, even before building the full tag-mapping table) — otherwise step 2 will just return the same car-repair results for every category.
4. Only after 1–3: decide whether to keep chasing OSM data quality further, or move on to Phase C (Yellow Pages) per the original sequencing — inspecting the real site HTML structure first, since that was never done.
5. Decide on the `lead_sources` table: finish wiring it, or drop it from schema — don't leave it half-built silently.
6. Decide on `collection_runs`/resume behavior before doing a longer/full run — right now a crash mid-run means starting over.

---

## 10. Roadmap by risk-per-push (not just phase order)

Phase order (§6) is still the right conceptual sequence, but given the slow push→Codespace→verify loop (see the operator-context doc), it's more useful to triage upcoming work by **how likely a single push is to fail and how expensive that failure is to diagnose**:

| Tier | Work | Why |
|---|---|---|
| **Low** | merge fallback, category loop, phone/name normalization, repository methods | Deterministic, pure/near-pure logic. Can largely be pre-verified outside the DB (see Decision Log 005). |
| **Medium** | OSM tag mapping, Excel export, real CLI subcommands | Integration work, but no hostile/unpredictable external systems involved. |
| **High** | Yellow Pages, Rainbow Pages collectors | Depend on real third-party site structure that has never been inspected — genuinely unpredictable until first contact. |
| **Highest** | Google Maps collector | Depends on a hostile, anti-automation surface (CAPTCHA/blocking) **and** has an unresolved execution-environment question (§3 of the operator-context doc: can it even run reliably from Codespaces, given local Node is blocked?). This should be answered as an operational question before writing real collector code, not discovered after. |

Prefer clearing every Low item before starting Medium, and treat "can Playwright run acceptably in Codespaces" as its own standalone spike/experiment before investing in the full Google Maps collector — not an assumption to carry forward silently.

## 11. Decision Log

Architecture-level decisions that should not be silently re-litigated later. Implementation history (what broke, what got fixed) lives in §5; this is the *why-we-chose-this* record.

**Decision 001 — Phone is the primary merge key.**
Reason: stable identifier across all four sources. Rejected alternative: business name alone (too many collisions/variants).

**Decision 002 — Coverage preferred over completeness.**
Reason: marketing wants an imperfect lead over a missing one. Incomplete records are kept, not discarded.

**Decision 003 — OSM implemented before Google Maps/directory scrapers.**
Reason: structured API, no browser automation, lowest blocking risk — validates the end-to-end pipeline (collect → merge → store) before tackling the harder sources.

**Decision 004 — GitHub Codespaces is the canonical development/runtime environment.**
Reason: Node.js cannot execute on the operator's local machine at all (company policy blocks both installer and portable Node). This conflicts with the original plan to run the real Google Maps collection locally to avoid cloud-IP blocking (§10, Highest tier) — that conflict is still open, not resolved by this decision.

**Decision 005 — Name+town fallback merge key excludes "Unknown."**
Reason: phone-less OSM records were producing duplicate rows for the same real business across overlapping zones. Business name + town, normalized (trimmed, lowercased, whitespace-collapsed), is used as a secondary match key when no phone exists — except when the name is literally "Unknown" (case-insensitive), since that string carries no identifying signal and merging on it risked silently conflating unrelated businesses. Verified in isolation (pure-logic test, no DB) before implementation — see Task 001.

## 12. What could still go wrong later (things not yet hit, but foreseeable given the design)

- Once real category/keyword variety is running through OSM, the volume of same-business-different-zone duplicates will scale up significantly (5 zones × multiple keywords × multiple towns) — the name+town fallback needs to hold up under that, and may itself produce false-merge risk for common generic business names (e.g. two different unrelated "City Motors" in different real locations within the same town could wrongly merge if zone granularity is coarse).
- Yellow Pages/Rainbow Pages structure is still completely unconfirmed — there's a real risk their HTML isn't simple server-rendered markup (could require JS rendering, in which case the "no browser automation needed" assumption in the roadmap would be wrong and they'd need Playwright too).
- Google Maps CAPTCHA/blocking risk is real and explicitly unresolved — even running from a local machine doesn't guarantee no blocks at production-run volume (many towns × many keywords × sequential requests).
- No structured per-run audit log yet (Phase F) — when a longer, multi-source run eventually happens, diagnosing partial failures without this will be harder than it needs to be.
- The Excel export step has never been tested against real merged multi-source data — once `lead_sources`/`sources` handling is finalized, make sure the exporter actually reads it correctly (e.g. don't let raw JSON leak into a spreadsheet cell, which was explicitly called out as a QA check to do in Phase H).
