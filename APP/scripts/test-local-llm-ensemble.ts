/**
 * Run: npx tsx scripts/test-local-llm-ensemble.ts
 * Proves the offline Phi-3 mini reader obeys the same rules as NeuroScope + RoBERTa.
 */
import assert from 'node:assert/strict';
import {
  GROQ_VOTE_PROFILE,
  LOCAL_LLM_VOTE_PROFILE,
  ensembleThreeWaySentiment,
  ensembleTransformerSentiment,
} from '../src/utils/semanticEngine.ts';
import type { NeuroScopeReading, SentimentResult } from '../src/types.ts';

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('  ok  ' + name);
};

const ns = (o: Partial<NeuroScopeReading>): NeuroScopeReading => ({
  topStatus: 'Normal',
  pTop: 0.8,
  top3: [],
  pRisk: 0.05,
  riskFlag: false,
  band: 'low',
  summary: '',
  source: 'neuroscope-distilbert',
  ...o,
});
const rb = (score: number, label: SentimentResult['label'], magnitude = 0.6): SentimentResult => ({ score, label, magnitude, source: 'transformer' });
const phi = (score: number, label: SentimentResult['label'], magnitude = 0.8): SentimentResult => ({ score, label, magnitude, source: 'local-llm' });

t('safety bypass: critical band ignores Phi completely', () => {
  const reading = ns({ topStatus: 'Suicidal', band: 'critical', pRisk: 0.95, riskFlag: true });
  const base = ensembleThreeWaySentiment(reading, rb(-0.6, 'severe'), null, LOCAL_LLM_VOTE_PROFILE);
  const withCalmPhi = ensembleThreeWaySentiment(reading, rb(-0.6, 'severe'), phi(0.9, 'calm'), LOCAL_LLM_VOTE_PROFILE);
  assert.equal(withCalmPhi.label, 'severe');
  assert.equal(withCalmPhi.score, base.score);
});

t('sticky severity: a calm Phi cannot talk a high-band read down', () => {
  const reading = ns({ topStatus: 'Depression', band: 'high', pRisk: 0.7, riskFlag: true, pTop: 0.7 });
  const out = ensembleThreeWaySentiment(reading, rb(-0.7, 'severe'), phi(0.8, 'calm'), LOCAL_LLM_VOTE_PROFILE);
  assert.equal(out.label, 'severe');
});

t('sticky severity: a raw riskFlag alone keeps the label severe', () => {
  const reading = ns({ topStatus: 'Anxiety', band: 'elevated', pRisk: 0.3, riskFlag: true });
  const out = ensembleThreeWaySentiment(reading, rb(0.1, 'neutral'), phi(0.6, 'calm'), LOCAL_LLM_VOTE_PROFILE);
  assert.equal(out.label, 'severe');
});

t('Phi can escalate: a severe Phi read makes a calm-looking result severe', () => {
  const out = ensembleThreeWaySentiment(ns({}), rb(0.5, 'calm'), phi(-0.85, 'severe'), LOCAL_LLM_VOTE_PROFILE);
  assert.equal(out.label, 'severe');
});

t('minority weight: the fused score stays closer to the transformers than to Phi', () => {
  const reading = ns({ topStatus: 'Stress', band: 'elevated', pRisk: 0.15, pTop: 0.6 });
  const roberta = rb(-0.4, 'distressed');
  const twoWay = ensembleTransformerSentiment(reading, roberta);
  const p = phi(0.7, 'calm');
  const out = ensembleThreeWaySentiment(reading, roberta, p, LOCAL_LLM_VOTE_PROFILE);
  assert.ok(Math.abs(out.score - twoWay.score) < Math.abs(out.score - p.score), `${out.score} vs ${twoWay.score} / ${p.score}`);
});

t('same input: Phi pulls less than Groq would', () => {
  const reading = ns({ topStatus: 'Stress', band: 'elevated', pRisk: 0.15, pTop: 0.6 });
  const roberta = rb(-0.4, 'distressed');
  const p = phi(0.7, 'calm');
  const asPhi = ensembleThreeWaySentiment(reading, roberta, p, LOCAL_LLM_VOTE_PROFILE);
  const asGroq = ensembleThreeWaySentiment(reading, roberta, { ...p, source: 'groq' }, GROQ_VOTE_PROFILE);
  assert.ok(asPhi.score < asGroq.score);
});

t('no LLM reading -> identical to the two-transformer ensemble', () => {
  const reading = ns({ topStatus: 'Stress', band: 'elevated', pRisk: 0.15 });
  const two = ensembleTransformerSentiment(reading, rb(-0.3, 'distressed'));
  const out = ensembleThreeWaySentiment(reading, rb(-0.3, 'distressed'), null, LOCAL_LLM_VOTE_PROFILE);
  assert.equal(out.score, two.score);
  assert.equal(out.label, two.label);
});

t('Groq behaviour is unchanged by the refactor (default profile)', () => {
  const reading = ns({ topStatus: 'Depression', band: 'elevated', pRisk: 0.3, pTop: 0.55 });
  const roberta = rb(-0.35, 'distressed');
  const groq: SentimentResult = { score: -0.2, label: 'distressed', magnitude: 0.5, source: 'groq' };
  const two = ensembleTransformerSentiment(reading, roberta);
  const conf = two.confidence ?? 0.5;
  const w = Math.max(0.55, Math.min(0.8, 0.8 - 0.25 * conf)); // the ORIGINAL formula
  const expected = Number(Math.max(-1, Math.min(1, (1 - w) * two.score + w * groq.score)).toFixed(3));
  assert.equal(ensembleThreeWaySentiment(reading, roberta, groq).score, expected);
});

console.log(`\n${n} groups passed`);
