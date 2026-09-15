"""What the model may suggest doing, and cannot do.

**These look like tools to a model and are not tools here.** They are declared alongside the
real ones so a model has a way to say *and here is what I would do about it* — and when it names
one, the loop stops and hands the name and the arguments back. Nothing in this runtime dispatches
them, and there is nothing they could be dispatched to: `app.ai.tools` resolves a name to a
Postgres function, and no name here appears in that registry.

**The whitelist that matters is in `apps/web`**, which maps a name to a domain function,
validates the arguments with the same schema the screen's own form uses, and calls it when a
person presses the button — under that person's session, so every capability check is the
ordinary one (D34). A name this file invents and that whitelist does not know is a recorded
refusal rather than a dispatch, which is what lets the two sides disagree safely and is why this
list needs no version.

**One entry, and it grows one per slice with a screen behind it.** A mapping over the domain
layer would be the abstraction with no caller this repository refuses everywhere, and here it has
a second cost: every action is a sentence in a prompt, and a model given nine plausible ones
chooses worse than one given the one that fits.

**Why rescheduling is the first.** It is the action D30 already reasoned about for automations,
and the reasoning carries: it asserts an instant rather than searching for one, so nothing here
is a second `freeWindows` (I5), and the exclusion constraint decides whether it lands (I6). A
refusal is a row somebody reads.
"""

from __future__ import annotations

from app.ai import Tool

RESCHEDULE_WORK_ITEM = Tool(
    name="propose_reschedule",
    description=(
        "Suggest moving one job to a different time. This does not move it: the person you are "
        "answering sees the suggestion and decides.\n\n"
        "work_item_id must be an id you have seen in a tool result in this conversation — never "
        "a description of the job. If you do not have the id, find it first: work_at_risk lists "
        "jobs that have overrun or have nobody assigned, and schedule_ahead lists what is booked "
        "from today onwards. A suggestion naming a job in words is thrown away and nobody sees "
        "it.\n\n"
        "Give the exact start and end you mean, as instants including the offset."
    ),
    schema={
        "type": "object",
        "properties": {
            "work_item_id": {"type": "string", "description": "The job to move."},
            "starts_at": {"type": "string", "description": "New start, ISO 8601 with a zone."},
            "ends_at": {"type": "string", "description": "New end, ISO 8601 with a zone."},
            "because": {
                "type": "string",
                "description": "One sentence for the person deciding, in their own terms.",
            },
        },
        "required": ["work_item_id", "starts_at", "ends_at", "because"],
        "additionalProperties": False,
    },
    # Deliberately empty: there is no function, and `app.ai.loop` treats a name from this list as
    # a stopping point rather than something to call. A string here would be a way to make one of
    # these executable by accident.
    function="",
)

ACTIONS: tuple[Tool, ...] = (RESCHEDULE_WORK_ITEM,)

# A public visitor may ask for a person, but must never be handed an operational action or a
# private-data tool.  This is still an *action proposal*, not a magic phrase interpreted by a
# web route: the deployment decides whether it is available and Communications records it.
ESCALATE_TO_HUMAN = Tool(
    name="escalate_to_human",
    description=(
        "Request a human follow-up when the visitor asks for one, needs account-specific help, "
        "or the public information cannot answer safely. Do not promise a response time."
    ),
    schema={
        "type": "object",
        "properties": {"because": {"type": "string", "description": "Brief reason for the handoff."}},
        "required": ["because"],
        "additionalProperties": False,
    },
    function="",
)

PUBLIC_ACTIONS: tuple[Tool, ...] = (ESCALATE_TO_HUMAN,)


def action_named(name: str) -> Tool | None:
    for action in ACTIONS:
        if action.name == name:
            return action
    return None
