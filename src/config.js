// -----------------------------------------------------------------------------
// Integration configuration: one BACnet/IP device (address, port, instance),
// the objects to read, the polling interval, and the writes. DEFAULT_CONFIG
// mirrors the `default` values of the manifest (test/manifest.test.js).
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEFAULT_LANGUAGE, LANGUAGES } from './i18n.js';
import { MAX_INSTANCE } from './objects.js';

/** Polling intervals offered, in seconds. */
export const INTERVALS = ['10', '30', '60', '300'];

export const DEFAULT_CONFIG = {
  language: DEFAULT_LANGUAGE,
  port: 47808,
  interval: '30',
  allow_write: false,
  write_priority: 8,
};

const integer = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') {
    return null; // Number('') is 0, a real instance
  }
  const number = Number(text);
  return Number.isInteger(number) ? number : null;
};

/**
 * Merge the user config with the defaults, with the right types.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    // An emptied field arrives as null or "": keep the default.
    if (value !== null && value !== undefined && value !== '') {
      config[key] = value;
    }
  }
  if (!LANGUAGES.includes(config.language)) {
    config.language = DEFAULT_LANGUAGE;
  }
  config.interval = String(config.interval);
  if (!INTERVALS.includes(config.interval)) {
    config.interval = DEFAULT_CONFIG.interval;
  }
  config.allow_write = config.allow_write === true || config.allow_write === 'true';
  const port = integer(config.port);
  config.port = port !== null && port >= 1 && port <= 65535 ? port : DEFAULT_CONFIG.port;
  const priority = integer(config.write_priority);
  config.write_priority =
    priority !== null && priority >= 1 && priority <= 16 ? priority : DEFAULT_CONFIG.write_priority;
  const instance = integer(config.device_instance);
  config.device_instance =
    instance !== null && instance >= 0 && instance <= MAX_INSTANCE ? instance : null;
  config.badInstance =
    config.device_instance === null && String(raw?.device_instance ?? '').trim() !== '';
  config.address = String(config.address ?? '').trim();
  config.objects = String(config.objects ?? '');
  return config;
}

/**
 * Check the address: an IPv4 address (or a host name), and an optional
 * ":port" that overrides the port field.
 * @returns {{ host: string, port: number } | { error: string }}
 */
export function parseAddress(text, defaultPort = 47808) {
  if (!text) {
    return { error: 'noAddress' };
  }
  const match = text.match(/^([^:\s/]+)(?::(\d{1,5}))?$/);
  if (!match) {
    return { error: 'badAddress' };
  }
  const host = match[1].toLowerCase();
  const port = match[2] ? Number(match[2]) : defaultPort;
  const hostOk = isIP(host) === 4 || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*$/.test(host);
  if (!hostOk || port < 1 || port > 65535) {
    return { error: 'badAddress' };
  }
  return { host, port };
}
