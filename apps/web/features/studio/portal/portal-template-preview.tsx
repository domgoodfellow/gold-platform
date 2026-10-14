'use client';
import { useState } from 'react';
import type { PortalContent } from '@/lib/domain/portal/composition';
import { PortalRenderer, PORTAL_PREVIEW_RECORDS } from './portal-renderer';
export function PortalTemplatePreview({ content }: { content: PortalContent }) {
  const [pageId,setPageId]=useState(content.defaultPageId);
  return <PortalRenderer content={content} page={content.pages.find(page=>page.id===pageId)!} records={PORTAL_PREVIEW_RECORDS} preview onSelect={setPageId}/>;
}
