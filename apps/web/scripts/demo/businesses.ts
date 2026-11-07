import type { Db } from '@/lib/db/types';
import type { ResourceClass } from '@/lib/domain/resources/resource-class';
import type { BusinessShape } from '@/lib/domain/configuration/configure';
import { listIndustryTemplates } from '@/lib/domain/configuration/proposals';
import { adjustShape } from '@/lib/domain/configuration/shape';
import type { Grouping, Measure, PeriodPreset } from '@/lib/domain/reporting/shape';

/**
 * Two businesses, entirely words and numbers.
 *
 * **Their setup is not defined here.** Each starts from a published industry template
 * (`industry_templates`, seeded by its migration) — the same starting point any new business can
 * choose — and adds only its own words and prices. The sample data below (resources, customers,
 * jobs, reports) is what makes each one look lived in.
 *
 * **Everything that differs between them lives here and nowhere else**. `run.ts` contains no
 * branch on which of these it is holding, which is what makes the script a small piece of
 * evidence rather than only a convenience — the same discipline `configureBusiness` keeps, and
 * the same claim `milestone-m3.test.ts` makes with two shapes and one function.
 *
 * **They share no word on purpose.** An equipment hire yard in Amsterdam trading in euro and a
 * clinic in Tokyo trading in yen: different vocabulary, different lifecycle length, different
 * currency, different zone, different modules. What somebody is checking while clicking around is
 * that the platform has no opinion about any of it. Yen is not decoration either — it has no
 * minor unit, so it exercises the one place money is divided.
 *
 * The English in comments is a gloss for whoever is reading this file. None of it reaches a
 * screen: every word a screen shows comes from the strings below, which is the point.
 */

/** A job, and everything that has happened to it. Indices point into the lists on the business. */
export type DemoJob = {
  title: string;
  customer: number;
  /** Null leaves it unassigned, which is a real state and the one that fills *unscheduled*. */
  resource: number | null;
  /**
   * When it sits in the diary, as days from the day the script runs, and how long for.
   *
   * Negative is the past. Null is not scheduled at all. Both `scheduleWorkItem` and the aggregate
   * that reads `occupies` take real instants, so a spread here is a spread on the screens.
   */
  startsInDays: number | null;
  startHour: number;
  minutes: number;
  /** How far along its own lifecycle it has walked. An index into the work type's stages. */
  status: number;
  /** Priced lines, as `[index into the business's prices, quantity]`. */
  lines: [number, number][];
  costs: { description: string; amountMinor: number; daysAgo: number }[];
  time: { hours: number; daysAgo: number; note: string } | null;
  /**
   * Invoiced, and possibly paid.
   *
   * `daysAgo` is what makes the money reports spread across months rather than stacking on the
   * afternoon the script ran — which is a stated requirement rather than a
   * flourish, because otherwise *this month* and *this year* are the same number.
   */
  invoice: { daysAgo: number; paid?: { amountMinor: number; daysAgo: number } } | null;
};

export type DemoBusiness = {
  name: string;
  timezone: string;
  currency: string;
  owner: { email: string; displayName: string };
  /** One colleague on a reduced role, so the UI-is-not-authorization rule is something to look at rather than read about. */
  member: { email: string; displayName: string };
  /** The industry template this business starts from, by key. */
  template: string;
  /**
   * The business's own words for the template's (`rename`), and the parts it states itself
   * (`replace`): its prices, in its own currency. Structure stays the template's.
   */
  adjust: { rename: Record<string, string>; replace: Partial<BusinessShape> };
  /** A resource states its class; capabilities are the business's own words for what it can do, optional. */
  resources: { name: string; resourceClass: ResourceClass; capabilities?: string[] }[];
  locations: { label: string; address: string }[];
  customers: { name: string; email: string; phone: string; location: number }[];
  jobs: DemoJob[];
  reports: {
    name: string;
    measure: Measure;
    grouping: Grouping;
    period: PeriodPreset;
    /** Whether the reduced role is told about it. */
    shareWithMember: boolean;
  }[];
  dashboard: { name: string; reports: number[] };
};

/**
 * An equipment hire yard on an Amsterdam canal, from "Rental and field service".
 *
 * Six stages, a long lifecycle, and a fleet. Only *Geannuleerd* frees the machine: a job that
 * was done still held it for the afternoon it took, and saying otherwise would erase that from
 * every report about how the fleet was used.
 */
const GRACHTWERK: DemoBusiness = {
  name: 'Grachtwerk Verhuur',
  timezone: 'Europe/Amsterdam',
  currency: 'EUR',
  owner: { email: 'sanne@grachtwerk.test', displayName: 'Sanne de Vries' },
  member: { email: 'joris@grachtwerk.test', displayName: 'Joris Bakker' },
  template: 'rental_field_service',
  adjust: {
    rename: {
      Hire: 'Verhuring',
      Requested: 'Aangevraagd',
      Scheduled: 'Ingepland',
      'Out with customer': 'Uitgeleverd',
      Returned: 'Retour',
      Finished: 'Afgerond',
      Cancelled: 'Geannuleerd',
      'Site location': 'Inzetlocatie',
      Registration: 'Kenteken',
      'Condition at hand-out': 'Staat bij uitgifte',
      New: 'Nieuw',
      Good: 'Goed',
      'Needs maintenance': 'Onderhoud nodig',
      'Expected return date': 'Verwachte retourdatum',
      'Company number': 'KvK-nummer',
      'Yard hand': 'Werfmedewerker',
    },
    replace: {
      prices: [
        { name: 'Hoogwerker per dag', unit: 'dag', amountMinor: 24_500 },
        { name: 'Aanhanger per dag', unit: 'dag', amountMinor: 7_500 },
        { name: 'Bezorging binnen de ring', unit: 'rit', amountMinor: 4_000 },
      ],
    },
  },
  resources: [
    { name: 'Hoogwerker 12m', resourceClass: 'equipment', capabilities: ['Hoogwerken'] },
    { name: 'Hoogwerker 18m', resourceClass: 'equipment', capabilities: ['Hoogwerken'] },
    { name: 'Bestelbus', resourceClass: 'vehicle', capabilities: ['Transport'] },
  ],
  locations: [
    { label: 'De werf', address: 'Havenstraat 44, Amsterdam' },
    { label: 'Nieuwbouw Zuidas', address: 'Gustav Mahlerlaan 10, Amsterdam' },
    { label: 'Pakhuis Oost', address: 'Cruquiusweg 111, Amsterdam' },
  ],
  customers: [
    {
      name: 'Van Dijk Bouw',
      email: 'planning@vandijkbouw.test',
      phone: '+31 20 555 0142',
      location: 1,
    },
    {
      name: 'Schildersbedrijf Rooij',
      email: 'kantoor@rooij.test',
      phone: '+31 20 555 0188',
      location: 2,
    },
    { name: 'Gemeente Oost', email: 'inkoop@oost.test', phone: '+31 20 555 0110', location: 1 },
  ],
  jobs: [
    // Finished and paid in full, two months back — so a year's figures are not one month's.
    {
      title: 'Gevelherstel Zuidas',
      customer: 0,
      resource: 0,
      startsInDays: -58,
      startHour: 8,
      minutes: 480,
      status: 4,
      lines: [
        [0, 3],
        [2, 1],
      ],
      costs: [{ description: 'Brandstof', amountMinor: 6_200, daysAgo: 58 }],
      time: { hours: 7, daysAgo: 58, note: 'Inclusief opbouw' },
      invoice: { daysAgo: 56, paid: { amountMinor: 77_500, daysAgo: 40 } },
    },
    // Finished last month, invoiced, part-paid — the state that makes an invoice screen worth
    // opening.
    {
      title: 'Schilderwerk pakhuis',
      customer: 1,
      resource: 1,
      startsInDays: -27,
      startHour: 7,
      minutes: 600,
      status: 4,
      lines: [[0, 5]],
      costs: [
        { description: 'Brandstof', amountMinor: 4_800, daysAgo: 27 },
        { description: 'Vervangende hydrauliekolie', amountMinor: 11_900, daysAgo: 26 },
      ],
      time: { hours: 9, daysAgo: 27, note: null as unknown as string },
      invoice: { daysAgo: 24, paid: { amountMinor: 50_000, daysAgo: 12 } },
    },
    // Finished this month and invoiced, nothing paid yet.
    {
      title: 'Kadewerk Cruquius',
      customer: 2,
      resource: 2,
      startsInDays: -6,
      startHour: 9,
      minutes: 300,
      status: 4,
      lines: [
        [1, 2],
        [2, 1],
      ],
      costs: [],
      time: { hours: 4, daysAgo: 6, note: 'Halve dag' },
      invoice: { daysAgo: 4 },
    },
    // Out with the customer right now. Holds a machine, so it is in the committed-time report.
    {
      title: 'Dakrenovatie Oost',
      customer: 0,
      resource: 0,
      startsInDays: 0,
      startHour: 8,
      minutes: 480,
      status: 2,
      lines: [[0, 1]],
      costs: [],
      time: null,
      invoice: null,
    },
    // Booked for next week.
    {
      title: 'Gevelinspectie Havenstraat',
      customer: 1,
      resource: 1,
      startsInDays: 6,
      startHour: 10,
      minutes: 240,
      status: 1,
      lines: [[0, 1]],
      costs: [],
      time: null,
      invoice: null,
    },
    // Asked for and not yet placed in the diary — the pile every business has.
    {
      title: 'Offerte trappenhuis',
      customer: 2,
      resource: null,
      startsInDays: null,
      startHour: 0,
      minutes: 0,
      status: 0,
      lines: [],
      costs: [],
      time: null,
      invoice: null,
    },
    // Called off. Frees the machine, and is deliberately not counted as work anybody did.
    {
      title: 'Afgezegde bezorging',
      customer: 0,
      resource: 2,
      startsInDays: 3,
      startHour: 14,
      minutes: 120,
      status: 5,
      lines: [],
      costs: [],
      time: null,
      invoice: null,
    },
  ],
  reports: [
    {
      name: 'Omzet per klant',
      measure: 'invoiced_and_incurred',
      grouping: 'customer',
      period: 'year',
      shareWithMember: false,
    },
    {
      name: 'Machine-inzet',
      measure: 'time_committed',
      grouping: 'resource',
      period: 'year',
      shareWithMember: true,
    },
  ],
  dashboard: { name: 'Weekoverzicht', reports: [0, 1] },
};

/**
 * A small clinic in Tokyo, from "Appointment clinic".
 *
 * Four stages where the yard has six, yen where the yard has euro, and two modules where the
 * yard has three. Nothing about the platform changes; every one of those is a row.
 */
const KOISHIKAWA: DemoBusiness = {
  name: '小石川クリニック',
  timezone: 'Asia/Tokyo',
  currency: 'JPY',
  owner: { email: 'harada@koishikawa.test', displayName: '原田 美咲' },
  member: { email: 'ito@koishikawa.test', displayName: '伊藤 健' },
  template: 'appointment_clinic',
  adjust: {
    rename: {
      Consultation: '診察',
      Received: '受付',
      Booked: '予約済',
      Done: '完了',
      Cancelled: 'キャンセル',
      Findings: '所見',
      'Visit type': '受診区分',
      'First visit': '初診',
      'Follow-up': '再診',
      'Check-up': '健診',
      'Insurance number': '保険証番号',
      Allergies: 'アレルギー',
      Pollen: '花粉',
      Medication: '薬剤',
      Food: '食物',
      Reception: '受付',
    },
    // Yen has no minor unit, so these are whole yen and the money formatting has to know it.
    replace: {
      prices: [
        { name: '初診', unit: '回', amountMinor: 5_500 },
        { name: '再診', unit: '回', amountMinor: 2_800 },
        { name: '健康診断', unit: '回', amountMinor: 12_000 },
      ],
    },
  },
  resources: [
    { name: '第一診察室', resourceClass: 'facility' },
    { name: '第二診察室', resourceClass: 'facility' },
  ],
  locations: [{ label: '本院', address: '東京都文京区小石川 3-12-4' }],
  customers: [
    { name: '田中 一郎', email: 'tanaka@example.test', phone: '+81 3 5555 0101', location: 0 },
    { name: '佐藤 由美', email: 'sato@example.test', phone: '+81 3 5555 0119', location: 0 },
    { name: '鈴木 大輔', email: 'suzuki@example.test', phone: '+81 3 5555 0127', location: 0 },
  ],
  jobs: [
    {
      title: '健康診断',
      customer: 0,
      resource: 0,
      startsInDays: -45,
      startHour: 10,
      minutes: 60,
      status: 2,
      lines: [[2, 1]],
      costs: [{ description: '検査キット', amountMinor: 2_400, daysAgo: 45 }],
      time: { hours: 1, daysAgo: 45, note: null as unknown as string },
      invoice: { daysAgo: 45, paid: { amountMinor: 12_000, daysAgo: 45 } },
    },
    {
      title: '初診 田中',
      customer: 0,
      resource: 1,
      startsInDays: -20,
      startHour: 9,
      minutes: 30,
      status: 2,
      lines: [[0, 1]],
      costs: [],
      time: null,
      invoice: { daysAgo: 20, paid: { amountMinor: 5_500, daysAgo: 20 } },
    },
    {
      title: '再診 佐藤',
      customer: 1,
      resource: 0,
      startsInDays: -3,
      startHour: 11,
      minutes: 30,
      status: 2,
      lines: [[1, 1]],
      costs: [],
      time: null,
      invoice: { daysAgo: 3 },
    },
    {
      title: '再診 鈴木',
      customer: 2,
      resource: 1,
      startsInDays: 1,
      startHour: 15,
      minutes: 30,
      status: 1,
      lines: [[1, 1]],
      costs: [],
      time: null,
      invoice: null,
    },
    {
      title: '予約待ち 佐藤',
      customer: 1,
      resource: null,
      startsInDays: null,
      startHour: 0,
      minutes: 0,
      status: 0,
      lines: [],
      costs: [],
      time: null,
      invoice: null,
    },
    {
      title: 'キャンセル分',
      customer: 2,
      resource: 0,
      startsInDays: 2,
      startHour: 16,
      minutes: 30,
      status: 3,
      lines: [],
      costs: [],
      time: null,
      invoice: null,
    },
  ],
  reports: [
    {
      name: '患者ごとの請求',
      measure: 'invoiced_and_incurred',
      grouping: 'customer',
      period: 'year',
      shareWithMember: false,
    },
    {
      name: '完了した診察',
      measure: 'work_marked_complete',
      grouping: 'resource',
      period: 'all',
      shareWithMember: true,
    },
  ],
  dashboard: { name: '院内ダッシュボード', reports: [0, 1] },
};

export const BUSINESSES: DemoBusiness[] = [GRACHTWERK, KOISHIKAWA];

/** A demo business's setup: its template, in its own words and prices. Any signed-in session can read a published template. */
export async function demoShape(db: Db, business: DemoBusiness): Promise<BusinessShape> {
  const template = (await listIndustryTemplates(db)).find((candidate) => candidate.key === business.template);
  if (!template) throw new Error(`The ${business.template} template is not published. Apply the migrations first.`);
  return adjustShape(template.shape, business.adjust);
}

/**
 * The one password, printed at the end so somebody can sign in as anybody.
 *
 * Written down rather than generated, which is the whole difference between this and the test
 * suite: the suites make a password and throw it away, which is why Supabase Studio's user list
 * cannot sign anybody in. This only ever runs against localhost, and `run.ts` refuses otherwise
 * before it creates a single account.
 */
export const DEMO_PASSWORD = 'demo-password-1234';
