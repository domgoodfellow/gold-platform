import { requestWorkflowReviewAction } from './actions';
import { WorkflowReviewForm } from './workflow-review-form';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Workflow review · GOLD',
  description:
    'Map the workflow that is holding your operation back and identify where GOLD can connect the work.',
  alternates: { canonical: '/workflow-review' },
  openGraph: {
    title: 'Request a workflow review · GOLD',
    description:
      'Map the workflow that is holding your operation back and identify where GOLD can connect the work.',
    url: '/workflow-review',
  },
};

export default function WorkflowReviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Request a workflow review
        </h1>
        <p className="max-w-lg text-muted">
          A workflow review is a conversation about how your business runs today. From there: we
          configure GOLD around it, you review exactly what&rsquo;s been set up, and you launch
          when it&rsquo;s ready — never before. Filling this in does not create an account or a
          business in GOLD.
        </p>
      </div>

      <div className="max-w-md">
        <WorkflowReviewForm action={requestWorkflowReviewAction} />
      </div>
    </div>
  );
}
