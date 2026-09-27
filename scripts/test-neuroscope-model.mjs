/**
 * One-off smoke test for the NeuroScope DistilBERT dual-head ONNX.
 * Confirms the exact input/output tensor names + shapes for both heads and
 * prints a sample prediction. Run:
 *   node scripts/test-neuroscope-model.mjs <dirContaining neuroscope-distilbert/>
 */
const modelDir = process.argv[2] || 'C:/lasttesting/neuroscope-fixed/scripts/.ns-test';
const MODEL_ID = 'neuroscope-distilbert';

const { AutoTokenizer, AutoModel, env } = await import('@huggingface/transformers');
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = modelDir.endsWith('/') || modelDir.endsWith('\\') ? modelDir : modelDir + '/';

console.log(`Loading tokenizer "${MODEL_ID}" from ${env.localModelPath}`);
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const inputs = tokenizer('I have been feeling hopeless lately and cannot sleep', {
  padding: true,
  truncation: true,
  max_length: 512,
});
console.log('Tokenizer keys:', Object.keys(inputs));

console.log('Loading model (q8)...');
const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8' });

const { input_ids, attention_mask } = inputs;
const output = await model({ input_ids, attention_mask });

for (const [name, tensor] of Object.entries(output)) {
  console.log(`output ${name}: dims=[${tensor.dims?.join(', ')}]`);
}

const statusTensor = output.status_logits ?? output.logits;
if (statusTensor) {
  const data = statusTensor.data ?? (statusTensor.tolist?.()[0] ?? []);
  let best = -Infinity;
  let idx = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > best) { best = data[i]; idx = i; }
  }
  console.log(`status_logits argmax: ${idx} (logit ${best.toFixed(3)}) — expect one of 0..6`);
} else {
  console.log('NO status_logits/logits OUTPUT FOUND:', Object.keys(output));
}

const risk = output.risk_logits;
if (risk) {
  const len = risk.dims[risk.dims.length - 1];
  const data = risk.data ?? (risk.tolist?.()[0] ?? []);
  if (len === 1) {
    console.log(`=> risk head is SINGLE logit: sigmoid(${data[0]?.toFixed(3)}) = ${(1 / (1 + Math.exp(-data[0]))).toFixed(4)}`);
  } else {
    console.log(`=> risk head is TWO logits: [${Array.from(data).map((v) => Number(v).toFixed(3)).join(', ')}] (softmax -> [no, yes])`);
  }
} else {
  console.log('NO risk_logits OUTPUT FOUND:', Object.keys(output));
}
