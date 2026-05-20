import { describe, it, expect } from 'vitest';
import { extractCandidateFromQuestion } from '../market-metadata';

describe('extractCandidateFromQuestion', () => {
  it('extracts a candidate from a "Will X win ..." Brazilian presidential question', () => {
    expect(
      extractCandidateFromQuestion(
        'Will Tarcisio de Freitas win the 2026 Brazilian presidential election?',
      ),
    ).toBe('Tarcisio de Freitas');
  });

  it('extracts a candidate from a Colombian presidential question without trailing punctuation', () => {
    expect(
      extractCandidateFromQuestion('Will Vicky Dávila win the 2026 Colombian presidential election'),
    ).toBe('Vicky Dávila');
  });

  it('extracts a candidate from a "finish in X place" prediction', () => {
    expect(
      extractCandidateFromQuestion(
        'Will Renan Santos finish in second place in the first round of the 2026 Brazilian presidential election?',
      ),
    ).toBe('Renan Santos');
  });

  it('returns null for non-political "will X be" market with macro subject', () => {
    expect(
      extractCandidateFromQuestion(
        "Will Brazil's Annual Inflation in 2026 be less than 5%?",
      ),
    ).toBeNull();
  });

  it('returns null when the subject is a topic phrase (election/justice keywords)', () => {
    expect(
      extractCandidateFromQuestion(
        'Any Brazil STF Justice removed by impeachment before 2027',
      ),
    ).toBeNull();
  });

  it('returns null when the verb is unsupported (passes through safely)', () => {
    expect(
      extractCandidateFromQuestion('Will the moon explode tomorrow?'),
    ).toBeNull();
  });

  it('returns null for null / empty / undefined input', () => {
    expect(extractCandidateFromQuestion(null)).toBeNull();
    expect(extractCandidateFromQuestion(undefined)).toBeNull();
    expect(extractCandidateFromQuestion('')).toBeNull();
  });
});
