"""Creating an organization's customer on GOLD's own billing account.

**The one place this runtime asks the processor to create anything for platform billing**, and
the reason it is here rather than in `apps/web`: the reference the processor returns is the
organization's billing identity, and only a reference this runtime received from the processor
itself, with GOLD's own key, may be recorded as one (`finalize_platform_billing_customer`).

No SDK, the same choice the webhook modules make: one form-encoded request.
"""

from __future__ import annotations

import re

import httpx

API = "https://api.stripe.com/v1"

# What a processor customer reference must look like before it is handed to the database, which
# checks the same shape again.
_CUSTOMER_REFERENCE = re.compile(r"^cus_[A-Za-z0-9_]+$")


class CustomerCreationRefused(Exception):
    """The processor refused, could not be reached, or answered without a usable customer."""


def create_customer(
    *,
    secret_key: str,
    organization_id: str,
    email: str | None,
    name: str | None,
    idempotency_key: str,
    timeout: float = 10.0,
) -> str:
    """Create the customer and return its reference.

    `idempotency_key` names the reservation this customer is for, so a retry of the same
    reservation within the processor's idempotency window returns the same customer rather than a
    second one; the database's single reservation per organization and environment covers the rest.
    """
    form: dict[str, str] = {"metadata[organization_id]": organization_id}
    if email:
        form["email"] = email
    if name:
        form["name"] = name

    try:
        response = httpx.post(
            f"{API}/customers",
            headers={"Authorization": f"Bearer {secret_key}", "Idempotency-Key": idempotency_key},
            data=form,
            timeout=timeout,
        )
    except httpx.HTTPError as failure:
        raise CustomerCreationRefused("the processor could not be reached") from failure

    if response.status_code >= 400:
        raise CustomerCreationRefused(f"the processor refused ({response.status_code})")

    try:
        reference = response.json().get("id")
    except ValueError as failure:
        raise CustomerCreationRefused("the processor answered without a customer") from failure
    if not isinstance(reference, str) or not _CUSTOMER_REFERENCE.match(reference):
        raise CustomerCreationRefused("the processor answered without a customer")
    return reference
