"""Web delivery -- a business's own hostname, attached at the hosting provider GildOps runs on.

Lives in this runtime for the reason `app.domains.providers` does: attaching a hostname needs
GildOps' hosting credential, which is stored in Vault and readable by exactly one machine role
only this runtime can wear (D14, D26, D54). The web runtime relays the person's own token; this
one proves that person may manage the business's domains, then acts.
"""
