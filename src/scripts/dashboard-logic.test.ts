import { describe, it, expect } from 'vitest';
import {
  buildProviderLine,
  describeDevice,
  evaluateRules,
  fmtDate,
  meetsAllRules,
  providerLabel,
} from './dashboard-logic';

describe('providerLabel', () => {
  it('maps known providers', () => {
    expect(providerLabel('google')).toBe('Google');
    expect(providerLabel('github')).toBe('GitHub');
    expect(providerLabel('email')).toBe('Email');
  });
  it('capitalises unknown providers', () => {
    expect(providerLabel('twitter')).toBe('Twitter');
  });
  it('passes an empty string through unchanged', () => {
    expect(providerLabel('')).toBe('');
  });
});

describe('buildProviderLine', () => {
  it('email/password user lists Password as the sole method', () => {
    expect(buildProviderLine({ provider: 'email', providers: ['email'], hasPassword: true }))
      .toBe('Email (Password)');
  });
  it('with no methods at all, shows just the provider (no empty parens)', () => {
    expect(buildProviderLine({ provider: 'email', providers: ['email'], hasPassword: false }))
      .toBe('Email');
  });
  it('google-only OAuth user without a password', () => {
    expect(buildProviderLine({ provider: 'google', providers: ['google'], hasPassword: false }))
      .toBe('Google (Google)');
  });
  it('google OAuth user who has set a password', () => {
    expect(buildProviderLine({ provider: 'google', providers: ['google'], hasPassword: true }))
      .toBe('Google (Google · Password)');
  });
  it('first provider, then multiple OAuth methods and password', () => {
    expect(buildProviderLine({
      provider: 'github',
      providers: ['github', 'google'],
      hasPassword: true,
    })).toBe('GitHub (GitHub · Google · Password)');
  });
  it('drops the implicit "email" entry from the methods list (Password already conveys it)', () => {
    expect(buildProviderLine({
      provider: 'google',
      providers: ['google', 'email'],
      hasPassword: true,
    })).toBe('Google (Google · Password)');
  });
});

describe('password rules', () => {
  it('evaluateRules reports each rule independently', () => {
    expect(evaluateRules('abc')).toEqual({
      length: false, upper: false, lower: true, number: false, symbol: false,
    });
    expect(evaluateRules('Abcdefg1!')).toEqual({
      length: true, upper: true, lower: true, number: true, symbol: true,
    });
  });
  it('meetsAllRules requires every rule to pass', () => {
    expect(meetsAllRules('Abcdef1!')).toBe(true);
    expect(meetsAllRules('Abcdef1')).toBe(false);  // no symbol
    expect(meetsAllRules('abcdef1!')).toBe(false);  // no uppercase
    expect(meetsAllRules('ABCDEF1!')).toBe(false);  // no lowercase
    expect(meetsAllRules('Abcdefg!')).toBe(false);  // no number
    expect(meetsAllRules('Ab1!')).toBe(false);      // too short
  });
});

describe('fmtDate', () => {
  it('formats an ISO timestamp as "D Mon YYYY"', () => {
    // Mid-month + regex on the day keeps this timezone-robust.
    expect(fmtDate('2026-06-15T09:30:00.000Z')).toMatch(/^\d{1,2} Jun 2026$/);
  });
});

describe('describeDevice', () => {
  it('prefers userAgentData, stripping noise brands and the "Google " prefix', () => {
    expect(describeDevice('irrelevant-ua', {
      platform: 'macOS',
      brands: [
        { brand: 'Not.A/Brand', version: '99' },
        { brand: 'Chromium', version: '142' },
        { brand: 'Google Chrome', version: '142' },
      ],
    })).toBe('macOS · Chrome 142');
  });
  it('parses Safari on macOS from the userAgent string', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(describeDevice(ua)).toBe('macOS · Safari 17');
  });
  it('detects iOS before macOS (iPhone UA also mentions Mac OS X)', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    // The version regex needs "Version/.. Safari" adjacent; iOS puts "Mobile/.."
    // between them, so it gracefully degrades to a version-less "Safari".
    expect(describeDevice(ua)).toBe('iOS · Safari');
  });
  it('parses Chrome on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
    expect(describeDevice(ua)).toBe('Windows · Chrome 142');
  });
  it('parses Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
    expect(describeDevice(ua)).toBe('Linux · Firefox 130');
  });
  it('falls back for an unrecognised UA', () => {
    expect(describeDevice('something weird')).toBe('Unknown device');
  });
});
