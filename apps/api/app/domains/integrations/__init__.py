"""A tenant's own OAuth connections -- begin, complete, check, disconnect (D56).

Lives here rather than in `apps/web` for one reason: the credential it needs is stored in Vault and
readable by exactly one machine role, which only this runtime can wear (D14, D26). The web
runtime relays a browser; this one proves the caller may manage integrations *for that business*
through the caller's own token, reads or writes the credential, makes one upstream request, and
returns only what a person may see.
"""
