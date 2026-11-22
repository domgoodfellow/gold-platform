export type DraftScenarioState = { error: string | null; saved: boolean };
export type AssumptionState = { error: string | null; recorded: boolean };
export const ASSUMPTION_INITIAL: AssumptionState = { error: null, recorded: false };
