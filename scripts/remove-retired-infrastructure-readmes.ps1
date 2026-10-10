# Run from the repository root.
# These READMEs were superseded by infrastructure/README.md plus the canonical docs.

$paths = @(
  'infrastructure/deployment/domains/README.md',
  'infrastructure/deployment/supabase/README.md',
  'infrastructure/deployment/vercel/README.md',
  'infrastructure/docker/README.md',
  'infrastructure/environments/local/README.md',
  'infrastructure/environments/preview/README.md',
  'infrastructure/environments/production/README.md'
)

foreach ($path in $paths) {
  if (Test-Path $path) {
    Remove-Item $path
    Write-Host "Removed $path"
  }
}
