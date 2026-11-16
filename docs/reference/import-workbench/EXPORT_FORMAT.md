> Reference copy of the standalone Workbench export contract. GildOps reads `contacts_flat.csv` natively (see `docs/integrations.md` → Translated imports); the other package files are not needed for import.

# Export formats — v0.4

Every approved export contains both a **wide, human-readable source-row table** and a **normalized relational package**. This distinction is essential.

## `contacts_flat.csv` — one big CSV

The CSV uses UTF-8 with BOM for compatibility, a header row, standard quoted CSV encoding and Windows-compatible CRLF line endings. **Grain:** exactly **one row for each eligible original source record**, not one globally unique Business and not one globally unique Person.

By default, only `ready` source rows appear. If the operator enables **Include Review records**, those rows also appear, marked `record_status=review` with quality issues. Blocked/excluded rows do not appear in this file.

### Core columns

| Column | Meaning |
|---|---|
| `source_ref` | Stable-ish workbench reference consisting of a source-hash prefix and original source ID (or row position) |
| `record_status` | `ready` or `review` |
| `quality_issues` | Pipe-separated diagnostics, including suppressed invalid Person/role signals |
| `business_ref` | Candidate Business reference scoped to this source row |
| `business_name` | Normalized Business candidate name |
| `business_industry` | Industry classification from source |
| `business_sic_code` | Source SIC code |
| `business_website` | Syntactically normalized website, not externally verified |
| `business_estimated_revenue` | Unverified source revenue estimate, with no currency assumed |
| `business_estimated_employees` | Unverified source employee count |
| `person_ref` | Person candidate reference, blank when no supported Person identity exists |
| `person_name` | Person candidate name, empty when source resembles a street/location |
| `person_email` | Contact email when present and syntactically valid |
| `affiliation_role` | Proposed Person↔Business role, e.g. `Owner` |
| `affiliation_relationship` | `candidate_associated_contact` if a link was proposed |
| `affiliation_verified` | `false` for proposed, unverified links; empty if none |
| `street_address` | Street component, if recovered |
| `city` | Parsed city |
| `province` | Canadian province/territory code where available |
| `postal_code` | Normalized Canadian postal code where possible |
| `address_type` | `street_unverified`, `mailing_po_box`, or `unknown` |
| `address_verified` | `false` for source-derived addresses; empty if none |
| `phone_e164` | Canonical phone value for reliable matching, e.g., `+19054664554` |
| `phone_display` | User-friendly formatted phone value, e.g., `(905) 466-4554` |
| `phone_owner` | `unassigned` because lead phone ownership is not proven |
| `phone_ownership_verified` | `false` for unassigned candidate channels; blank if absent |

Explicitly enabled **noncanonical** source fields are appended as `extra_<output_column>`. Credentials and known sensitive columns are not auto-appended, nor are the original `notes` JSON containers. `quality_issues` does not include the DNC signal when policy is **omit**; if the source contains suppression evidence, the Workbench retains it internally for review.

The CSV contains **all standard semantic concepts** regardless of the on/off status of advanced optional staging-field checkboxes. That is intentional for the comprehensive view. Use `selected_records.csv` when you need only explicitly selected fields. This behavior must be kept in mind for downstream data minimization.

### Flattening example

For a source row describing **Ackerman Painting** and **Chris Ackerman**, the wide file carries both the business and person on the same line. It also carries a proposed Owner affiliation, a Burlington address and a canonical phone number. This is convenient for viewing and basic transfer.

**It does not create two destination records automatically.** For example, GuildOps' existing one-contact-per-row CSV importer will typically create the business **or** the person based on your mapping; it will not construct a separate Person and affiliation just because these columns exist.

If a company has three people in three source rows, the wide file can repeat the same Business details three times. `business_ref` values are **source-row-local candidates**, not already merged global company identifiers. A production importer must reconcile businesses across rows before creating entities.

## Relational package

The `semantic_*.csv` files decompose the same approved, eligible rows into candidate entities. Relationships are expressed with `business_ref` and `person_ref` for a future importer to resolve into destination IDs. Source evidence and approved interpretation rules are separate. These files are not independently usable as production Contacts uploads without a relationship-aware adapter.

## Old vs. new filenames

- `contacts_flat.csv`: **new in 0.4**. Full meaningful, standardized row representation; preferred for review/basic staging.
- `selected_records.csv`: configurable subset of mapped fields (older v0.2+ behavior).
- `businesses.csv` and `people.csv`: legacy backward-compatible selected-field tables.
- `semantic_businesses.csv` etc.: v0.3+ normalized semantic candidates.

## Reading and validating the package

1. Read `manifest.json` first. Confirm `version=0.4.1`, `flat_contacts.file=contacts_flat.csv`, `flat_contacts.grain`, and `flat_contacts.columns`.
2. Confirm `interpretation.json.confirmed=true` and inspect approved/rejected rules.
3. For a clean-only staging sample, ensure `flat_contacts.review_rows_included=false` and filter `record_status=ready`.
4. Check rows with `quality_issues`, including Ready Businesses whose Person/role values were suppressed. Evaluate person-looking business names, repeated names and mismatched websites separately.
5. Validate source permissions and conduct destination-specific deduplication/field checks *before* actual import. **No external verification is built in.**

### Phone warning

Excel and other spreadsheet applications may interpret `+19054664554` as an arithmetic value. Use **Import CSV → mark phone_e164 as Text**. The Workbench does not prefix E.164 strings with an apostrophe because that would change the canonical value and harm API imports.

### Formula safety

CSV output quotes structured values and escapes obvious formula-leading text when writing CSV. This is defense in depth, not a universal spreadsheet-security guarantee. Treat user-supplied fields as untrusted text.
