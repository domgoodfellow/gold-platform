-- The self-serve door opens, and both doors are now open at once.
--
-- **This reverses part of `20260830000005` deliberately, and the reason is what that migration
-- could not see.** D29 closed self-serve founding on a good argument: handing somebody an empty
-- business with nobody on the far side doing the configuring is not a product, and the key would
-- be cut at M8 when the onboarding flow became that somebody.
--
-- What the argument missed is who else walks through that door. Somebody who signs up today gets
-- a page saying "you do not belong to a business yet" and **no way forward at all** — not a
-- button, not a form, not an explanation they can act on. That is the same dead end D31 was
-- written about three days ago: a door with nothing behind it, where the person on the other
-- side cannot tell whether the product is broken, unfinished, or theirs to fill in. Closing a
-- door is only honest when the person standing at it can get in another way, and here they
-- cannot: the other way is somebody at GOLD provisioning them, which is not a thing they can
-- reach from a screen.
--
-- **Both doors onto one creation path was always D29's actual axis** — that record says so in
-- its own words, and calls "provisioned, not self-served" the wrong framing. What it deferred was
-- the *quality* of the second door, not its existence. A business founded here is emptier than
-- one M8 will produce, and it is a business, and its owner can configure it: every screen this
-- platform has works on a business somebody is still setting up, because that is also the state
-- of one being set up by hand.
--
-- **The guard inside the function is untouched and is why it was never dropped.** An anonymous
-- session — a real `auth.uid()` from the booking flow, bound to one tenant (D22) — still may not
-- found a business. `anon` is not granted below; only `authenticated` is, which means somebody
-- who registered with an address. That distinction is the whole of what 20260830000001 found the
-- expensive way, and it survives this migration intact.

grant execute on function public.create_organization(text, text, text[], text, text, text)
  to authenticated;

comment on function public.create_organization(text, text, text[], text, text, text) is
  'The self-serve door, open to a registered account. Founds an organization and its first membership, making the caller the founder -- the one thing provision_organization cannot express. Not granted to anon: an anonymous session from the booking flow may not found a business, and the guard inside this function refuses one even if a grant were added by mistake.';
