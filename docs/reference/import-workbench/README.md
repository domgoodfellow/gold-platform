> Reference copy of the standalone GuildOps Import Workbench v0.4.1 README, kept for the native translated-import integration (`docs/integrations.md` → Translated imports). The standalone application is not part of this repository; its behavior was ported to `apps/web/lib/domain/integrations/translation/`. Version history below is the standalone tool's, not GildOps's.

# GuildOps Import Workbench

**Version 0.4.1 — local data discovery, semantic interpretation, quality review, and dual-format export.**

GuildOps Import Workbench helps turn an unfamiliar data export into *candidate* Businesses, People, affiliations, addresses and contact channels without forcing a customer to recreate the original database. It inspects source fields and nested JSON, proposes transformations, asks for explicit approval, and produces a **single wide CSV** for simple transfers **plus the structured relational package** for migrations that need relationship fidelity.

> **Not a GuildOps database importer.** This is a standalone local staging application. It does not contact an LLM, verify organizations against public registries, query your production GuildOps schema, or write to GuildOps. Its “Ready” label means a record is eligible under local, deterministic validation rules—not that its identity, commercial status or permission to contact has been verified.

Start with [START_HERE.md](START_HERE.md) for the short walkthrough. See [CHANGELOG.md](CHANGELOG.md) for every release and [EXPORT_FORMAT.md](EXPORT_FORMAT.md) for the file contract. [AGENT_INTEGRATION.md](AGENT_INTEGRATION.md) describes future use as an agent/tool backend.

## 1. Requirements

- Windows 10/11, macOS or Linux with **Python 3.11+**.
- For a PostgreSQL **custom-format** `.dump` / `.backup`: PostgreSQL **18 `pg_restore`** command-line tools on PATH (or `PG_RESTORE_PATH` set to its executable). A database server is **not** required.
- Enough RAM/disk for parsing the input and creating the export ZIP. Recommended to work with a copy of your source.

## 2. Start the application

On **Windows**:

1. Extract the downloaded `GuildOps-Import-Workbench-v0.4.1.zip` into a new folder. Don't overwrite an open installation.
2. Open `GuildOps-Import-Workbench-v0.4.1` in File Explorer.
3. Double-click **`start_windows.bat`**. The launcher creates a local `.venv`, installs requirements and starts the web service.
4. Open **http://127.0.0.1:8765** in your browser. The sidebar should say **v0.4.1**.
5. Keep the terminal window open while using the app. To stop it, press **Ctrl+C** in that terminal.

Alternative from **PowerShell**, opened inside the extracted folder:

```powershell
.\start_windows.bat
```

If Windows cannot find `pg_restore.exe`, run from PowerShell before launching:

```powershell
$env:PG_RESTORE_PATH="C:\Program Files\PostgreSQL\18\bin\pg_restore.exe"
.\start_windows.bat
```

On **macOS/Linux**:

```bash
chmod +x start_macos_linux.sh
./start_macos_linux.sh
```

## 3. Follow the five-step workflow

1. **Source** — Upload a CSV, TSV, first-sheet XLSX, JSON/JSONL/NDJSON, or a supported PostgreSQL custom dump. The app inspects the primary dataset and detects structured JSON nested in text. For the NextFund dump, `public.leads` remains the primary dataset, with optional calls/dispositions read only for historical suppression evidence.
2. **Interpret & approve** — Inspect each rule's source evidence. Decide Approve or Reject for every proposed rule, then click **Confirm interpretations**. The rule for extracting nested metadata does **not** require you to import every extracted field later.
3. **Translated preview** — Inspect proposed Business, Person, affiliation, address and phone objects. The raw source evidence remains available. Edit or exclude questionable records as needed.
4. **Quality review** — Review names that resemble addresses, malformed websites, conflicting locations, duplicates, and legacy status signals. An invalid *Person* does not necessarily invalidate a separately usable *Business*; the Person and affiliation can be omitted while the Business candidate remains eligible.
5. **Export** — Keep **Include Review records** *unchecked* to export only Ready source records. Click **Download import package**. Unzip it and open **`contacts_flat.csv`** for the simplest wide view. Use the `semantic_*.csv` tables for a migration adapter that understands relationships.

Advanced controls, including field selection, mapping and required-field rules, remain under **Advanced → Fields & rules**. Selected optional/extra fields are added to the wide export as `extra_<field>` columns. The wide export always contains the standardized semantic fields documented below, even if an optional staging field is disabled. Use the `selected_records.csv` output when you require an exact set of chosen columns.

## 4. What the export contains

The download is `guildops-import-package-v0.4.1.zip`.

| File | Use | Important limit |
|---|---|---|
| **`contacts_flat.csv`** | **Single wide CSV**: Business, associated Person, address, role, phone and provenance in one row | One row per eligible **source record**, not one deduplicated Business; does not import affiliations automatically |
| `semantic_businesses.csv` | Business candidates | Candidate identities only |
| `semantic_people.csv` | Person candidates | May omit people when source text looks like a street/location |
| `semantic_affiliations.csv` | Candidate Business↔Person links and roles | Relationships are unverified; must resolve references before a production import |
| `semantic_addresses.csv` | Structured Business locations | Postal patterns are not external address verification |
| `semantic_channels.csv` | Canonical E.164 phone plus local display value | Phone ownership is **unassigned** unless verified |
| `semantic_evidence.csv` | Original values supporting the translated concepts | Contains personal/source information; do not upload publicly |
| `translated_records.jsonl` | Full translated entity-shaped representation per source row | Not ordinary Contacts JSON |
| `selected_records.csv`, `.jsonl` | Exactly the enabled output fields in Advanced mapping | Does not preserve all entity relationships |
| `businesses.csv`, `people.csv`, `associations.csv` | Backward-compatible selected-field exports | Not automatically deduplicated |
| `review.csv` | Skipped or non-ready source records and issue codes | **Not** approved production contacts |
| `historical_suppression_reference.csv` / `suppression.csv` | Historical DNC evidence, depending on policy | Presence/absence does not determine legal contactability |
| `manifest.json` | Version, source fingerprint, field configuration, counts, and flattened export schema | Not a destination schema |
| `profile.json` | Reusable source mapping profile | Does not save individual manual corrections |
| `interpretation.json` | Approved/rejected semantic decisions with signature | Signatures are reproducibility digests, not truth attestations |

See [EXPORT_FORMAT.md](EXPORT_FORMAT.md) for the **exact flattened columns**, examples, identifier rules, and how to import with the current GuildOps Contacts CSV mapper.

## 5. Critical model distinctions

**Source row ≠ organization ≠ person.** The same company can appear in multiple input rows. The Workbench intentionally avoids automatic cross-row merges. A flattened file repeats company details for each candidate association. If a source has a Business with three people, the CSV can contain three rows; a destination that naively treats each row as a new company will create duplicates.

**Phone attribution is unknown.** A lead phone might be a company line, owner mobile or receptionist number. It is stored in `phone_e164` and displayed as `(905) 466-4554`, but the Workbench does not assign ownership without evidence.

**Suspicious identity fields are not invented.** v0.4 improves detection of numbered French/English street addresses inside person-name or contact-title fields. For example, a record with `full_name = "267 Rue Saint-Zotique O"` should not create a Person called that street. Such source mistakes are flagged in `quality_issues`; a separately valid Business candidate may remain Ready. This is a narrow safeguard, **not** a general AI entity resolver. Some personal names in company fields remain ambiguous.

**Suppression is organization-specific, but not disposable evidence.** The optional historical DNC file is controlled by the selected policy (`reference`, `active`, `omit`). The app does not make legal decisions about outreach. Before reuse by a different organization, assess authorization to use the source and any applicable restrictions.

## 6. Using `contacts_flat.csv` with GuildOps

The current GuildOps Contacts importer maps CSV rows to one Contact each; it is **not** a relational package importer. For a test import of **Companies only**, map `business_name → Name` and `phone_e164 → Phone`, set contact type to Company, and map `street_address`, `city`, `province` to Location. Ignore `person_name`/affiliation columns or keep them in staging until the destination supports separate People and affiliations. Do **not** assume one CSV row will create both a company and a person, or that repeated business rows will be merged.

For an accurate Business + Person migration, develop a destination adapter that resolves stable source references into GuildOps database IDs and handles collisions, deduplication, custom fields and tenant policies. The Workbench's `semantic_*.csv` files are designed as staging inputs for that adapter.

**Important for Excel:** open E.164 phone columns using **Data → From Text/CSV** and specify `phone_e164` as **Text**. Double-click-opening CSV files can cause spreadsheet software to reinterpret strings beginning with `+` and corrupt telephone values. `phone_display` is presentation only.

## 7. Privacy, security and limits

- Local service binds to `127.0.0.1`; it does not send uploads to GuildOps or to cloud AI. **Do not expose port 8765** or publish the full backup to a public repository.
- A full PostgreSQL dump may contain operational or credential data. Use only approved contact extracts outside the local Workbench.
- Uploads are processed locally; app session state, edits and exclusions live **in memory** and disappear when the server stops. Export first.
- CSV files and `semantic_evidence.csv` may contain private contact information. Treat generated ZIPs as sensitive.
- Validation is format-based and heuristic: **no external business verification, no general-purpose semantic AI, no cross-row identity resolution, no live GuildOps writes, no rollback and no consent determination**.
- The flattened CSV includes **standard semantic fields even when some optional advanced mapping checkboxes are off**; this is intentional for the “one big CSV” view. Filter columns at the destination or use `selected_records.csv` when data minimization is necessary.

## 8. Development and testing

```bash
python -m pip install -r requirements.txt
python -m pip install pytest httpx
python -m pytest -q tests
```

Components:

| File | Purpose |
|---|---|
| `source.py` | Reads supported formats, PostgreSQL streaming extract |
| `engine.py` | Field mapping, validation, corrections, `contacts_flat.csv` generation and export |
| `semantic.py` | Evidence-backed interpretation rules and entity candidates |
| `plan.py` | Selected-field plan and sensitive-column filters |
| `app.py` | Loopback-only API and approval gate |
| `static/` | Web UI and local interaction |
| `tests/` | Automated regression tests |

**Release discipline:** update `CHANGELOG.md`, manifest/API/UI version, documentation, and tests whenever the export contract or interpretation behavior changes. Prefer Git tags or commits when incorporating this tool into the GuildOps codebase.

## Review-card behavior (v0.4.1)

In **Translated preview**, Review/Blocked cards expose their first issue beside the status and allow expanding additional reasons. These reasons come from deterministic quality flags; they do not prove the company is inactive or the data unusable. Cards always show Business address, Imported phone, Associated person, and Website in the same positions. Missing values say **Not provided** instead of collapsing the layout.

**Imported phone** means the source row had the number; it does **not** verify whether the phone belongs to the business, person, shared reception desk, or someone else. A source-reported role (e.g. Owner) indicates a proposed business/person affiliation, not verified ownership of the telephone. The inspector retains canonical number, source evidence, and the full issue list.
