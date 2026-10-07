import { notFound } from 'next/navigation';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Inbox,
  Settings2,
  Sparkles,
  TriangleAlert,
  Users,
  Workflow,
} from 'lucide-react';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Button } from '@/components/controls/button';
import { FieldLabel, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { Card } from '@/components/surfaces/card';
import { SectionHeading } from '@/components/surfaces/section';
import { Progress } from '@gold/ui/components/progress';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

function Metric({
  label,
  value,
  detail,
  trend,
}: {
  label: string;
  value: string;
  detail: string;
  trend?: string;
}) {
  return (
    <Card as="section" className="min-h-32 justify-between rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        {trend ? <Badge>{trend}</Badge> : null}
      </div>
      <div>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        <p className="mt-1 text-sm text-muted">{detail}</p>
      </div>
    </Card>
  );
}

function MiniBars() {
  const heights = [38, 62, 48, 78, 56, 84, 64, 92, 70, 82, 58, 74];
  return (
    <div className="flex h-28 items-end gap-2" aria-label="Example activity chart">
      {heights.map((height, index) => (
        <span
          key={index}
          aria-hidden
          className="min-w-0 flex-1 rounded-t-md bg-foreground/15"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function Destination({
  icon: Icon,
  title,
  detail,
  state,
}: {
  icon: typeof Users;
  title: string;
  detail: string;
  state?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-hover">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="truncate text-sm text-muted">{detail}</div>
      </div>
      {state ? <Badge>{state}</Badge> : null}
      <ArrowUpRight aria-hidden className="size-4 text-subtle" />
    </div>
  );
}

export default async function UiLabPage({
  params,
}: PageProps<'/organizations/[organizationId]/_ui-lab'>) {
  if (process.env.NODE_ENV === 'production') notFound();

  const { organizationId } = await params;
  await requireOrganization(organizationId);

  return (
    <AppPage>
      <PageHeader
        title="UI Surface Lab"
        meta="Development-only composition reference · not product navigation"
        actions={
          <>
            <Button tone="secondary" size="small">Customize</Button>
            <Button tone="secondary" size="small">Configure</Button>
            <Button size="small">New</Button>
          </>
        }
      />

      <div className="space-y-10">
        <section>
          <div className="mb-4">
            <SectionHeading>Workspace Home composition</SectionHeading>
            <p className="mt-1 text-sm text-muted">
              The Home is an operating cockpit: attention, current work, metrics, destinations and readiness.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-4">
            <Metric label="Open conversations" value="18" detail="6 waiting on a reply" trend="+12%" />
            <Metric label="Work today" value="7" detail="2 still unassigned" />
            <Metric label="Outstanding" value="$18,420" detail="Across 7 invoices" />
            <Metric label="Automation health" value="98.6%" detail="231 runs today" trend="Healthy" />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
            <Card as="section" className="rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <SectionHeading>Operational activity</SectionHeading>
                  <p className="mt-1 text-sm text-muted">Volume across the last 12 periods</p>
                </div>
                <div className="flex gap-2">
                  <Button tone="secondary" size="tiny">30 days</Button>
                  <Button tone="secondary" size="tiny">90 days</Button>
                </div>
              </div>
              <div className="mt-6">
                <MiniBars />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-secondary p-3">
                  <div className="text-xs uppercase tracking-wide text-subtle">Incoming</div>
                  <div className="mt-1 text-lg font-semibold">42</div>
                  <div className="text-sm text-muted">today</div>
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <div className="text-xs uppercase tracking-wide text-subtle">Completed</div>
                  <div className="mt-1 text-lg font-semibold">31</div>
                  <div className="text-sm text-muted">this period</div>
                </div>
                <div className="rounded-xl bg-secondary p-3">
                  <div className="text-xs uppercase tracking-wide text-subtle">Waiting</div>
                  <div className="mt-1 text-lg font-semibold">6</div>
                  <div className="text-sm text-muted">need action</div>
                </div>
              </div>
            </Card>

            <Card as="section" className="rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SectionHeading>Needs attention</SectionHeading>
                  <p className="mt-1 text-sm text-muted">Exceptions that change what to do next</p>
                </div>
                <TriangleAlert aria-hidden className="size-5 text-muted" />
              </div>
              <div className="mt-4 divide-y divide-border">
                {[
                  ['Customer replied to automated SMS', 'Communications · 4 min ago'],
                  ['Job has no assigned resource', 'Field · Today at 14:30'],
                  ['Invoice is 9 days overdue', 'Finance · $1,280'],
                ].map(([title, detail]) => (
                  <div key={title} className="flex gap-3 py-3">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{title}</div>
                      <div className="text-sm text-muted">{detail}</div>
                    </div>
                    <ArrowUpRight aria-hidden className="mt-1 size-4 shrink-0 text-subtle" />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Card as="section" className="rounded-2xl p-5">
              <SectionHeading>Explore workspace</SectionHeading>
              <p className="mt-1 text-sm text-muted">
                Real destinations remain discoverable without turning the sidebar into the sitemap.
              </p>
              <div className="mt-3">
                <Destination icon={Inbox} title="Inbox" detail="Customer conversations and assignments" state="18 open" />
                <Destination icon={Activity} title="Calls" detail="Call history, missed calls and active calling" />
                <Destination icon={Workflow} title="Insights" detail="Reports, trends and alerts" />
              </div>
            </Card>

            <Card as="section" className="rounded-2xl p-5">
              <SectionHeading>Readiness</SectionHeading>
              <p className="mt-1 text-sm text-muted">Configuration status without making setup the whole Home.</p>
              <div className="mt-5 space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span>Workspace setup</span>
                    <span className="font-medium">72%</span>
                  </div>
                  <Progress value={72} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2.5 text-sm">
                    <span className="flex items-center gap-2"><CheckCircle2 aria-hidden className="size-4" /> Messaging</span>
                    <span className="text-muted">Ready</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2.5 text-sm">
                    <span className="flex items-center gap-2"><Clock3 aria-hidden className="size-4" /> Phone number</span>
                    <span className="text-muted">Needs setup</span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </section>

        <section>
          <div className="mb-4">
            <SectionHeading>Collection composition</SectionHeading>
            <p className="mt-1 text-sm text-muted">
              Compact identity, controls and content. No generic subtitle block above the work.
            </p>
          </div>

          <Card as="section" className="rounded-2xl p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
              <TextInput placeholder="Search customers…" size="small" className="min-w-52 flex-1 sm:max-w-sm" />
              <SelectInput size="small" aria-label="Status filter" defaultValue="all">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="waiting">Waiting</option>
              </SelectInput>
              <Button tone="secondary" size="small">Filters</Button>
              <span className="flex-1" />
              <Button tone="secondary" size="small">List</Button>
              <Button tone="secondary" size="small">Grid</Button>
              <Button size="small">Add customer</Button>
            </div>
            <div className="divide-y divide-border">
              {[
                ['Northstar Mechanical', 'Commercial HVAC', 'Follow-up today'],
                ['Pine Street Auto', 'Automotive', 'Quote sent'],
                ['Lakeshore Dental', 'Healthcare', 'New inquiry'],
              ].map(([name, type, state]) => (
                <div key={name} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                    {name.charAt(0)}
                  </span>
                  <div className="min-w-48 flex-1">
                    <div className="font-medium">{name}</div>
                    <div className="text-sm text-muted">{type}</div>
                  </div>
                  <Badge>{state}</Badge>
                  <Button tone="text" size="small">Open</Button>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section>
          <div className="mb-4">
            <SectionHeading>Configuration and form composition</SectionHeading>
            <p className="mt-1 text-sm text-muted">
              Settings are grouped around responsibility and use compact controls rather than a second shell.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card as="section" className="rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SectionHeading>Communication defaults</SectionHeading>
                  <p className="mt-1 text-sm text-muted">Only explanatory copy that adds real context earns space.</p>
                </div>
                <Settings2 aria-hidden className="size-5 text-muted" />
              </div>
              <div className="mt-5 grid gap-4">
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor="lab-caller-name">Caller name</FieldLabel>
                  <TextInput id="lab-caller-name" defaultValue="GildOps Demo" />
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-4">
                  <div className="grid gap-1.5">
                    <FieldLabel htmlFor="lab-hours">Business hours</FieldLabel>
                    <SelectInput id="lab-hours" defaultValue="weekday">
                      <option value="weekday">Mon–Fri · 08:00–17:00</option>
                    </SelectInput>
                  </div>
                  <div className="grid gap-1.5">
                    <FieldLabel htmlFor="lab-routing">Routing mode</FieldLabel>
                    <SelectInput id="lab-routing" defaultValue="team">
                      <option value="team">Team queue</option>
                    </SelectInput>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <FieldLabel htmlFor="lab-note">Fallback note</FieldLabel>
                  <TextArea id="lab-note" defaultValue="If nobody answers, collect the reason for the call and create a follow-up." />
                </div>
                <div className="flex justify-end">
                  <Button>Save changes</Button>
                </div>
              </div>
            </Card>

            <Card as="section" className="rounded-2xl p-5">
              <SectionHeading>Composition vocabulary</SectionHeading>
              <p className="mt-1 text-sm text-muted">Different visual roles, one language.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  [CircleDollarSign, 'Metric', 'One figure with context or trend'],
                  [TriangleAlert, 'Attention', 'Exceptions that change what happens next'],
                  [CalendarDays, 'Current work', 'Today, upcoming or queued operations'],
                  [Sparkles, 'Projection', 'Authorized view into another canonical workspace'],
                  [Activity, 'Activity', 'Recent meaningful change'],
                  [Settings2, 'Readiness', 'Configuration state and shortcuts'],
                ].map(([Icon, title, detail]) => {
                  const Component = Icon as typeof Users;
                  return (
                    <div key={String(title)} className="rounded-xl bg-secondary p-3">
                      <Component aria-hidden className="mb-3 size-4" />
                      <div className="font-medium">{String(title)}</div>
                      <div className="mt-0.5 text-sm text-muted">{String(detail)}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </section>

        <section>
          <div className="mb-4">
            <SectionHeading>Appearance target</SectionHeading>
            <p className="mt-1 text-sm text-muted">Personal preference is separate from tenant branding.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card as="section" className="rounded-2xl p-5">
              <div className="text-sm text-muted">Theme</div>
              <div className="mt-2 text-lg font-semibold">System / Light / Dark</div>
            </Card>
            <Card as="section" className="rounded-2xl p-5">
              <div className="text-sm text-muted">Density</div>
              <div className="mt-2 text-lg font-semibold">Comfortable / Compact</div>
            </Card>
            <Card as="section" className="rounded-2xl p-5">
              <div className="text-sm text-muted">Motion</div>
              <div className="mt-2 text-lg font-semibold">System / Reduced</div>
            </Card>
          </div>
        </section>
      </div>
    </AppPage>
  );
}
