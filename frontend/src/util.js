export const TYPE_LABELS = { youtube: 'סרטון', text: 'טקסט' };

// Score bands follow the model's training labels:
// 0.05 not in frame, 0.30 not attentive, 0.50 weakly attentive, 0.70 attentive, 0.95 very attentive.
export const LEVELS = [
  { max: 0.175, label: 'לא נמצא מול המצלמה', color: '#8a8f98' },
  { max: 0.4, label: 'לא קשוב', color: '#c2410c' },
  { max: 0.6, label: 'קשב חלש', color: '#b7791f' },
  { max: 0.825, label: 'קשוב', color: '#2f855a' },
  { max: 1.01, label: 'קשוב מאוד', color: '#1d6b52' },
];

export const LOW_FOCUS_THRESHOLD = 0.4;

export function levelFor(score) {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  return LEVELS.find((l) => score < l.max) || LEVELS[LEVELS.length - 1];
}

export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export function formatScore(score) {
  return score === null || score === undefined ? '—' : Number(score).toFixed(2);
}

export function formatPosition(position, type) {
  if (type === 'text') return `${Math.round(position * 100)}% מהטקסט`;
  const s = Math.floor(position);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function durationText(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const sec = Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 1000));
  const m = Math.floor(sec / 60);
  return m ? `${m} דק' ${sec % 60} שנ'` : `${sec} שניות`;
}
