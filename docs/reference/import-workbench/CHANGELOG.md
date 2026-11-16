> Reference copy of the standalone GuildOps Import Workbench changelog. GildOps records its own shipped changes in the repository CHANGELOG.md; nothing below describes a GildOps release.

# Changelog — GuildOps Import Workbench

Versioning uses **major.minor.patch** for the local application. This file is a retrospective summary of the prior builds distributed in this conversation and is now the canonical release log **within the application package**. Version entries describe observed implemented behavior, not promises of production GuildOps integration.

## [0.4.1] — 2026-11-13

### Changed
- Translated preview cards now display their primary Review/Blocked reason without opening the inspector; additional reasons expand in a keyboard-accessible details control.
- Business address, Imported phone, Associated person, and Website occupy consistent positions. Missing values remain visible as “Not provided” rather than shifting adjacent content.
- The generic “Ownership not established” line is removed from phone previews. The inspector continues to distinguish a source-provided phone from verified channel ownership.
- Source-reported contact roles are explicitly labeled as such; technical source IDs are no longer displayed on every card (they remain in inspector/evidence).

### Scope and compatibility
- **Presentation-only patch.** No quality thresholds, Ready/Review/Blocked rules, semantic transformations or exported column shapes changed.
- Existing v0.4 packages remain usable. For these UI improvements, launch the v0.4.1 app and reload your source.

## [0.4.0] — 2026-11-11

### Added
- **`contacts_flat.csv`** in the approved export ZIP: one wide row per eligible source record, with Business, Person, affiliation, structured address, phone, references, row status and quality issues.
- Full flat export schema and source-row grain recorded in `manifest.json` under `flat_contacts`.
- Optional explicitly selected noncanonical fields in the wide file as `extra_<field>`.
- `EXPORT_FORMAT.md`, rewritten `README.md`, refreshed `START_HERE.md`, and this versioned changelog.
- Regression tests for wide export, Ready-only defaults, Review inclusion, rejected semantic rules and French-Canadian address strings.

### Fixed
- Numbered French street addresses (e.g., `267 Rue Saint-Zotique O`) are detected as location-like values instead of creating false Person names.
- Location/postal strings in contact-title fields are suppressed as affiliation roles rather than exported as fabricated job titles.
- The valid Business portion of a mixed source row can remain eligible even when an invalid Person/role interpretation has been removed; the issue is retained in `quality_issues`.

### Known limitations
- The wide CSV is **not cross-row deduplicated** and cannot guarantee automatic creation of separate People/Business relationships when fed to a generic one-contact-per-row importer.
- Neither a person-looking business name nor a business-looking person name can be reliably adjudicated from string shape alone. No AI or external identity verification is performed.
- Existing v0.3 exports do not change retroactively: run v0.4 against the original source for the updated validation and wide CSV.

## [0.3.0] — 2026-11-11

### Added
- Semantic interpretation proposals for nested metadata, repeated person names, combined locations, roles, candidate person-business associations and phone formatting.
- Explicit per-rule approval/rejection before semantic export, explainable source evidence and translated candidate previews.
- Structured `semantic_*.csv` files, `translated_records.jsonl` and `interpretation.json`.
- Advanced field editor retained, with interpretation-first navigation.

### Known limitations at release
- Semantic QA could miss misfiled French street addresses and address-like contact titles; some invalid Person/affiliation candidates were marked Ready. Corrective safeguards were added in v0.4.

## [0.2.1] — 2026-11-10

### Fixed
- Add-mapping workflow gained Cancel, dismiss and Remove actions, plus discard-unapplied-changes behavior.
- Location-like values in person-name source columns no longer automatically became Person names.
- Output-column renames retained their semantic source mapping.

### Added
- Contextual step-by-step guidance in the local interface.

## [0.2.0] — Prior release (November 2026)

### Added
- Source-first field discovery, including nested metadata and derived city/province/postal fields.
- Editable field inclusion, labels, transformations, requirements, reusable import profiles and destination modes.
- Explicit historical DNC output policies and field-configured CSV/JSONL export.

## [0.1.1] — Prior maintenance release

### Fixed
- Corrected `pg_restore` extraction output target for custom PostgreSQL archives.
- Resolved inline-style Content Security Policy warning in the browser UI.

## [0.1.0] — Initial local prototype

### Added
- Local Windows/Python Workbench with CSV and PostgreSQL-dump staging, record inspector, field mapping, basic quality flags and export ZIP.
- No production database writes.

---

**Compatibility:** Export fields/interpretation rules can evolve between versions. Check `manifest.json.version`, `flat_contacts.columns`, and `interpretation.json` rather than assuming two ZIPs have identical schemas. Previous release ZIPs were distributed separately; they are not embedded in this package.
