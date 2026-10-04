-- A conversation is channel-capable: SMS was its first channel, not its definition.
--
-- **What was wrong.** `conversations` required `phone_number_id` and `external_number`, so the only
-- thing a conversation could be was a thread between one of our numbers and one of theirs. An
-- email thread has no phone number, and giving it a fake one to satisfy a NOT NULL would have been
-- the table lying to keep its shape. Email was about to arrive; the foundation had to change
-- first, not under it.
--
-- **Additive, and nothing is rewritten.** Existing rows keep their ids, customers, unread state and
-- messages: `channel` is added with the default `'sms'`, which is also what backfills every row
-- that exists, then the two phone columns stop being required. The unique key on
-- `(organization_id, phone_number_id, external_number)` is left exactly as it is. It is now the SMS
-- rule by construction, because a conversation with no phone number holds NULLs there and a unique
-- key never treats NULLs as equal — so it cannot claim an email address *is* a phone number, and
-- `record_inbound_message`'s `on conflict` on it keeps working unchanged.
--
-- **Per-channel addressing is a real, typed relationship, not JSON.** An SMS conversation names
-- its number and the other party's number; an email conversation names the email identity it is
-- spoken through. Which of those a row carries is the table's own check, so a row cannot be both,
-- neither, or the wrong half. The other party of an email thread (several people, a Message-ID
-- chain) is thread semantics and arrives with the email channel, not as a guess here.

alter table public.conversations
  add column channel text not null default 'sms' check (channel in ('sms', 'email')),
  add column email_identity_id uuid null;

alter table public.conversations
  alter column phone_number_id drop not null,
  alter column external_number drop not null;

-- Composite and organization-leading (I2/I18): another business's address cannot be named here.
-- No ON DELETE action: an address with history behind it is not deleted out from under it, and the
-- organization's own cascade still works because a plain NO ACTION is checked at the end of the
-- statement.
alter table public.conversations
  add constraint conversations_email_identity_fk
    foreign key (organization_id, email_identity_id) references public.email_identities (organization_id, id);

alter table public.conversations
  add constraint conversations_channel_addressing check (
    (channel = 'sms'   and phone_number_id is not null and external_number is not null and email_identity_id is null)
    or
    (channel = 'email' and phone_number_id is null     and external_number is null     and email_identity_id is not null)
  );

comment on column public.conversations.channel is
  'Which asynchronous channel this thread runs on. Decides which addressing columns the row carries (conversations_channel_addressing).';
comment on column public.conversations.email_identity_id is
  'The business''s own email address this thread is spoken through — the email counterpart of phone_number_id.';

-- ---------------------------------------------------------------------------
-- Grants: a table-wide `grant insert` promised every column. `channel` and `email_identity_id` are
-- not for a signed-in caller to write yet — an email thread is created by the email channel's own
-- writer, which does not exist — so insert becomes the SMS columns by name, and an inserted row is
-- an SMS thread by the column default. (`grant update` was already by column and gains nothing.)
-- ---------------------------------------------------------------------------
revoke insert on public.conversations from authenticated;
grant insert (organization_id, customer_id, phone_number_id, external_number) on public.conversations to authenticated;
