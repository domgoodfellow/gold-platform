# Run from the repository root after applying the sweep.
# Applied SQL migrations are intentionally excluded: they are immutable historical evidence.

rg -n `
  --glob '!supabase/migrations/**' `
  --glob '!docs/decisions/**' `
  --glob '!docs/roadmap.md' `
  '\bD[0-9]{1,3}\b|docs/(constraints|ui-spec|account-security|public-web-architecture|vision|market|walkthrough)\.md|SETUP\.md' `
  apps packages scripts infrastructure

# Expected result: no matches.

# A broader archaeology sweep for old milestone/slice identifiers in active source comments:
rg -n `
  --glob '!supabase/migrations/**' `
  '\b(?:M|I|C)[0-9]{1,3}\b|of this slice|this slice' `
  apps packages scripts

# Review these manually. Not every M/I/C token is necessarily an obsolete project-history reference.
