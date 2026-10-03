"""Proving a business's own sending domain, end to end.

The service that sequences three things nobody else may sequence: GildOps' provider account, the
email provider that holds the domain, and this business's own connected DNS. It coordinates; it
decides nothing a provider or a policy already decides. `app.services.email_provisioning.operations`
calls `app.services.dns.operations` rather than a registrar, and reaches its provider through
`app.providers.providers.email_domains_for` rather than importing one (I15) -- the same two
boundaries `app.services.web_delivery` holds for the hosting side of the same bridge.

**Provisioning, never sending.** Nothing here composes, addresses or delivers a message. What a
verified domain is then used *for* is Communications' own, and is a later work order's.
"""
