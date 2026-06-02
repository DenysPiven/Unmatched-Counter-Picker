const EXCLUDED_KEY = "unmatched-excluded-v3";

/** Default excluded fighters — change on Excluded tab. */
export const DEFAULT_EXCLUDED = [
  "sherlock-holmes",
  "elektra",
  "doctor-strange",
  "deadpool",
  "buffy",
  "angel",
  "spike",
  "willow",
];

let excluded = new Set();

export function loadExcluded() {
  try {
    const raw = localStorage.getItem(EXCLUDED_KEY);
    if (raw) {
      excluded = new Set(JSON.parse(raw));
      return;
    }
  } catch {
    /* ignore */
  }
  excluded = new Set(DEFAULT_EXCLUDED);
  saveExcluded();
}

export function saveExcluded() {
  localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...excluded]));
}

export function isExcluded(slug) {
  return excluded.has(slug);
}

export function getExcluded() {
  return new Set(excluded);
}

export function setExcluded(slug, value) {
  if (value) excluded.add(slug);
  else excluded.delete(slug);
  saveExcluded();
}

export function resetExcludedToDefault() {
  excluded = new Set(DEFAULT_EXCLUDED);
  saveExcluded();
}

export function clearExcluded() {
  excluded = new Set();
  saveExcluded();
}
