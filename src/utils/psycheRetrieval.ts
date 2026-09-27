import type { PsycheExample, RiskAssessment, SemanticAnalysis, SentimentResult } from '../types';
import { rankBySemanticSimilarity } from './semanticEngine';

export interface PsycheRetrievalOptions {
  query: string;
  category?: string;
  tone?: SentimentResult | null;
  semantics?: SemanticAnalysis | null;
  risk?: RiskAssessment | null;
  limit?: number;
  timeoutMs?: number;
}

function normalizeExample(raw: any): PsycheExample | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.text !== 'string') return null;
  return {
    id: raw.id.slice(0, 80),
    text: raw.text.slice(0, 900),
    primaryEmotion: String(raw.primaryEmotion || '').slice(0, 80),
    secondaryEmotion: String(raw.secondaryEmotion || '').slice(0, 80),
    emotion: String(raw.emotion || '').slice(0, 80),
    domain: String(raw.domain || '').slice(0, 120),
    screeningCategory: String(raw.screeningCategory || '').slice(0, 160),
    cognitiveDistortion: String(raw.cognitiveDistortion || '').slice(0, 120),
    somaticTags: String(raw.somaticTags || '').slice(0, 160),
    riskLevel: String(raw.riskLevel || '').slice(0, 40),
    primaryNeed: String(raw.primaryNeed || '').slice(0, 160),
    responseStrategy: String(raw.responseStrategy || '').slice(0, 240),
    technique: String(raw.technique || '').slice(0, 180),
    tool: String(raw.tool || '').slice(0, 100),
    reflection: String(raw.reflection || '').slice(0, 500),
    sampleReply: String(raw.sampleReply || '').slice(0, 900),
    searchText: String(raw.searchText || raw.text).slice(0, 1800),
    retrievalScore: typeof raw.retrievalScore === 'number' ? raw.retrievalScore : undefined,
  };
}

/**
 * Two-stage retrieval: the server cheaply narrows the 10k-row CSV, then the
 * existing MiniLM embedding model performs semantic vector search over those
 * candidates. If the browser transformer is unavailable, the server's ranked
 * candidates are still useful, so this never blocks the assessment.
 */
export async function retrievePsycheExamples(options: PsycheRetrievalOptions): Promise<PsycheExample[]> {
  const query = (options.query || '').trim();
  if (!query) return [];
  const params = new URLSearchParams();
  params.set('query', query.slice(0, 1800));
  if (options.category) params.set('category', options.category.slice(0, 120));
  if (options.risk?.level) params.set('riskLevel', options.risk.level);
  if (options.semantics?.emotions?.top?.label) params.set('emotion', options.semantics.emotions.top.label);
  params.set('limit', '36');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 2200, 3000));
    const response = await fetch(`/api/psyche-examples?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const body = await response.json();
    const candidates = Array.isArray(body?.examples)
      ? body.examples.map(normalizeExample).filter(Boolean) as PsycheExample[]
      : [];
    if (!candidates.length) return [];

    const semanticScores = await rankBySemanticSimilarity(
      query,
      candidates.map((example) => ({ id: example.id, text: example.searchText })),
      Math.min(options.timeoutMs ?? 2200, 2500)
    );

    if (!semanticScores) {
      return candidates.slice(0, options.limit ?? 5);
    }

    const reranked = candidates
      .map((example) => ({
        example,
        semantic: semanticScores.get(example.id) ?? 0,
        lexical: example.retrievalScore ?? 0,
      }))
      .sort((a, b) => (b.semantic * 0.86 + b.lexical * 0.14) - (a.semantic * 0.86 + a.lexical * 0.14));

    return reranked.slice(0, options.limit ?? 5).map(({ example, semantic }) => ({
      ...example,
      retrievalScore: Number(semantic.toFixed(4)),
    }));
  } catch {
    return [];
  }
}
