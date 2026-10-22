-- Optional private account contact information. No backfill or policy changes.
alter table public.account_profiles
  add column phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  add column address_line_1 text check (length(address_line_1) between 1 and 200),
  add column address_line_2 text check (length(address_line_2) between 1 and 200),
  add column city text check (length(city) between 1 and 100),
  add column administrative_area text check (length(administrative_area) between 1 and 100),
  add column postal_code text check (length(postal_code) between 1 and 32),
  add column country_code text check (country_code ~ '^[A-Z]{2}$');

comment on column public.account_profiles.phone_e164 is 'Optional explicit E.164 number: + and 2-15 digits, no inferred country or formatting parser. Private to account owner; never authorization data.';
comment on column public.account_profiles.country_code is 'Optional ISO 3166-1 alpha-2 code, validated against assigned codes by the domain. Private personal address, not organization or billing data.';
