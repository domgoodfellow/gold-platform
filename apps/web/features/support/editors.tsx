"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/controls/button";
import { TextInput, TextArea } from "@/components/controls/inputs";
import { FormError } from "@/components/controls/form";
import { ConfirmSubmit } from "@/components/controls/confirm-submit";
import {
  PageDrawer,
  PageDrawerTrigger,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerDescription,
  PageDrawerBody,
  PageDrawerFooter,
} from "@/components/panels/page-drawer";
import {
  supportCommandAction,
  supportSearchAction,
} from "@/app/organizations/[organizationId]/support/actions";
import {
  PRIORITIES,
  TRANSITIONS,
  type Policy,
  type RecordKind,
  type RecordOption,
  type SupportCase,
  type SupportData,
  type SupportConfiguration,
  type QueueConfiguration,
} from "@/lib/domain/support/support";
import type { Json } from "@/lib/db/database.types";
import { Field } from "./ui";
import { SelectField } from '@/components/controls/select-field';

export function RecordPicker({
  organizationId,
  kind,
  name,
  initial,
}: {
  organizationId: string;
  kind: RecordKind;
  name: string;
  initial?: { id: string; name: string };
}) {
  const [q, setQ] = useState(""),
    [options, setOptions] = useState<RecordOption[]>(
      initial ? [{ ...initial, kind }] : [],
    ),
    [value, setValue] = useState(initial?.id ?? ""),
    [error, setError] = useState<string | null>(null),
    [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <TextInput
          aria-label={`Search ${kind.replaceAll("_", " ")}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or record identifier"
        />
        <Button
          type="button"
          size="small"
          tone="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                setOptions(await supportSearchAction(organizationId, kind, q));
                setError(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Search failed");
              }
            })
          }
        >
          Search
        </Button>
      </div>
      <SelectField name={name} aria-label={`Select ${kind.replaceAll("_", " ")}`} value={value} onValueChange={(next) => setValue(next)} options={[{ value: '', label: 'None' }, ...(initial && !options.some((o) => o.id === initial.id) ? [{ value: initial.id, label: initial.name }] : []), ...options.map((o) => ({ value: o.id, label: o.name }))]} />
      <FormError>{error}</FormError>
    </div>
  );
}
export function DrawerForm({
  title,
  description,
  trigger,
  submit,
  children,
  save,
  primary = false,
  refreshAfterSave = true,
  defaultOpen = false,
}: {
  title: string;
  description: string;
  trigger: string;
  submit: string;
  children: ReactNode;
  save: (
    form: FormData,
  ) => Promise<{ error: string | null; id: string | null }>;
  primary?: boolean;
  refreshAfterSave?: boolean;
  defaultOpen?: boolean;
}) {
  const id = useId(),
    router = useRouter();
  const [open, setOpen] = useState(defaultOpen),
    [pending, start] = useTransition(),
    [error, setError] = useState<string | null>(null);
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button
          size={primary ? "default" : "small"}
          tone={primary ? "primary" : "secondary"}
          className={
            primary
              ? "h-9 rounded-md px-4 text-xs"
              : undefined
          }
        >
          {trigger}
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{title}</PageDrawerTitle>
          <PageDrawerDescription>{description}</PageDrawerDescription>
        </PageDrawerHeader>
        <PageDrawerBody>
          <form
            id={id}
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setError(null);
              start(async () => {
                try {
                  const result = await save(form);
                  if (result.error) setError(result.error);
                  else {
                    setOpen(false);
                    toast.success("Saved");
                    if (refreshAfterSave) router.refresh();
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not save");
                }
              });
            }}
          >
            {children}
            <FormError>{error}</FormError>
          </form>
        </PageDrawerBody>
        <PageDrawerFooter>
          <Button
            tone="secondary"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            form={id}
            type="submit"
            disabled={pending}
          >
            {pending ? "Saving…" : submit}
          </Button>
        </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}
const field = (f: FormData, key: string) => String(f.get(key) ?? "");
export function NewCase({
  organizationId,
  data,
  mayAssign,
  defaults = {},
  label = "+ New Case",
  defaultOpen = false,
}: {
  organizationId: string;
  data: Pick<SupportData, "queues" | "members">;
  mayAssign: boolean;
  defaults?: Partial<Record<RecordKind, string>> & { customerName?: string };
  label?: string;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<RecordKind>("conversation");
  return (
    <DrawerForm
      title="New Case"
      description="Track a problem through resolution. Related records keep their own history and lifecycle."
      trigger={label}
      submit="Create Case"
      primary
      defaultOpen={defaultOpen}
      refreshAfterSave={false}
      save={async (f) => {
        const input: Record<string, Json> = {
          title: field(f, "title"),
          description: field(f, "description"),
          customer: field(f, "customer"),
          priority: field(f, "priority"),
          queue: field(f, "queue"),
          owner: field(f, "owner"),
        };
        for (const k of [
          "conversation",
          "call",
          "work_item",
          "invoice",
          "asset",
          "location",
        ] as const)
          if (defaults[k]) input[k] = defaults[k]!;
        if (field(f, "related")) input[kind] = field(f, "related");
        const result = await supportCommandAction(
          organizationId,
          "case.create",
          input,
        );
        if (result.id)
          router.push(
            `/organizations/${organizationId}/support/cases/${result.id}`,
          );
        return result;
      }}
    >
      <Field label="Title">
        <TextInput name="title" required maxLength={200} autoFocus />
      </Field>
      <Field label="Description">
        <TextArea name="description" rows={5} maxLength={12000} />
      </Field>
      <Field label="Customer (optional)">
        <RecordPicker
          organizationId={organizationId}
          kind="customer"
          name="customer"
          initial={
            defaults.customer
              ? {
                  id: defaults.customer,
                  name: defaults.customerName ?? "Linked Customer",
                }
              : undefined
          }
        />
      </Field>
      <Field label="Priority">
        <SelectField name="priority" defaultValue="normal" options={[...PRIORITIES.map((p) => ({ value: p, label: p }))]} />
      </Field>
      {mayAssign && <AssignmentFields data={data} />}
      <Field label="Related record type">
        <SelectField value={kind} onValueChange={(next) => setKind(next as RecordKind)} options={[...[
            "conversation",
            "call",
            "work_item",
            "invoice",
            "asset",
            "location",
          ].map((k) => ({ value: k, label: k.replaceAll("_", " ") }))]} />
      </Field>
      <RecordPicker
        key={kind}
        organizationId={organizationId}
        kind={kind}
        name="related"
      />
      {Object.entries(defaults)
        .filter(([k]) => k !== "customerName")
        .map(([k, v]) => (
          <p key={k} className="break-all text-xs text-muted">
            Linked {k.replaceAll("_", " ")}: {v}
          </p>
        ))}
    </DrawerForm>
  );
}
export function AssignmentFields({
  data,
  c,
}: {
  data: Pick<SupportData, "queues" | "members">;
  c?: SupportCase;
}) {
  return (
    <>
      <Field label="Queue">
        <SelectField name="queue" defaultValue={c?.queue_id ?? ""} options={[{ value: '', label: 'No queue' }, ...data.queues
            .filter((q) => q.active || q.id === c?.queue_id).map((q) => ({ value: q.id, label: `${q.name}${!q.active ? " (inactive)" : ""}` }))]} />
      </Field>
      <Field label="Assignee">
        <SelectField name="owner" defaultValue={c?.assigned_membership_id ?? ""} options={[{ value: '', label: 'Unassigned' }, ...data.members.map((m) => ({ value: m.id, label: m.name }))]} />
      </Field>
    </>
  );
}

export function ConfigurationEditor({
  organizationId,
  data,
  kind,
  queue,
  policy,
}: {
  organizationId: string;
  data: SupportConfiguration;
  kind: "queue" | "policy";
  queue?: QueueConfiguration;
  policy?: Policy;
}) {
  const record = queue ?? policy;
  return (
    <DrawerForm
      title={`${record ? "Edit" : "New"} ${kind === "queue" ? "queue" : "service level"}`}
      description={
        kind === "queue"
          ? "Group Cases by operational responsibility. Inactive queues retain their Case history."
          : "Elapsed-time resolution target. Existing Case deadlines remain unchanged when this policy is edited."
      }
      trigger={
        record ? "Edit" : kind === "queue" ? "+ New queue" : "+ New policy"
      }
      submit={kind === "queue" ? "Save queue" : "Save policy"}
      primary={!record}
      save={(f) =>
        supportCommandAction(
          organizationId,
          `${kind}.${record ? "edit" : "create"}`,
          {
            id: record?.id,
            name: field(f, "name"),
            description: field(f, "description"),
            priority: field(f, "priority"),
            queue: field(f, "queue"),
            minutes: Number(field(f, "minutes")),
            active: f.get("active") === "on",
          },
        )
      }
    >
      <Field label={kind === "queue" ? "Queue name" : "Policy name"}>
        <TextInput
          name="name"
          defaultValue={record?.name}
          required
          maxLength={120}
        />
      </Field>
      {kind === "queue" ? (
        <Field label="Description">
          <TextArea
            name="description"
            defaultValue={queue?.description}
            maxLength={4000}
          />
        </Field>
      ) : (
        <>
          <Field label="Priority">
            <SelectField name="priority" defaultValue={policy?.priority ?? "normal"} options={[...PRIORITIES.map((p) => ({ value: p, label: p }))]} />
          </Field>
          <Field label="Applicable queue">
            <SelectField name="queue" defaultValue={policy?.queue_id ?? ""} options={[{ value: '', label: 'All queues (fallback)' }, ...data.queues
                .filter((q) => q.active || q.id === policy?.queue_id).map((q) => ({ value: q.id, label: q.name }))]} />
          </Field>
          <Field label="Resolution target (minutes)">
            <TextInput
              name="minutes"
              type="number"
              required
              min={1}
              max={525600}
              defaultValue={policy?.target_minutes}
            />
          </Field>
          <p className="text-xs text-muted">
            Clock basis: elapsed time, including nights and weekends.
          </p>
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={record?.active ?? true}
        />
        Active
      </label>
    </DrawerForm>
  );
}
export function CaseDrawer({
  organizationId,
  c,
  data,
  kind,
  mayAssign,
}: {
  organizationId: string;
  c: SupportCase;
  data: SupportData;
  kind: "resolve" | "escalate" | "reopen" | "edit" | "assign" | "link";
  mayAssign: boolean;
}) {
  const [recordKind, setRecordKind] = useState<RecordKind>("work_item");
  const titles = {
    resolve: "Resolve Case",
    escalate: "Escalate Case",
    reopen: "Reopen Case",
    edit: "Edit Case",
    assign: "Assign Case",
    link: "Link record",
  };
  return (
    <DrawerForm
      title={titles[kind]}
      trigger={titles[kind]}
      submit={titles[kind]}
      description={
        kind === "resolve"
          ? "Record how the problem was resolved. This summary remains in the Case history."
          : kind === "reopen"
            ? "Explicitly reopen this Case. Previous resolution evidence and the original deadline remain in history."
            : kind === "escalate"
              ? "Record why this Case needs additional attention."
              : "Changes are recorded in the internal Case history."
      }
      primary={kind === "resolve"}
      save={(f) => {
        const input: Record<string, Json> = { id: c.id };
        if (kind === "resolve") input.summary = field(f, "summary");
        if (kind === "reopen" || kind === "escalate")
          input.reason = field(f, "reason");
        if (kind === "assign" || (kind === "escalate" && mayAssign)) {
          input.owner = field(f, "owner");
          input.queue = field(f, "queue");
        }
        if (kind === "escalate") input.priority = field(f, "priority");
        if (kind === "edit") {
          input.title = field(f, "title");
          input.description = field(f, "description");
          input.customer = field(f, "customer");
        }
        if (kind === "link") input[recordKind] = field(f, "related");
        if (kind === "link" && !field(f, "related"))
          return Promise.resolve({
            id: null,
            error: "Select an existing record to link.",
          });
        return supportCommandAction(organizationId, `case.${kind}`, input);
      }}
    >
      {kind === "resolve" ? (
        <Field label="Resolution summary">
          <TextArea
            name="summary"
            required
            minLength={10}
            maxLength={12000}
            rows={8}
            autoFocus
          />
        </Field>
      ) : kind === "reopen" || kind === "escalate" ? (
        <Field
          label={kind === "reopen" ? "Reopening reason" : "Escalation reason"}
        >
          <TextArea
            name="reason"
            required
            minLength={10}
            maxLength={12000}
            rows={5}
          />
        </Field>
      ) : null}
      {kind === "escalate" && (
        <Field label="Priority">
          <SelectField name="priority" defaultValue={c.priority} options={[...PRIORITIES.map((p) => ({ value: p, label: p }))]} />
        </Field>
      )}
      {(kind === "assign" || (kind === "escalate" && mayAssign)) && (
        <AssignmentFields data={data} c={c} />
      )}{" "}
      {kind === "edit" && (
        <>
          <Field label="Title">
            <TextInput
              name="title"
              defaultValue={c.title}
              required
              maxLength={200}
            />
          </Field>
          <Field label="Description">
            <TextArea
              name="description"
              defaultValue={c.description}
              maxLength={12000}
              rows={6}
            />
          </Field>
          <Field label="Customer">
            <RecordPicker
              organizationId={organizationId}
              kind="customer"
              name="customer"
              initial={
                c.customer_id
                  ? { id: c.customer_id, name: c.customer_name ?? "Customer" }
                  : undefined
              }
            />
          </Field>
        </>
      )}
      {kind === "link" && (
        <>
          <Field label="Related record type">
            <SelectField value={recordKind} onValueChange={(next) => setRecordKind(next as RecordKind)} options={[...[
                "conversation",
                "call",
                "work_item",
                "invoice",
                "asset",
                "location",
              ].map((k) => ({ value: k, label: k.replaceAll("_", " ") }))]} />
          </Field>
          <RecordPicker
            key={recordKind}
            organizationId={organizationId}
            kind={recordKind}
            name="related"
          />
        </>
      )}
    </DrawerForm>
  );
}
export function QuickChange({
  organizationId,
  c,
  kind,
  value,
  options,
}: {
  organizationId: string;
  c: SupportCase;
  kind: "priority" | "status" | "owner";
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <SelectField
      aria-label={`${kind} for ${c.case_number}`}
      size="small"
      value={value}
      disabled={pending}
      options={options}
      onValueChange={(v) => {
        start(async () => {
          const result = await supportCommandAction(
            organizationId,
            kind === "owner" ? "case.assign" : `case.${kind}`,
            { id: c.id, [kind]: v },
          );
          if (result.error) toast.error(result.error);
          router.refresh();
        });
      }}
    />
  );
}
export function CaseActions({
  organizationId,
  c,
  data,
  can,
}: {
  organizationId: string;
  c: SupportCase;
  data: SupportData;
  can: (capability: string) => boolean;
}) {
  const closeFormId = useId();
  const router = useRouter(),
    [pending, start] = useTransition();
  const active = !["resolved", "closed"].includes(c.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active && can("support.case.update") && (
        <>
          <QuickChange
            organizationId={organizationId}
            c={c}
            kind="priority"
            value={c.priority}
            options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
          {TRANSITIONS[c.status].length > 0 && (
            <QuickChange
              organizationId={organizationId}
              c={c}
              kind="status"
              value={c.status}
              options={[c.status, ...TRANSITIONS[c.status]].map((s) => ({
                value: s,
                label: s,
              }))}
            />
          )}
          <CaseDrawer
            organizationId={organizationId}
            c={c}
            data={data}
            kind="escalate"
            mayAssign={can("support.case.assign")}
          />
        </>
      )}
      {active && can("support.case.assign") && (
        <CaseDrawer
          organizationId={organizationId}
          c={c}
          data={data}
          kind="assign"
          mayAssign
        />
      )}
      {can("support.case.resolve") &&
        (active ? (
          <CaseDrawer
            organizationId={organizationId}
            c={c}
            data={data}
            kind="resolve"
            mayAssign={false}
          />
        ) : (
          <>
            <CaseDrawer
              organizationId={organizationId}
              c={c}
              data={data}
              kind="reopen"
              mayAssign={false}
            />
            {c.status === "resolved" && (
              <form
                id={closeFormId}
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    const result = await supportCommandAction(
                      organizationId,
                      "case.close",
                      { id: c.id },
                    );
                    if (result.error) toast.error(result.error);
                    router.refresh();
                  });
                }}
              >
                <ConfirmSubmit
                  formId={closeFormId}
                  label="Close Case"
                  confirmLabel="Confirm close"
                  description="Close this resolved Case? Reopening requires an explicit reason and resolution permission."
                  tone="secondary"
                  pending={pending}
                />
              </form>
            )}
          </>
        ))}
    </div>
  );
}
export function InternalNote({
  organizationId,
  c,
}: {
  organizationId: string;
  c: SupportCase;
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="grid gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget,
          body = field(new FormData(form), "body");
        start(async () => {
          const result = await supportCommandAction(
            organizationId,
            "case.note",
            { id: c.id, body },
          );
          setError(result.error);
          if (!result.error) {
            form.reset();
            router.refresh();
          }
        });
      }}
    >
      <Field label="Internal note">
        <TextArea
          name="body"
          required
          maxLength={12000}
          rows={3}
          placeholder="Visible only to authorized Support operators"
        />
      </Field>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Internal only. No message is sent to the Customer.
        </p>
        <Button size="small" disabled={pending} type="submit">
          Add note
        </Button>
      </div>
      <FormError>{error}</FormError>
    </form>
  );
}
