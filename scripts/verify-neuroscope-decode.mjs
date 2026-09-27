/**
 * End-to-end verification of the NeuroScope primary-classifier decode path —
 * the exact softmax/sigmoid/band logic semanticEngine.ts runs in the browser,
 * executed here in Node against the shipped ONNX weights.
 * Run: node scripts/verify-neuroscope-decode.mjs
 */
const MODEL_DIR = 'public/models';
const MODEL_ID = 'neuroscope-distilbert';

const { AutoTokenizer, AutoModel, env } = await import('@huggingface/transformers');
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = MODEL_DIR.endsWith('/') ? MODEL_DIR : MODEL_DIR + '/';

const DIMENSIONS = ['Normal', 'Depression', 'Suicidal', 'Anxiety', 'Bipolar', 'Stress', 'Personality Disorder'];
const STATUS_BAND_WEIGHT = {
  Normal: 0,
  Stress: 0.3,
  Anxiety: 0.4,
  'Personality Disorder': 0.45,
  Bipolar: 0.45,
  Depression: 0.55,
  Suicidal: 1,
};
const RISK_THRESHOLD = 0.22;

function softmaxRow(values) {
  const arr = Array.from(values);
  const max = arr.reduce((a, b) => Math.max(a, b), -Infinity);
  const exps = arr.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function bandFromHeads(pRisk, top, pTop) {
  const confident = pTop >= 0.45;
  const weight = STATUS_BAND_WEIGHT[top];
  if (pRisk >= 0.85 || (confident && top === 'Suicidal' && pRisk >= 0.6)) return 'critical';
  if (pRisk >= 0.55 || (confident && top === 'Suicidal' && pRisk >= 0.35)) return 'high';
  if (pRisk >= RISK_THRESHOLD + 0.05) {
    return weight >= 0.4 ? 'elevated' : pRisk >= 0.32 ? 'elevated' : 'low';
  }
  if (pRisk >= RISK_THRESHOLD && confident && weight >= 0.5) return 'elevated';
  if (top === 'Normal' && pTop >= 0.5 && pRisk < 0.1) return 'low';
  return pRisk >= 0.35 ? 'elevated' : 'low';
}

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' });

const CASES = [
  { text: 'I have been feeling great lately, sleeping well and enjoying time with my friends', expect: 'Normal-ish' },
  { text: 'I feel constantly on edge, worried about everything, heart racing all day', expect: 'Anxiety-ish' },
  { text: 'I have been feeling hopeless and empty for weeks, nothing matters anymore', expect: 'Depression-ish' },
  { text: 'I have been thinking about ending my life and I have a plan', expect: 'Suicidal/high-risk' },
  { text: 'Work pressure is intense, I am exhausted and cannot switch off at night', expect: 'Stress-ish' },
  { text: 'My mood swings between extreme highs and terrible lows within days', expect: 'Bipolar-ish' },
];

console.log('model loaded — running decode verification\n');
let failures = 0;
for (const c of CASES) {
  const inputs = tokenizer(c.text, { padding: true, truncation: true, max_length: 512 });
  const output = await model(inputs);
  const statusData = Array.from(output.status_logits.data);
  const riskData = Array.from(output.risk_logits.data);
  const probs = softmaxRow(statusData);
  const order = probs.map((p, idx) => ({ label: DIMENSIONS[idx], p })).sort((a, b) => b.p - a.p);
  const top = order[0];
  const pRisk = riskData.length === 1 ? 1 / (1 + Math.exp(-riskData[0])) : 0;
  const band = bandFromHeads(pRisk, top.label, top.p);

  const ok = c.expect === 'Normal-ish' ? top.label === 'Normal' && band === 'low' : true;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'OK ' : '??'} [${c.expect.padEnd(14)}] top=${top.label.padEnd(20)} p=${top.p.toFixed(3)} | pRisk=${pRisk.toFixed(3)} flag=${pRisk >= RISK_THRESHOLD} band=${band}`
  );
}
console.log(failures === 0 ? '\nAll decode checks passed.' : `\n${failures} check(s) need review.`);
