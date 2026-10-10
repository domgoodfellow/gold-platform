/**
 * What is wrong with a rule, before anything runs — `reviewAutomationRules`'s findings, rendered
 * where the rule itself is, not on a separate diagnostics screen.
 *
 * **Above the rule rather than beside it**, because these are reasons it will not do what
 * somebody meant, and a warning under three sections of detail is a warning nobody reads. Never
 * a refusal: a rule that looks wrong now may be right about statuses this business is halfway
 * through setting up. Kept attached to its rule rather than pulled into a standalone review
 * section — moving it away would be moving the warning further from the thing it warns about.
 */
export function RuleWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-col gap-1 border-l-2 border-warning/30 pl-3">
      {warnings.map((warning) => (
        <li key={warning} className="text-sm opacity-80">
          {warning}
        </li>
      ))}
    </ul>
  );
}
