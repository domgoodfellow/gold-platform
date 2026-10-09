from __future__ import annotations
import httpx
from app.core.db import machine_token, PROVIDER_ROLE, PROVIDER_ACTOR

def record_public_reply(settings, *, site_id: str, visitor_key: str, text: str, handoff: bool) -> None:
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)
    response = httpx.post(f"{settings.supabase_url}/rest/v1/rpc/record_public_communication_reply",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"},
        json={"p_site_id": site_id, "p_visitor_key": visitor_key, "p_body": text, "p_handoff": handoff}, timeout=10.0)
    response.raise_for_status()
