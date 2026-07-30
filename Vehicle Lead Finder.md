# Vehicle Lead Finder — Project Guideline & Requirements Document

**Status:** Draft v1 — ready for implementation
**Owner:** Shehan
**Type:** Internal tooling (local CLI), single-operator use

---

## 1. Overview

Vehicle Lead Finder is a local Node.js CLI tool that discovers businesses in Central Province, Sri Lanka that are likely to own or operate vehicles — the target customer base for vehicle repair, maintenance, parts/accessories, and fleet-related services. It collects business listings from four public sources (Google Maps, Yellow Pages LK, Rainbow Pages LK, OpenStreetMap), merges duplicate businesses across sources, stores results in a local SQLite database, and exports a marketing-ready Excel file for outbound sales campaigns (phone, WhatsApp, email, field visits).

This is a **first assignment at a new workplace** — a one-time data collection effort, not a maintained recurring system.

## 2. Business Problem

Marketing/sales currently has no structured way to identify B2B prospects across the target region. Cold outreach has no target list to work from. This tool produces that list.

## 3. Goals & Success Criteria

**Primary goal:** produce a comprehensive, marketing-ready lead list.

**Definition of done:** every town on the target list has been searched against every business category in the config, across all four data sources. Success is defined by **coverage of the search matrix (towns × categories × sources)**, not by hitting a specific lead count.

**Guiding principle:** maximum coverage over accuracy. Incomplete records (e.g. missing address or phone) are kept, not discarded.

## 4. Users & Roles

| Role | Description |
|---|---|
| Operator (Shehan) | Sole user of the CLI. Runs collection, reviews/cleans data, triggers export. |
| Marketing team | Never touches the tool. Receives only the final Excel export. |

## 5. Scope

### In Scope (v1)
- Business discovery across 4 sources: Google Maps, Yellow Pages (LK), Rainbow Pages (LK), OpenStreetMap
- Auto-subdivision of each town into smaller search zones for better map-based coverage
- Category/keyword list managed via an editable JSON config file
- Cross-source deduplication and merging, keyed on normalized phone number
- Local SQLite storage
- Excel export for handoff to marketing

### Out of Scope (deferred to v2+)
- Website scraping / social media enrichment of individual businesses
- Any hosted, multi-user, or cloud-based version
- Ongoing/scheduled re-collection (this is a one-time run)
- Automated outreach (calling, emailing, messaging) — this tool only produces the list

## 6. Data Sources

| Source | Method | Notes |
|---|---|---|
| Google Maps | Browser automation (Playwright) | Must open each listing's **detail panel**, not just the results list — address, and often the phone number, only render there. |
| Yellow Pages (LK) | Site scraping | Site structure not yet inspected — first implementation step is to confirm the site is scrapable and map its HTML structure. |
| Rainbow Pages (LK) | Site scraping | Same caveat as Yellow Pages — structure unconfirmed, needs inspection before scraper logic is written. |
| OpenStreetMap | Overpass API (structured data, not scraping) | Most reliable source for coordinates; business/phone/address completeness varies by region and is generally sparser than the directory sites. |

**Assumption:** scraping is legally acceptable in this context (confirmed by stakeholder). Technical risk (rate-limiting, CAPTCHAs, layout changes breaking scrapers) remains regardless and is treated as an engineering concern, not a legal one.

## 7. High-Level Workflow

1. Operator selects a category (or "all") from the JSON config.
2. Operator selects a town from the target list.
3. Tool auto-subdivides the town into search zones (grid-based, adjustable radius).
4. Tool runs collection against each of the 4 sources for that category/town/zone combination.
5. Raw results are normalized (phone number formatting, whitespace, casing).
6. Results are deduplicated/merged across sources by normalized phone number.
7. Merged records are inserted into SQLite.
8. Operator repeats across the full town × category matrix.
9. Operator runs an export command to generate the marketing Excel file.

## 8. Functional Requirements (EARS format)

### 8.1 Category Management
- WHEN the tool starts THEN the system SHALL load business categories/keywords from an external JSON config file.
- IF the config file is missing or malformed THEN the system SHALL display a clear error and SHALL NOT proceed with collection.
- WHEN the operator adds or edits a category in the config file THEN the system SHALL reflect that change on the next run without requiring code changes.

### 8.2 Town & Zone Management
- WHEN the operator selects a town THEN the system SHALL automatically subdivide it into smaller search zones.
- WHEN a zone's search results appear to be capped (i.e. hitting the source's per-search result limit) THEN the system SHALL split that zone further and re-search.
- WHEN zone subdivision completes THEN the system SHALL persist the zone boundaries used, so a run can be audited or resumed.

### 8.3 Google Maps Collection
- WHEN the system searches a category within a zone THEN the system SHALL open each result's detail panel to extract address, phone, rating, and map URL.
- IF a listing's detail panel fails to load THEN the system SHALL log the failure and SHALL continue with the next listing rather than halting the run.
- WHEN Google Maps returns a CAPTCHA or blocks the session THEN the system SHALL pause and prompt the operator rather than silently failing.

### 8.4 Yellow Pages / Rainbow Pages Collection
- WHEN the system searches a category within a town THEN the system SHALL extract business name, phone, address, and category from listing pages.
- IF a page structure does not match the expected scraper pattern THEN the system SHALL log the mismatch and SHALL continue rather than crash the run.

### 8.5 OpenStreetMap Collection
- WHEN the system queries a zone THEN the system SHALL retrieve matching points of interest via the Overpass API, including name, coordinates, address (where tagged), and phone (where tagged).
- IF the Overpass API rate-limits the request THEN the system SHALL back off and retry before failing the zone.

### 8.6 Deduplication & Merging
- WHEN two or more records share the same normalized phone number THEN the system SHALL merge them into a single lead record, retaining the most complete field values across sources.
- WHEN a record has no phone number THEN the system SHALL retain it as a standalone, unmerged record rather than discarding it.
- WHEN merging records THEN the system SHALL track which source(s) contributed to each merged lead.

### 8.7 Data Storage
- WHEN a lead record is finalized (merged or standalone) THEN the system SHALL persist it to the local SQLite database.
- IF a record with an identical merge key already exists in the database THEN the system SHALL update/enrich the existing record rather than create a duplicate row.

### 8.8 Export
- WHEN the operator runs the export command THEN the system SHALL generate an Excel (.xlsx) file containing all leads collected to date.
- WHEN exporting THEN the system SHALL include, per lead: business name, phone, address, category, town/zone, contributing source(s), rating (if available), and map/reference URL.

### 8.9 Progress & Resumability *(assumption — needs confirmation, see Open Questions)*
- WHEN a collection run is interrupted (crash, manual stop) THEN the system SHOULD be able to resume from the last completed town/category/zone combination rather than restarting the full matrix.

## 9. Key Constraints
- **Merge key:** normalized phone number (strip spaces/dashes, normalize `+94`/`0094`/`0` prefixes to one canonical form).
- **Zone subdivision:** starting radius to be defined during implementation (recommend defaulting to a fixed value, e.g. 3km, adaptive-split on cap); exact value is an implementation decision, not yet fixed.
- **Config format:** categories/keywords stored as JSON, structure to be finalized during build (e.g. `{ "category": "Transport & Logistics", "keywords": ["transport company", "logistics", "courier"] }`).

## 10. Proposed Data Model (starting point, not final)

**`leads` table**
| Field | Notes |
|---|---|
| id | primary key |
| business_name | |
| phone_normalized | merge key |
| phone_raw | original, unformatted |
| address | |
| category | from config |
| town | |
| zone | |
| latitude / longitude | where available (OSM, Google Maps) |
| rating | where available |
| reference_url | Google Maps URL / directory listing URL |
| sources | list/flags of which of the 4 sources contributed |
| collected_at | timestamp |
| notes | free text, for operator review |

**`zones` table** — persisted town-to-zone breakdown, for audit/resume purposes.

## 11. Non-Functional Requirements
- **Reliability:** a single source or listing failure SHALL NOT halt the overall run — failures are logged and skipped.
- **Data integrity:** the merge process SHALL be idempotent — re-running collection over an already-processed town/category SHALL NOT create duplicate leads.
- **Performance:** no hard target set (single-operator, one-time run) — reasonable per-listing throughput is sufficient; not a system requiring optimization.
- **Portability:** SHALL run on the operator's local machine with no server/hosting dependency.

## 12. Risks & Assumptions

| Risk / Assumption | Status |
|---|---|
| Scraping is legally acceptable in this context | Confirmed by stakeholder — not independently verified as legal advice |
| Yellow Pages / Rainbow Pages site structures are scrapable | **Unconfirmed** — requires inspection at implementation start |
| Source sites may change layout or block automated access | Ongoing risk — scrapers will need maintenance if they break |
| Phone-based merge will miss businesses with no listed phone | Accepted — those stay as unmerged, separate records |
| Zone radius default | Not yet fixed — implementation-time decision |
| Resume-on-crash capability | Proposed, not yet confirmed by operator |

## 13. Open Questions
- Should the tool support resuming an interrupted run (Section 8.9), or is a clean restart each time acceptable?
- What should the default/starting zone radius be?
- Exact JSON schema for the category config file — any fields beyond category name + keywords (e.g. priority weight)?
- Should low-confidence/partial matches (e.g. same name, different phone format that didn't normalize cleanly) be flagged for manual review rather than left unmerged?

## 14. Next Steps
1. Confirm open questions above (or accept the stated defaults/assumptions).
2. Inspect Yellow Pages LK and Rainbow Pages LK site structure to confirm scrapability before writing those scrapers.
3. Scaffold the CLI (category/town selection, zone subdivision, SQLite schema).
4. Build and test each source collector independently before wiring up the merge step.
5. Build export command last, once the schema is stable.
