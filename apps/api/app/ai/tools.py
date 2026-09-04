"""Which questions this platform can be asked, and which function answers each.

**Six, and the list grows one entry per slice that has a screen behind it.** A tool list written ahead
of its callers is the speculative abstraction `constraints.md` opens by refusing, and here it has
a second cost: every tool is a sentence in a prompt, and a model given nine plausible tools
chooses worse than one given the few that fit. Two of these are the questions M8's criterion
names. The third is here because watching a model handle *move it to 9am tomorrow* showed it had
no way to find out what was already booked, so it guessed — which is a foundation problem rather
than a model problem, and the fix is a tool rather than a firmer instruction. The last three are
the aggregates, each with a screen behind it in the same change (D35).

**No tool asks which business, and that was a bug before it was a decision.** Every function
takes `p_organization_id`, and the first version of this file put it in the schema -- so a model
was required to supply an id nothing had ever told it. Driving the real path found it: a model
either invents a uuid, which matches nothing, or asks the person a question they should not have
to answer. The loop fills it in from the request instead. It is not the model's to choose, and now
it cannot: the parameter never appears in a prompt, and RLS decides regardless (D34).

**The report-shaped half arrived, and it arrived as a function rather than as arithmetic here.**
This list said for two milestones that revenue by customer got no tool until M7's aggregate layer
existed, because the only other way to answer was a total computed inside the loop -- the second
aggregate layer I4 and I5 exist to prevent one level up. `invoiced_and_incurred` is that layer,
and the reason it can be a tool at all is that it is the same `stable`, `security invoker`
function shape as everything else here (D35).

**What is still missing is missing on purpose.** *Cost trends* is a shape this returns one period
of rather than a series, and *least profitable service* is a question this cannot answer at all --
grouping by service returns no cost, because a cost belongs to a job and a service is one line on
one. The assistant says so rather than dividing something plausible.
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

INVOICED_AND_INCURRED = Tool(
    name="invoiced_and_incurred",
    description=(
        "What this business has billed and what its work has consumed, grouped by customer, "
        "service, resource or location, and totalled within each currency separately. Invoiced "
        "counts an invoice on the day it was issued; incurred counts a cost on the day it was "
        "incurred. Work that has been priced but not yet invoiced is not counted at all, so say "
        "'invoiced' rather than 'revenue' when reporting these numbers. Grouping by service "
        "returns no cost and no margin, because a cost belongs to a job rather than to one line "
        "on it -- if asked which service is least profitable, say that this cannot be worked out "
        "rather than estimating it."
    ),
    schema={
        "type": "object",
        "properties": {
            "grouping": {
                "type": "string",
                "enum": ["customer", "service", "resource", "location"],
                "description": "What to group the figures by.",
            },
            # Dates, and the business's own zone is applied to them in the database. A model is
            # told today's date in that zone and nothing else -- it never converts, which is the
            # rule `20260902000009` arrived at from the other direction.
            "from": {
                "type": "string",
                "description": (
                    "First day to count, as YYYY-MM-DD, in this business's own dates. "
                    "Omit for no start."
                ),
            },
            "to": {
                "type": "string",
                "description": (
                    "First day *not* to count, as YYYY-MM-DD. For all of August, pass "
                    "2026-09-01. Omit for no end."
                ),
            },
        },
        "required": ["grouping"],
        "additionalProperties": False,
    },
    function="invoiced_and_incurred",
)

WORK_MARKED_COMPLETE = Tool(
    name="work_marked_complete",
    description=(
        "How many jobs this business moved into a status it marks as finished, in a period, "
        "grouped by customer, resource or location. Counts jobs rather than status changes, so "
        "a job finished, reopened and finished again in the same period counts once. Say "
        "'marked complete' rather than 'completed': this is when somebody recorded the job as "
        "done, not when the work stopped. If the business has not said which of its statuses "
        "means finished, this returns nothing -- say so rather than reporting no work."
    ),
    schema={
        "type": "object",
        "properties": {
            "grouping": {
                "type": "string",
                # No service: a job is finished as a whole, and splitting one completion across
                # the priced lines on it would mean inventing a rule about how.
                "enum": ["customer", "resource", "location"],
                "description": "What to group the counts by.",
            },
            "from": {
                "type": "string",
                "description": (
                    "First day to count, as YYYY-MM-DD, in this business's own dates. "
                    "Omit for no start."
                ),
            },
            "to": {
                "type": "string",
                "description": (
                    "First day *not* to count, as YYYY-MM-DD. For all of August, pass "
                    "2026-09-01. Omit for no end."
                ),
            },
        },
        "required": ["grouping"],
        "additionalProperties": False,
    },
    function="work_marked_complete",
)

TIME_COMMITTED = Tool(
    name="time_committed",
    description=(
        "How many minutes of resource time this business has committed in a period, grouped by "
        "customer, resource or location, clipped to that period so a job spanning a boundary "
        "counts in each part only for the time it held. Work whose status the business says "
        "frees the resource is not counted. **This is not utilisation and must not be reported "
        "as a percentage**: dividing it needs the business's opening hours, which this cannot "
        "see -- give the time and let the person divide it if they want to."
    ),
    schema={
        "type": "object",
        "properties": {
            "grouping": {
                "type": "string",
                "enum": ["customer", "resource", "location"],
                "description": "What to group the time by.",
            },
            "from": {
                "type": "string",
                "description": (
                    "First day to count, as YYYY-MM-DD, in this business's own dates. "
                    "Omit for no start."
                ),
            },
            "to": {
                "type": "string",
                "description": (
                    "First day *not* to count, as YYYY-MM-DD. For all of August, pass "
                    "2026-09-01. Omit for no end."
                ),
            },
        },
        "required": ["grouping"],
        "additionalProperties": False,
    },
    function="time_committed",
)

TOOLS: tuple[Tool, ...] = (
    WORK_AT_RISK,
    CUSTOMERS_NOT_CONTACTED,
    SCHEDULE_AHEAD,
    INVOICED_AND_INCURRED,
    WORK_MARKED_COMPLETE,
    TIME_COMMITTED,
)


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
