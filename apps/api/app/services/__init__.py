"""Application services that coordinate authenticated state, persistence and external systems.

Services may sequence core persistence, machine credentials, connectors and providers. They do
not own provider dialects; those translations remain in ``app.providers`` or ``app.connectors``.
"""
