# NeuroScope DistilBERT (dual head)

Fine-tuned `distilbert-base-uncased` on the NeuroScope Cleaned Mental Health Dataset
(51,067 statements). Predicts **status** across 7 dimensions
(Normal, Depression, Suicidal, Anxiety, Bipolar, Stress, Personality Disorder) and a binary **risk_flag** from one shared encoder.

## Intended use
Screening/triage assist inside the NeuroScope assessment app, feeding the dynamic risk engine
(low/elevated/high/critical). NOT a diagnostic or crisis tool on its own.

## Test metrics (held-out 15%)
- status macro-F1: 0.792 | weighted-F1: 0.818
- risk recall: 0.916 at threshold 0.22 | AUC: 0.967

## Ethical notes (TIP 57, trauma-informed care)
- Optimized for recall over precision on the risk head; false negatives are costlier than false alarms.
- Class-weighted training compensates for rare dimensions (e.g., Personality Disorder).
- Predictions must route to human-supported resources, never to automated judgment.

## Files
- `pytorch_model_dual_head.bin` — PyTorch weights (encoder + both heads)
- `onnx/model_quantized.onnx` — INT8, Transformers.js-ready (outputs: status_logits, risk_logits)
- `status_labels.json`, `risk_config.json`, `metrics.json`
