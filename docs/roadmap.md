# GildOps Roadmap

This document is the current sequence of work. Shipped changes belong in `CHANGELOG.md`, decisions in `docs/decisions/`, and detailed tasks in work orders.

## Objective

GildOps operates its own business through GildOps, can demonstrate one complete product, and takes its first paying customer.

## How the work is ordered

Work is done in slices. A slice ends in an outcome a person can check in the hosted application, from the first step to the last. A slice is not finished because a screen, a table or a test exists.

Only one slice is active at a time. Work that does not move the active slice forward waits, however useful it is.

Status words: **ACTIVE**, **NEXT**, **PLANNED**, **DONE**, **LATER**.

## Platform is infrastructure only

Platform administration holds what only GildOps as the operator can do: carrier and other provider accounts and keys, creating a business's calling account, the list of features the application can switch on, enforcing what a business has bought, and what providers charge GildOps.

Everything GildOps does as a business happens in its own organization's workspaces, the same ones a customer uses: what it sells and for how much in Finance, its customers and deals in CRM, its subscriptions and invoices in Finance, its website in Studio (ADR-051).

When a slice needs a selling capability that the workspaces lack, the capability is built in the workspace. It is not added to Platform.

## First product: the Dialer

The Dialer is the first product: business calls made and taken in the browser, a call list, call outcomes, history and recordings. Canada is the first market.

It is sold as its own plan. A business that buys only the Dialer sees only what the Dialer needs.

NextFund (`examples/Next-Fund`) is the reference customer. It is a working calling portal built for one business. It shows what a calling team needs day to day. It is a source of requirements, never of code, and nothing specific to NextFund becomes platform behaviour.

## Slice 1: One real call

Status: **ACTIVE**

GildOps' own organization makes and receives real calls on a Canadian number through the hosted application.

Done when all of these are true in the hosted application:

1. A GildOps telephony account is saved and verified in Platform.
2. GildOps' own organization has its own calling account, created from Platform with no manual steps in the carrier's console other than buying the number.
3. One Canadian number is registered to the organization.
4. A member places a call from the Dialer to a mobile phone, and the two people hear each other.
5. A call to the number rings in the browser and can be answered.
6. Hold, mute, transfer and ending a call work on a real call.
7. A recorded call can be played back by a person allowed to.
8. The call record shows the right status and length after the call ends.
9. The call appears in usage with its minutes and what the carrier charged GildOps.
10. An unanswered call follows the organization's chosen fallback.

Whatever fails is fixed inside this slice. The measured cost per minute and per number is written down for slice 3.

## Slice 2: Platform reads as infrastructure

Status: **NEXT**

Platform administration looks and behaves like the rest of the application, and shows only infrastructure.

Done when:

1. Platform uses the same workspace layout, navigation and shared components as the application workspaces.
2. Each thing has one name. The menu, the breadcrumbs and the address agree (for example Providers, not Vendors in one place and Providers in another).
3. The menu lists only infrastructure. Connectors is no longer a menu item; it is a tab inside Providers named "Apps businesses can connect".
4. Every Platform screen meets the UI rules in `AGENTS.md`: no small uppercase labels above headings, no descriptions under headings, no database words such as `api_key` shown to the operator.
5. A failure says what is wrong and what to do. A missing setting is named, not reported as "not found".
6. Plan, pricing and billing screens are grouped apart from infrastructure and marked as leaving. Each is removed when Finance takes over what it does (slices 3 and 4).

## Slice 3: The Dialer as a defined product

Status: **PLANNED**

One definition of the Dialer that the catalogue, the plan, the price and the website all read.

Done when:

1. The catalogue marks each Dialer feature as it really is after slice 1.
2. The Dialer plan is an item GildOps sells from its own organization's Finance: its name, what it includes (calling users, numbers, minutes) and its monthly price in Canadian dollars. Platform holds only which features that item switches on.
3. The price is set from the costs measured in slice 1. What the carrier charges GildOps stays in Platform.
4. A business on only the Dialer plan sees the Dialer, contacts, call history and its settings, and nothing it has not bought.
5. The website's Dialer availability and price come from the catalogue and the plan, not from a separate file.
6. Plans that have not been proven the same way are taken off sale. They are kept, not deleted.

## Slice 4: Sell and deliver without engineering

Status: **PLANNED**

A second business goes from enquiry to making calls with no code changes, no database edits and no work in the carrier's console.

Done when:

1. A consultation request becomes a contact in GildOps' CRM.
2. An accepted deal creates the customer's business with the Dialer plan from one action.
3. The business gets its calling account and a number from inside GildOps, including searching for and buying the number.
4. The owner is invited, signs in and lands in the Dialer.
5. The business pays GildOps monthly through a subscription that GildOps holds in its own organization's Finance, beside its other customers and invoices. Finance gains recurring subscriptions in this slice, for every business to use. The buying business sees its plan and usage under Settings.
6. The whole path is rehearsed with a test business, then used for NextFund.

## Slice 5: GildOps runs on GildOps

Status: **PLANNED**

GildOps' own organization is set up as a real business: brand, price book, leads and pipeline, invoices, its business number on the Dialer, and support requests.

The public website is reworked in this slice, once there is a real product to present. Its colours come from the organization's brand, and its product facts from the catalogue.

## Slice 6: Ready for paying customers

Status: **PLANNED**

Before the first customer depends on GildOps:

1. Changes are tried against a separate test database, not the live one.
2. A backup has been restored once to prove it works.
3. Failed calls and failed carrier callbacks raise an alert.
4. There is a written way to roll a release back.

## Later

These wait until the slices above are done, and each starts as its own slice:

- AI receptionist. It builds on the Dialer's numbers and routing.
- Billing for usage above a plan's allowance.
- Voicemail and SMS.
- An audit of every screen against `docs/ui-system.md`.
- Deeper Marketing and Support workspaces.
- A desktop application.

## Obligations that still stand

These were identified earlier and are not cancelled by the new order. Each must be met before the capability it concerns is sold.

- An automation that changes business records calls the same operation a person would, not a private copy.
- AI tools and actions are declared in one list that agrees on what is allowed, what is included in the plan and what needs approval.
- An approved AI action leaves a link from the request to the change it made.
- Public booking never sends a visitor another customer's address or schedule to work out a free time.
- GildOps' own organization gets no exemption from plans, permissions or usage.
- No customer shares another customer's carrier account.

## What does not belong here

Individual tasks, routes, migrations, bugs and histories of finished work.
