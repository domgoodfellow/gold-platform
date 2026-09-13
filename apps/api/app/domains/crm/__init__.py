"""CRM -- customers, contacts and the sales pipeline they move through.

The canonical catalogue's CRM Product (`platform_catalog_products.key = 'crm'`). Only the
`sales` module's pipeline command lives here so far; customer identity itself is still read and
written entirely from `apps/web/lib/domain/customers/**` (D2's incremental-extraction rule).
"""

from __future__ import annotations
