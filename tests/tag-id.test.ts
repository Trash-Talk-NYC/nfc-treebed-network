import { describe, expect, it } from 'vitest';
import { TAG_ID_ALPHABET, isCanonicalTagId, normalizeTagId } from '../src/lib/tag-id';

describe('the tag ID alphabet', () => {
  it('is Crockford base32: 32 characters, no i, l, o, u', () => {
    expect(TAG_ID_ALPHABET).toHaveLength(32);
    for (const banned of ['i', 'l', 'o', 'u']) {
      expect(TAG_ID_ALPHABET).not.toContain(banned);
    }
    expect(new Set(TAG_ID_ALPHABET).size).toBe(32);
  });
});

describe('normalizing a typed tag ID', () => {
  it('accepts a canonical ID unchanged', () => {
    expect(normalizeTagId('2mq2amhv')).toBe('2mq2amhv');
  });

  it('is case-insensitive — a sign has no case', () => {
    expect(normalizeTagId('2MQ2AMHV')).toBe('2mq2amhv');
    expect(normalizeTagId('2Mq2AmHv')).toBe('2mq2amhv');
  });

  it('strips the hyphens and spaces people add for legibility', () => {
    expect(normalizeTagId('2mq2-amhv')).toBe('2mq2amhv');
    expect(normalizeTagId('2mq2 amhv')).toBe('2mq2amhv');
    expect(normalizeTagId(' 2m-q2-am-hv ')).toBe('2mq2amhv');
  });

  it('decodes the sign-typing lookalikes: i and l read as 1, o reads as 0', () => {
    expect(normalizeTagId('1i0ol1l1')).toBe('11001111');
    expect(normalizeTagId('IlOoLLii')).toBe('11001111');
  });

  it('rejects u — excluded from the alphabet with nothing it could be mistaken for', () => {
    expect(normalizeTagId('u2q2amhv')).toBeNull();
    expect(normalizeTagId('U2Q2AMHV')).toBeNull();
  });

  it('rejects the wrong length, before and after stripping', () => {
    expect(normalizeTagId('')).toBeNull();
    expect(normalizeTagId('2mq2amh')).toBeNull();
    expect(normalizeTagId('2mq2amhv7')).toBeNull();
    // Stripping must not rescue a short ID into the right length.
    expect(normalizeTagId('2mq2-amh')).toBeNull();
  });

  it('rejects characters outside the alphabet', () => {
    expect(normalizeTagId('2mq2amh!')).toBeNull();
    expect(normalizeTagId('2mq2amh_')).toBeNull();
    // The old plate format must be an invalid tag, not a near-miss.
    expect(normalizeTagId('BED-HRL-0847')).toBeNull();
  });
});

describe('canonical form', () => {
  it('is what normalization returns', () => {
    expect(isCanonicalTagId('2mq2amhv')).toBe(true);
  });

  it('excludes anything normalization would rewrite', () => {
    expect(isCanonicalTagId('2MQ2AMHV')).toBe(false);
    expect(isCanonicalTagId('2mq2-amhv')).toBe(false);
    expect(isCanonicalTagId('imq2amhv')).toBe(false);
  });
});
