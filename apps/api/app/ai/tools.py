"""Which questions this platform can be asked, and which function answers each.

**Three, and the list grows one entry per slice that has a screen behind it.** A tool list written ahead
of its callers is the speculative abstraction `constraints.md` opens by refusing, and here it has
a second cost: every tool is a sentence in a prompt, and a model given nine plausible tools
chooses worse than one given the few that fit. Two of these are the questions M8's criterion
names. The third is here because watching a model handle *move it to 9am tomorrow* showed it had
no way to find out what was already booked, so it guessed — which is a foundation problem rather
than a model problem, and the fix is a tool rather than a firmer instruction.

**No tool asks which business, and that was a bug before it was a decision.** Every function
takes `p_organization_id`, and the first version of this file put it in the schema -- so a model
was required to supply an id nothing had ever told it. Driving the real path found it: a model
either invents a uuid, which matches nothing, or asks the person a question they should not have
to answer. The loop fills it in from the request instead. It is not the model's to choose, and now
it cannot: the parameter never appears in a prompt, and RLS decides regardless (D34).

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
    schema={"type": "object", "properties": {}, "additionalProperties": False},
    function="work_at_risk",
)

CUSTOMERS_NOT_CONTACTED = Tool(
    name="customers_not_contacted",
    description=(
        "Customers this business has recorded nothing about for a while — no job, no visit, no "
        "invoice, no note. Give the number of days to count as 'a while'. Returns each "
        "customer's name and contact details, when something last happened, and how many days "
        "ago that was. Adding a customer is itself something happening, so a newly added one is "
        "not silent."
    ),
    schema={
        "type": "object",
        "properties": {
            "days": {
                "type": "integer",
                "description": "How many days of silence counts. Ask the person if unsure.",
            },
        },
        "required": ["days"],
        "additionalProperties": False,
    },
    function="customers_not_contacted",
)

SCHEDULE_AHEAD = Tool(
    name="schedule_ahead",
    description=(
        "What is already booked over the next few days, in this business's own hours: each "
        "job's title, its stage, when it starts and ends, and which resource and customer it "
        "is for. Use this before suggesting a new time for anything, so the time you suggest "
        "is one you have checked rather than guessed. It does not tell you what is free — it "
        "tells you what is taken."
    ),
    schema={
        "type": "object",
        "properties": {
            "days": {
                "type": "integer",
                "description": "How many days ahead to look, counting from today.",
            },
        },
        "required": ["days"],
        "additionalProperties": False,
    },
    function="schedule_ahead",
)

TOOLS: tuple[Tool, ...] = (WORK_AT_RISK, CUSTOMERS_NOT_CONTACTED, SCHEDULE_AHEAD)


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
