"""Provider operations -- acting on a GOLD-owned account at an upstream provider.

Lives here rather than in `apps/web` for one reason: the credential it needs is stored in Vault
and readable by exactly one machine role, which only this runtime can wear (D14, D26). The web
runtime asks; this one proves the asker is platform staff, reads the credential once, makes one
upstream request, and returns only what a person may see.
"""
