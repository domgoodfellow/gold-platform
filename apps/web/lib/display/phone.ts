/**
 * How a stored phone number reads on screen. The stored value (E.164 for a number with a country
 * code) is still what gets dialled and linked; this only changes the spelling a person sees.
 *
 * Only North American numbers are regrouped. Another country's grouping is not guessed: a number
 * that looks plausible and is wrong is worse than one shown exactly as stored.
 */
export function formatPhoneForDisplay(stored: string): string {
  const value = stored.trim();
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : value;
}
