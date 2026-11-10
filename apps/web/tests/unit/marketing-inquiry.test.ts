import { describe, expect, it } from 'vitest';
import { OFFERINGS, consultationHref } from '@/lib/marketing/content';
import { DIALER_QUESTIONS, INQUIRY_TOPICS, dialerNeeds, inquiryTopic, inquiryTopicNote, topicNeeds } from '@/lib/marketing/inquiry';

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

const { callers, numbers, direction, volume, extras } = DIALER_QUESTIONS;

describe('the product a consultation request names', () => {
  it('offers every product, then the two answers for a visitor who has not chosen', () => {
    expect(INQUIRY_TOPICS.map((topic) => topic.value)).toEqual([...OFFERINGS.map((offering) => offering.id), 'several', 'unsure']);
  });

  it('accepts only a listed product, from a form or from ?product=', () => {
    expect(inquiryTopic('dialer')?.label).toBe('Dialer');
    expect(inquiryTopic('unsure')?.label).toBe('Not sure yet');
    expect(inquiryTopic('Dialer')).toBeNull();
    expect(inquiryTopic('<script>')).toBeNull();
    expect(inquiryTopic(null)).toBeNull();
    expect(inquiryTopic(['dialer'])).toBeNull();
  });

  it('is linked to from each product with that product chosen', () => {
    expect(consultationHref(OFFERINGS.find((offering) => offering.id === 'dialer'))).toBe('/demo?product=dialer');
    expect(consultationHref()).toBe('/demo');
    for (const offering of OFFERINGS) expect(inquiryTopic(new URL(consultationHref(offering), 'https://x.test').searchParams.get('product'))?.offering).toBe(offering);
  });

  it('says before sending when the chosen product is not yet available, and only then', () => {
    expect(inquiryTopicNote(inquiryTopic('dialer'))).toBe('The Dialer is not yet available to new businesses. We’ll talk through what you need and tell you when it can be set up for you.');
    for (const offering of OFFERINGS) {
      expect(inquiryTopicNote(inquiryTopic(offering.id)) !== null, offering.id).toBe(offering.availability === 'not_yet');
    }
    expect(inquiryTopicNote(inquiryTopic('several'))).toBeNull();
  });
});

describe('the Dialer answers', () => {
  it('become one line, in question order, for the CRM', () => {
    const answers = form([
      [extras.name, 'AI answering'],
      [callers.name, '2 to 5'],
      [direction.name, 'Both'],
      [numbers.name, 'A number for each person'],
      [volume.name, '  about   300 '],
      [extras.name, 'Call recording'],
    ]);
    expect(dialerNeeds(answers)).toBe(
      'People on calls: 2 to 5; Phone numbers: A number for each person; Calls: Both; Calls a week: about 300; Also interested in: Call recording, AI answering',
    );
  });

  it('are all optional: nothing answered is nothing kept', () => {
    expect(dialerNeeds(form([]))).toBe('');
    expect(dialerNeeds(form([[volume.name, '   ']]))).toBe('');
  });

  it('keep only the listed options, and bound the one free answer', () => {
    const answers = form([
      [callers.name, 'Ten thousand'],
      [extras.name, 'Free international calls'],
      [volume.name, 'x'.repeat(500)],
    ]);
    expect(dialerNeeds(answers)).toBe(`Calls a week: ${'x'.repeat(volume.maxLength)}`);
  });

  it('are asked only for the Dialer', () => {
    const answers = form([[callers.name, 'Just me']]);
    expect(topicNeeds(inquiryTopic('dialer'), answers)).toBe('People on calls: Just me');
    expect(topicNeeds(inquiryTopic('sales'), answers)).toBe('');
    expect(topicNeeds(null, answers)).toBe('');
  });
});
