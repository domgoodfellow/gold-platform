import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { ButtonLink } from '@/components/controls/button';
import { AppPage } from '@/components/layout/app-page';
import { SectionHeading } from '@/components/surfaces/section';
import { findHelpArticle } from '@/lib/help/articles';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function HelpArticlePage({ params }: PageProps<'/organizations/[organizationId]/help/[slug]'>) {
  const { organizationId, slug } = await params;
  await requireOrganization(organizationId);
  const article = findHelpArticle(slug);
  if (!article) notFound();

  return (
    <AppPage width="reading">
      <Link href={`/organizations/${organizationId}/help`} className="mb-3 inline-block text-sm text-accent-text hover:underline">All help articles</Link>
      <PageHeader
        section="Help"
        title={article.title}
        meta={article.summary}
        actions={article.opens ? <ButtonLink href={`/organizations/${organizationId}/${article.opens.path}`} tone="secondary" size="small">{article.opens.label}</ButtonLink> : undefined}
      />
      <div className="flex flex-col gap-8">
        {article.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <SectionHeading>{section.heading}</SectionHeading>
            {section.body.map((paragraph) => <p key={paragraph} className="text-sm leading-relaxed">{paragraph}</p>)}
          </section>
        ))}
      </div>
    </AppPage>
  );
}
