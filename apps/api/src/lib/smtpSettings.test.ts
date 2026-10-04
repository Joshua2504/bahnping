import { describe, expect, it } from 'vitest';
import { transportOptionsForSecurity } from './smtpSettings.js';

describe('transportOptionsForSecurity', () => {
  it('"tls" -> secure: true', () => {
    expect(transportOptionsForSecurity('tls', true)).toEqual({ secure: true, tls: { rejectUnauthorized: true } });
  });

  it('"starttls" -> secure: false, requireTLS: true', () => {
    expect(transportOptionsForSecurity('starttls', true)).toEqual({
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true },
    });
  });

  it('"none" -> secure: false, ignoreTLS: true', () => {
    expect(transportOptionsForSecurity('none', true)).toEqual({
      secure: false,
      ignoreTLS: true,
      tls: { rejectUnauthorized: true },
    });
  });

  it('reicht rejectUnauthorized durch', () => {
    expect(transportOptionsForSecurity('tls', false)).toEqual({ secure: true, tls: { rejectUnauthorized: false } });
  });
});
