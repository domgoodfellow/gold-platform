"""An organization's customer on GOLD's own billing account, created once and recorded by trust.

**Three steps, each proving something the next relies on.**

1. *As the person asking*, reserve the organization's billing customer. The database checks that
   this person is a billing manager there; if not, nothing is reserved and the processor is never
   asked. A customer already finalized is simply returned.
2. *With GOLD's own key*, ask the processor to create the customer. Only this runtime holds that
   key, so a reference returned here is one GOLD's account actually created for this organization.
3. *As the billing provisioner*, record that reference against exactly the reservation from step 1.
   No human session can do this step, which is what stops a person from claiming a processor
   customer they merely know the reference of.

The environment is this deployment's, read from its own key; nothing in the request chooses it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.config import PlatformBillingProvisioningSettings
from app.core.db import (
    BillingCustomerRefused,
    begin_platform_billing_customer,
    finalize_platform_billing_customer,
)
from app.errors import ConflictError, DomainError, NotFoundError, ValidationError
from app.providers.stripe.platform_billing_customers import CustomerCreationRefused, create_customer

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class BillingProviderRefusedError(DomainError):
    """The processor refused, or could not be reached. The reservation is kept for a retry."""

    status = 502
    code = "provider_refused"


@dataclass(frozen=True)
class EnsureCustomerCommand:
    organization_id: str
    email: str | None
    name: str | None


def _translate(refusal: BillingCustomerRefused) -> DomainError:
    # 42501 is this schema's ambiguous "not found, or not yours"; a person who may not manage this
    # business's billing is told no more than that.
    if refusal.sqlstate == "42501":
        return NotFoundError("No such business, or you cannot manage its billing.")
    if refusal.sqlstate in {"22023", "23514"}:
        return ValidationError("That billing customer could not be recorded.")
    if refusal.sqlstate in {"23505", "55000"}:
        return ConflictError("That billing customer changed while it was being recorded.")
    return DomainError("That could not be completed.")


def ensure_billing_customer(
    settings: PlatformBillingProvisioningSettings,
    *,
    token: str,
    caller_id: str,
    command: EnsureCustomerCommand,
) -> dict[str, str]:
    organization_id = command.organization_id.strip().lower()
    if not _UUID.match(organization_id):
        raise ValidationError("A business is required.")

    try:
        reference, finalized = begin_platform_billing_customer(settings, token=token, organization_id=organization_id)
    except BillingCustomerRefused as refusal:
        raise _translate(refusal) from refusal

    if not finalized:
        try:
            created = create_customer(
                secret_key=settings.stripe_secret_key,
                organization_id=organization_id,
                email=command.email,
                name=command.name,
                # The reservation names this attempt: a retry of the same reservation is the same
                # request to the processor, and a different reservation never is.
                idempotency_key=f"platform-billing-customer:{organization_id}:{reference}",
            )
        except CustomerCreationRefused as failure:
            raise BillingProviderRefusedError("The billing provider would not create a customer.") from failure

        try:
            reference = finalize_platform_billing_customer(
                settings,
                organization_id=organization_id,
                pending_reference=reference,
                customer_reference=created,
                requested_by=caller_id,
            )
        except BillingCustomerRefused as refusal:
            if refusal.sqlstate not in {"23505", "55000"}:
                raise _translate(refusal) from refusal
            # A concurrent request finalized first. Its customer is the answer; anything still
            # pending, or a reference another business holds, is a refusal and never a guess.
            try:
                reference, finalized = begin_platform_billing_customer(settings, token=token, organization_id=organization_id)
            except BillingCustomerRefused as again:
                raise _translate(again) from again
            if not finalized:
                raise _translate(refusal) from refusal

    return {"customer_reference": reference, "environment": settings.environment}
