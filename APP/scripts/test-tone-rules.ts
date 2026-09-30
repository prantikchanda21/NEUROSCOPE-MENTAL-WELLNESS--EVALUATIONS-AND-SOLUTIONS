/**
 * Run: npx tsx scripts/test-tone-rules.ts
 * Checks the shared tone rules every LLM reader (Groq, offline Phi-3 mini) must obey.
 */
import assert from 'node:assert/strict';
import { TONE_OUTPUT_SPEC, extractJsonObject, labelFromScore, reconcileToneReading, salvageToneFields } from '../src/utils/toneRules.ts';

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

t('spec keeps the four labels and the "never soften" rule', () => {
  for (const l of ['severe', 'distressed', 'neutral', 'calm']) assert.ok(TONE_OUTPUT_SPEC.includes(l));
  assert.ok(TONE_OUTPUT_SPEC.includes('Never soften a "severe" read'));
});

t('labelFromScore matches the ensemble cut-offs', () => {
  assert.equal(labelFromScore(-0.5), 'severe');
  assert.equal(labelFromScore(-0.49), 'distressed');
  assert.equal(labelFromScore(-0.05), 'neutral');
  assert.equal(labelFromScore(0.06), 'calm');
});

t('extractJsonObject handles fences, prose and braces inside strings', () => {
  assert.deepEqual(extractJsonObject('```json\n{"label":"calm","score":0.4}\n```'), { label: 'calm', score: 0.4 });
  assert.deepEqual(extractJsonObject('Sure! {"label":"neutral","rationale":"a } b"} thanks'), { label: 'neutral', rationale: 'a } b' });
  assert.equal(extractJsonObject('no json here'), null);
  assert.equal(extractJsonObject('{"label": "calm"'), null);
});

t('a reader can never contradict itself into looking calmer', () => {
  // says severe but scores calm -> stays severe, score pulled into the severe band
  const a = reconcileToneReading({ label: 'severe', score: 0.6, magnitude: 0.9 })!;
  assert.equal(a.label, 'severe');
  assert.ok(a.score <= -0.5);
  // says calm but scores severely negative -> label follows the score
  const b = reconcileToneReading({ label: 'calm', score: -0.8, magnitude: 0.7 })!;
  assert.equal(b.label, 'severe');
  // says neutral, scores distressed -> distressed
  assert.equal(reconcileToneReading({ label: 'neutral', score: -0.3, magnitude: 0.4 })!.label, 'distressed');
  // says distressed with a non-negative score -> score moved into the band
  const c = reconcileToneReading({ label: 'distressed', score: 0.2, magnitude: 0.4 })!;
  assert.equal(c.label, 'distressed');
  assert.ok(c.score < -0.05);
});

t('values are clamped to the shared scales', () => {
  const r = reconcileToneReading({ label: 'calm', score: 7, magnitude: -3 })!;
  assert.equal(r.score, 1);
  assert.ok(r.magnitude >= 0 && r.magnitude <= 1);
});

t('label-only and score-only replies are repaired, garbage is rejected', () => {
  assert.equal(reconcileToneReading({ label: 'SEVERE' })!.label, 'severe');
  assert.equal(reconcileToneReading({ score: -0.9 })!.label, 'severe');
  assert.equal(reconcileToneReading({ label: 'happy-ish', score: 'x' }), null);
  assert.equal(reconcileToneReading(null), null);
  assert.equal(reconcileToneReading('severe'), null);
});

t('a truncated reply is salvaged, and still reconciled', () => {
  const cut = '{"label":"severe","score":-0.82,"magnitude":0.9,"topEmotion":"sad';
  assert.equal(extractJsonObject(cut), null);
  const r = reconcileToneReading(salvageToneFields(cut))!;
  assert.equal(r.label, 'severe');
  assert.equal(salvageToneFields('I cannot help with that'), null);
});

console.log(`\n${passed} groups passed`);
