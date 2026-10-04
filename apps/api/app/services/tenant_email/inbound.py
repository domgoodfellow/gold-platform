"""Mail that arrives for a business, persisted as Communications data.

**Everything here runs after the signature was verified, and trusts nothing in the payload about
who the mail is for.** The provider's callback names an address, never a business: the database
derives the organization from the receiving identity (`record_inbound_email`), refuses an address
nobody here holds, and refuses one that two businesses claim. This runtime fetches what the callback
omits (the body and the threading headers), hands it over as plain data, and stores attachment bytes
in private storage under the business's own `inbound` folder.

**A provider's attachment link is used once.** It expires, so it is a way to fetch bytes, never a
reference: the bytes are read here (cut off at the size limit), written to private storage, and the
row records the storage path. No link is ever persisted.

**Attachments are untrusted, and nothing here pretends otherwise.** They are not scanned and not
opened; they are stored as they came and are only ever served back as a download with a neutral
content type. A file over the limit is recorded as rejected, with the reason, rather than dropped.
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime

from app.core import db

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", name.replace("\\", "/").split("/")[-1]).lstrip(".")
    return cleaned[:120] or "attachment"


def handle_received(
    settings,
    provider,
    *,
    provider_key: str,
    event: dict,
    event_id: str,
) -> str:
    """One verified `received` event. Returns `recorded`, `duplicate` or `ignored`; raises when the
    message could not be read from the provider, so the provider retries rather than losing it."""
    account_id = db.default_platform_provider_account(settings, provider_key=provider_key)
    credential = db.read_provider_account_credential(settings, account_id=account_id) if account_id else None
    # The account first, the deployment's bootstrap key otherwise: the order the sender and the
    # invitation mail already use, so a deployment that can send can also read what comes back.
    api_key = (credential.get("secret") if credential else None) or os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise RuntimeError("no provider credential can read this message")

    content = provider.fetch_received_email(api_key=api_key, email_id=event["email_id"])
    if content is None:
        raise RuntimeError("the received message could not be read from the provider")

    listed = provider.list_received_attachments(api_key=api_key, email_id=event["email_id"])
    links = {str(row["id"]): row for row in listed}

    result = db.record_inbound_email(
        settings,
        to_addresses=event["to"],
        from_address=event["from"],
        provider_email_id=event["email_id"],
        provider_event_id=event_id,
        rfc_message_id=content["message_id"] or event.get("message_id"),
        in_reply_to=content["in_reply_to"],
        references=content["references"],
        subject=event["subject"],
        text=content["text"],
        html=content["html"],
        received_at=event.get("event_at") if isinstance(event.get("event_at"), datetime) else None,
        authentication=content["authentication"],
        # Metadata only: the link is not passed on, so it cannot be stored.
        attachments=[
            {
                "id": str(row["id"]),
                "filename": row.get("filename"),
                "content_type": row.get("content_type"),
                "size": row.get("size"),
                "content_disposition": row.get("content_disposition"),
                "content_id": row.get("content_id"),
            }
            for row in listed
        ],
    )
    if result is None:
        return "ignored"
    if result.get("duplicate"):
        return "duplicate"

    organization_id = result["organization_id"]
    for pending in result.get("attachments") or []:
        row = links.get(str(pending["provider_attachment_id"]))
        if row is None or not row.get("download_url"):
            db.record_inbound_attachment_stored(settings, attachment_id=pending["id"], storage_path=None, size_bytes=None, rejection="The provider no longer offered this file.")
            continue
        declared = row.get("size")
        if isinstance(declared, int) and declared > MAX_ATTACHMENT_BYTES:
            db.record_inbound_attachment_stored(settings, attachment_id=pending["id"], storage_path=None, size_bytes=None, rejection="This file is larger than 10 MB, so it was not kept.")
            continue
        data = provider.download_attachment(str(row["download_url"]), max_bytes=MAX_ATTACHMENT_BYTES)
        if data is None:
            db.record_inbound_attachment_stored(settings, attachment_id=pending["id"], storage_path=None, size_bytes=None, rejection="This file could not be fetched or is larger than 10 MB, so it was not kept.")
            continue
        path = f"{organization_id}/inbound/{uuid.uuid4()}/{_safe_filename(str(row.get('filename') or 'attachment'))}"
        if db.store_inbound_attachment(settings, path=path, content=data, content_type="application/octet-stream"):
            db.record_inbound_attachment_stored(settings, attachment_id=pending["id"], storage_path=path, size_bytes=len(data))
        else:
            db.record_inbound_attachment_stored(settings, attachment_id=pending["id"], storage_path=None, size_bytes=None, rejection="This file could not be stored.")
    return "recorded"
