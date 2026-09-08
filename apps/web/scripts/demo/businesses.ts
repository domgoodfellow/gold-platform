import type { BusinessShape } from '@/lib/domain/configuration/configure';
import type { Grouping, Measure, PeriodPreset } from '@/lib/domain/reporting/shape';

/**
 * Two businesses, entirely words and numbers.
 *
 * **Everything that differs between them lives here and nowhere else** (D37). `run.ts` contains no
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
  /** How far along its own lifecycle it has walked. An index into `shape.statuses`. */
  status: number;
  /** Priced lines, as `[index into shape.prices, quantity]`. */
  lines: [number, number][];
  costs: { description: string; amountMinor: number; daysAgo: number }[];
  time: { hours: number; daysAgo: number; note: string } | null;
  /**
   * Invoiced, and possibly paid.
   *
   * `daysAgo` is what makes the money reports spread across months rather than stacking on the
   * afternoon the script ran — which D37's amendment names as a requirement rather than a
   * flourish, because otherwise *this month* and *this year* are the same number.
   */
  invoice: { daysAgo: number; paid?: { amountMinor: number; daysAgo: number } } | null;
};

export type DemoBusiness = {
  name: string;
  timezone: string;
  currency: string;
  owner: { email: string; displayName: string };
  /** One colleague on a reduced role, so I12 is something to look at rather than read about. */
  member: { email: string; displayName: string };
  shape: BusinessShape;
  /**
   * The two questions the platform asks about a status, answered per business.
   *
   * Indices into `shape.statuses`. `configureBusiness` creates statuses without either answer,
   * because a shape is what a business says about its work and these are what it says about its
   * *consequences* — so the script answers them afterwards, through the same screen an operator
   * would use.
   */
  releasesResource: number[];
  marksComplete: number[];
  resources: string[];
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
 * An equipment hire yard on an Amsterdam canal.
 *
 * Six statuses, a long lifecycle, and a fleet. Only *Geannuleerd* frees the machine: a job that
 * was done still held it for the afternoon it took, and saying otherwise would erase that from
 * every report about how the fleet was used.
 */
const GRACHTWERK: DemoBusiness = {
  name: 'Grachtwerk Verhuur',
  timezone: 'Europe/Amsterdam',
  currency: 'EUR',
  owner: { email: 'sanne@grachtwerk.test', displayName: 'Sanne de Vries' },
  member: { email: 'joris@grachtwerk.test', displayName: 'Joris Bakker' },
  shape: {
    // Inside the shape rather than beside it, so the demo takes the same path a proposal does
    // (D37). Different lengths from the clinic's, so the two sidebars differ.
    modules: ['billing', 'assets', 'reporting'],
    typeName: 'Verhuring', // a hire
    statuses: [
      'Aangevraagd', // requested
      'Ingepland', // scheduled
      'Uitgeleverd', // out with the customer
      'Retour', // back in the yard
      'Afgerond', // finished
      'Geannuleerd', // cancelled
    ],
    // A straight line, plus a way out of the first three. Written as pairs of indices because a
    // shape is written before anything has an id.
    transitions: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [1, 5],
      [2, 5],
    ],
    fields: {
      work_item: [
        { key: 'inzetlocatie', label: 'Inzetlocatie', kind: 'text', required: false },
        { key: 'kenteken', label: 'Kenteken', kind: 'text', required: false },
        // A choice and a date, in this yard's own words. Nothing about a hire yard makes
        // these the right three states -- they are what this business would have typed, and
        // the clinic below answers the same kinds with nothing in common.
        {
          key: 'staat',
          label: 'Staat bij uitgifte',
          kind: 'select',
          required: false,
          options: ['Nieuw', 'Goed', 'Onderhoud nodig'],
        },
        { key: 'retourdatum', label: 'Verwachte retourdatum', kind: 'date', required: false },
      ],
      customer: [{ key: 'kvk', label: 'KvK-nummer', kind: 'text', required: false }],
    },
    prices: [
      { name: 'Hoogwerker per dag', unit: 'dag', amountMinor: 24_500 },
      { name: 'Aanhanger per dag', unit: 'dag', amountMinor: 7_500 },
      { name: 'Bezorging binnen de ring', unit: 'rit', amountMinor: 4_000 },
    ],
    hours: [
      { dayOfWeek: 1, opensAt: '07:00', closesAt: '17:30' },
      { dayOfWeek: 2, opensAt: '07:00', closesAt: '17:30' },
      { dayOfWeek: 3, opensAt: '07:00', closesAt: '17:30' },
      { dayOfWeek: 4, opensAt: '07:00', closesAt: '17:30' },
      { dayOfWeek: 5, opensAt: '07:00', closesAt: '16:00' },
      { dayOfWeek: 6, opensAt: '08:00', closesAt: '12:00' },
    ],
    // The founder's role is not here — `configureBusiness` only creates the ones beside it.
    roles: [
      {
        name: 'Werfmedewerker', // yard hand
        capabilities: ['work_item.create', 'work_item.transition', 'work_item.record'],
      },
    ],
  },
  releasesResource: [5],
  marksComplete: [4],
  resources: ['Hoogwerker 12m', 'Hoogwerker 18m', 'Bestelbus'],
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
 * A small clinic in Tokyo.
 *
 * Four statuses where the yard has six, yen where the yard has euro, and two modules where the
 * yard has three. Nothing about the platform changes; every one of those is a row.
 */
const KOISHIKAWA: DemoBusiness = {
  name: '小石川クリニック',
  timezone: 'Asia/Tokyo',
  currency: 'JPY',
  owner: { email: 'harada@koishikawa.test', displayName: '原田 美咲' },
  member: { email: 'ito@koishikawa.test', displayName: '伊藤 健' },
  shape: {
    modules: ['billing', 'reporting'],
    typeName: '診察', // a consultation
    statuses: [
      '受付', // received
      '予約済', // booked
      '完了', // done
      'キャンセル', // cancelled
    ],
    transitions: [
      [0, 1],
      [1, 2],
      [0, 3],
      [1, 3],
    ],
    fields: {
      work_item: [
        { key: 'shoken', label: '所見', kind: 'text', required: false },
        {
          key: 'jushin_kubun',
          label: '受診区分',
          kind: 'select',
          required: false,
          options: ['初診', '再診', '健診'],
        },
      ],
      customer: [
        { key: 'hokensho', label: '保険証番号', kind: 'text', required: false },
        // The multi_select in this pair, and a clinic is where one is obviously right: a
        // patient has any number of these, including none, and a business that ships a fixed
        // allergy list would be answering a medical question on somebody else's behalf.
        {
          key: 'allergie',
          label: 'アレルギー',
          kind: 'multi_select',
          required: false,
          options: ['花粉', '薬剤', '食物'],
        },
      ],
    },
    // Yen has no minor unit, so these are whole yen and the money formatting has to know it.
    prices: [
      { name: '初診', unit: '回', amountMinor: 5_500 },
      { name: '再診', unit: '回', amountMinor: 2_800 },
      { name: '健康診断', unit: '回', amountMinor: 12_000 },
    ],
    hours: [
      { dayOfWeek: 1, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 2, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 3, opensAt: '09:00', closesAt: '12:30' },
      { dayOfWeek: 4, opensAt: '09:00', closesAt: '18:00' },
      { dayOfWeek: 5, opensAt: '09:00', closesAt: '18:00' },
    ],
    roles: [
      {
        name: '受付', // reception
        capabilities: ['work_item.create', 'work_item.transition', 'work_item.record'],
      },
    ],
  },
  releasesResource: [3],
  marksComplete: [2],
  resources: ['第一診察室', '第二診察室'],
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

/**
 * The one password, printed at the end so somebody can sign in as anybody.
 *
 * Written down rather than generated, which is the whole difference between this and the test
 * suite: the suites make a password and throw it away, which is why Supabase Studio's user list
 * cannot sign anybody in. This only ever runs against localhost, and `run.ts` refuses otherwise
 * before it creates a single account.
 */
export const DEMO_PASSWORD = 'demo-password-1234';
