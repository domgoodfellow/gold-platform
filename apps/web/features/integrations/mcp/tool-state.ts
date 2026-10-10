/** What a tool action reports back to the form that called it. Kept out of `tool-actions.ts`, which may export only actions. */
export type ToolState = { error: string | null; notice: string | null };

export const TOOL_INITIAL: ToolState = { error: null, notice: null };
