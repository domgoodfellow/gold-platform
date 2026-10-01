"""Reconciling the DNS records a hosting provider asks for against a tenant's own connected DNS.

A deliberately small capability (work order 1, section 2): resolve which connected zone answers
for a hostname, read what is there, and ensure one record safely. Not a Cloudflare control panel --
`app.services.web_delivery` calls `app.services.dns.operations`, never `app.services.dns.cloudflare`
directly, the same `I15` discipline every other vendor boundary in this repository holds.
"""
