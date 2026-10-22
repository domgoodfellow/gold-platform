-- Removing a customer must leave their conversations — and the history in them — in place.
--
-- `conversations (organization_id, customer_id)` references `customers (organization_id, id)` with
-- `on delete set null`. For a composite key a plain SET NULL nulls *every* referencing column, and
-- `organization_id` is NOT NULL, so deleting any customer who had a conversation failed outright with a
-- not-null violation instead of detaching the conversation. The action list is narrowed to the one
-- column that should go: the conversation keeps its organization, its messages and its history, and is
-- simply no longer about a customer.
alter table public.conversations drop constraint conversations_organization_id_customer_id_fkey;
alter table public.conversations
  add constraint conversations_organization_id_customer_id_fkey
    foreign key (organization_id, customer_id) references public.customers (organization_id, id)
    on delete set null (customer_id);
