import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/server';
import { parseChosenPlan, storeChosenPlan } from '@/lib/route/chosen-plan';

/**
 * A pricing page's Start: remember the plan chosen, then found a business with it. A visitor
 * signs up first; someone already signed in goes straight to the founding screen. An unknown
 * plan is not remembered and goes back to Pricing. The destinations are fixed literals.
 */
export async function GET(request: NextRequest) {
  const choice = parseChosenPlan(request.nextUrl.searchParams.get('plan'), request.nextUrl.searchParams.get('billing'));
  if (!choice) return NextResponse.redirect(new URL('/pricing', request.url), 303);

  await storeChosenPlan(choice);
  const { data } = await (await getDb()).auth.getUser();
  return NextResponse.redirect(new URL(data.user ? '/organizations' : '/sign-up', request.url), 303);
}
