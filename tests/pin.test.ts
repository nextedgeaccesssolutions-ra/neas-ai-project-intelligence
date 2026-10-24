import { describe, expect, it } from 'vitest';
import { checkPin, checkUsername, normaliseUsername } from '../lib/cloud/validate';

describe('PIN rules', () => {
  it('accepts six digits', () => {
    expect(checkPin('482916')).toBeNull();
    expect(checkPin('100200')).toBeNull();
  });
  it('refuses anything that is not exactly six digits', () => {
    expect(checkPin('12345')).not.toBeNull();
    expect(checkPin('1234567')).not.toBeNull();
    expect(checkPin('12a456')).not.toBeNull();
    expect(checkPin('')).not.toBeNull();
  });
  it('refuses one repeated digit and simple runs', () => {
    expect(checkPin('000000')).not.toBeNull();
    expect(checkPin('777777')).not.toBeNull();
    expect(checkPin('123456')).not.toBeNull();
    expect(checkPin('654321')).not.toBeNull();
    expect(checkPin('345678')).not.toBeNull();
  });
});

describe('username rules', () => {
  it('normalises to lower case without surrounding spaces', () => {
    expect(normaliseUsername('  Tech.Bravo ')).toBe('tech.bravo');
  });
  it('accepts 3 to 32 letters, digits, dots and dashes', () => {
    expect(checkUsername('pm.alpha')).toBe(true);
    expect(checkUsername('j-granaderos')).toBe(true);
    expect(checkUsername('ab')).toBe(false);
    expect(checkUsername('x y')).toBe(false);
    expect(checkUsername('.dot-first')).toBe(false);
    expect(checkUsername('a'.repeat(33))).toBe(false);
  });
});
