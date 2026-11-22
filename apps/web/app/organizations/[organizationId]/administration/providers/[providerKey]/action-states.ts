export type AccountFormState = { error: string | null; saved: boolean };
export const ACCOUNT_FORM_INITIAL: AccountFormState = { error: null, saved: false };

export type AccountCommandState = { error: string | null; done: boolean };
export const ACCOUNT_COMMAND_INITIAL: AccountCommandState = { error: null, done: false };
