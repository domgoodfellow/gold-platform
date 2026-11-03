-- No member writes an invoice document (Work Order 2G.1, contract).
--
-- Applied after `20261102000003`, once every running application instance creates invoice PDFs
-- through the server's writer and none still stores or records one under a member's session
-- (docs/deployment.md). Before this, a member who may issue invoices could store bytes in an
-- invoice's folder and record them as its PDF. After it, only `invoice_document_writer` stores or
-- records one. Nothing already recorded changes.

drop policy finance_documents_invoice_insert on storage.objects;

revoke all on function public.record_invoice_document(uuid, text, text, bigint, text) from public, anon, authenticated;
drop function public.record_invoice_document(uuid, text, text, bigint, text);
