"""Which questions this platform can be asked, and which function answers each.

**Deliberately one, and it grows one entry per slice that has a screen behind it.** A tool list
written ahead of its callers is the speculative abstraction `constraints.md` opens by refusing,
and here it has a second cost: every tool is a sentence in a prompt, and a model given nine
plausible tools chooses worse than one given the two that fit.

**What is missing from this list is missing on purpose.** Anything shaped like a report --
revenue by customer, least profitable service, cost trends -- gets no tool until M7's aggregate
layer exists. Without it, the only way to answer such a question is arithmetic inside the loop,
which is the second aggregate layer I4 and I5 exist to prevent one level up. Until then the
assistant says it cannot answer that, which is a true sentence and a better one than a number
nobody can reproduce from a screen.
"""

from __future__ import annotations

from app.ai import Tool

WORK_AT_RISK = Tool(
    name="work_at_risk",
    description=(
        "Work that may not be finished on time: jobs whose booked window has already passed "
        "while their status still holds the resource, and jobs booked for today with nobody "
        "assigned. Returns each job's title, its status in this business's own words, its "
        "booked window, and the resource and customer if it has them."
    ),
    schema={
        "type": "object",
        "properties": {
            "organization_id": {
                "type": "string",
                "description": "The business being asked about.",
            },
        },
        "required": ["organization_id"],
        "additionalProperties": False,
    },
    function="work_at_risk",
)

TOOLS: tuple[Tool, ...] = (WORK_AT_RISK,)


def tool_named(name: str) -> Tool | None:
    """The tool by that name, or `None`.

    `None` rather than a raise, because the caller is a model choosing a word: a name nothing
    matches is an ordinary thing for it to produce, it is handed back as a tool result saying so,
    and the loop carries on. A raise here would turn a model's typo into a failed run.
    """
    for tool in TOOLS:
        if tool.name == name:
            return tool
    return None
