import { DataTable } from '@/components/display/table';
import { Hint } from '@/components/controls/inputs';
import { PLACEHOLDERS, type MessageTemplate } from '@/lib/domain/automation/templates';
import { MessageSheet } from './message-sheet';
import { DeleteMessageDialog } from './delete-message-dialog';

/**
 * Reusable automation messages, as a compact collection — replacing the composition that opened
 * every template as an editable form at once and mixed delivery history into the same section.
 * Delivery history now lives in Activity; a template stays small enough that a Sheet is the whole
 * editor, never a detail route.
 */
export function MessagesView({
  organizationId,
  templates,
  mayManage,
  role,
}: {
  organizationId: string;
  templates: MessageTemplate[];
  mayManage: boolean;
  role: string;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <Hint className="max-w-2xl">
        Every word a customer reads is written here. The platform adds nothing — no greeting, no
        signature, no footer — and puts values where you write{' '}
        {PLACEHOLDERS.map((entry) => entry.token).join(', ')}.
      </Hint>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-subtle">
          {templates.length} {templates.length === 1 ? 'message' : 'messages'}
        </span>
        {mayManage ? <MessageSheet organizationId={organizationId} /> : null}
      </div>

      <DataTable
        rows={templates}
        rowKey={(template) => template.id}
        empty="Nothing written yet."
        emptyAction={mayManage ? <MessageSheet organizationId={organizationId} /> : undefined}
        columns={[
          { key: 'name', header: 'Name', emphasis: 'primary', cell: (template) => template.name },
          {
            key: 'subject',
            header: 'Subject',
            cell: (template) =>
              template.subject ? (
                template.subject
              ) : (
                <span className="text-subtle">No subject line</span>
              ),
          },
        ]}
        actions={
          mayManage
            ? (template) => (
                <>
                  <MessageSheet organizationId={organizationId} template={template} />
                  <DeleteMessageDialog organizationId={organizationId} template={template} />
                </>
              )
            : undefined
        }
      />

      {!mayManage ? (
        <Hint>Your role, {role}, cannot change what this business says.</Hint>
      ) : null}
    </div>
  );
}
