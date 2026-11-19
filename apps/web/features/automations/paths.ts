/** Every Automations address, written once. Runs and Workflows replaced Activity and Rules. */
export function automationPaths(organizationId: string) {
  const base = `/organizations/${organizationId}/automations`;
  return {
    base,
    workflows: `${base}/workflows`,
    /** Creating a workflow is its own page; nothing is stored until it is created. */
    newWorkflow: `${base}/workflows/new`,
    workflow: (ruleId: string) => `${base}/workflows/${ruleId}`,
    runs: `${base}/runs`,
    messages: `${base}/messages`,
  };
}
