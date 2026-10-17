"""Sending GildOps' own platform email -- an invitation, never a tenant's own message.

See `operations.py`. The Resend account is read exactly as `app.services.web_delivery` reads
GildOps' Vercel account: a GOLD-owned credential, resolved and decrypted only here, never in
`apps/web`.
"""
