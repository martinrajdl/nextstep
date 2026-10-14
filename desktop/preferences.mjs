import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { resolve } from 'node:path';

export const APPEARANCES = [
  { name: 'Neutral', color: '#777777' },
  { name: 'Green', color: '#839d4d' },
  { name: 'Blue', color: '#4473cf' },
  { name: 'Violet', color: '#8b68ba' },
  { name: 'Rose', color: '#ba657f' },
  { name: 'Slate', color: '#657486' },
];
export const THEMES = ['light', 'dark', 'system'];
export function themePreference(value) {
  if (!THEMES.includes(value)) throw new Error('Choose Light, Dark or System appearance.');
  return value;
}
export function accentColor(value) {
  if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value))
    throw new Error('Choose a six-digit accent color.');
  return value.toLowerCase();
}
export function readPreferences(directory) {
  const path = resolve(directory, 'settings.json');
  if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Your saved desktop settings are invalid.');
  return value;
}
export function writePreferences(directory, patch) {
  const value = { ...readPreferences(directory), ...patch };
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, 'settings.json');
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(path + '.tmp', path);
  return value;
}
