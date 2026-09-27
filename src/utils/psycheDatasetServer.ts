import fs from 'fs';
import path from 'path';

export interface PsycheDatasetRow {
  id: string;
  text: string;
  primary_emotion: string;
  secondary_emotion: string;
  ekman7: string;
  domain: string;
  screening_category: string;
  cognitive_distortion: string;
  somatic_tags: string;
  risk_level: string;
  primary_need: string;
  response_strategy: string;
  technique: string;
  tool: string;
  reflection: string;
  sample_reply: string;
}

export interface PsycheExample {
  id: string;
  text: string;
  primaryEmotion: string;
  secondaryEmotion: string;
  emotion: string;
  domain: string;
  screeningCategory: string;
  cognitiveDistortion: string;
  somaticTags: string;
  riskLevel: string;
  primaryNeed: string;
  responseStrategy: string;
  technique: string;
  tool: string;
  reflection: string;
  sampleReply: string;
  searchText: string;
  retrievalScore?: number;
}

let rows: PsycheDatasetRow[] | null = null;
let loadError: string | null = null;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

function parseCsv(csv: string): PsycheDatasetRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = parseCsvLine(lines.shift() || '');
  const index = new Map(header.map((name, i) => [name.trim(), i]));
  const get = (cells: string[], key: string) => cells[index.get(key) ?? -1] ?? '';
  const out: PsycheDatasetRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const text = get(cells, 'text').trim();
    if (!text) continue;
    out.push({
      id: get(cells, 'id').trim(),
      text,
      primary_emotion: get(cells, 'primary_emotion').trim(),
      secondary_emotion: get(cells, 'secondary_emotion').trim(),
      ekman7: get(cells, 'ekman7').trim(),
      domain: get(cells, 'domain').trim(),
      screening_category: get(cells, 'screening_category').trim(),
      cognitive_distortion: get(cells, 'cognitive_distortion').trim(),
      somatic_tags: get(cells, 'somatic_tags').trim(),
      risk_level: get(cells, 'risk_level').trim(),
      primary_need: get(cells, 'primary_need').trim(),
      response_strategy: get(cells, 'response_strategy').trim(),
      technique: get(cells, 'technique').trim(),
      tool: get(cells, 'tool').trim(),
      reflection: get(cells, 'reflection').trim(),
      sample_reply: get(cells, 'sample_reply').trim(),
    });
  }
  return out;
}

function datasetPath(): string {
  return path.join(process.cwd(), 'data', 'neuroscope_psyche_dataset.csv');
}

export function getPsycheDataset(): PsycheDatasetRow[] {
  if (rows) return rows;
  if (loadError) return [];
  try {
    rows = parseCsv(fs.readFileSync(datasetPath(), 'utf8'));
    console.info(`Loaded NeuroScope psyche dataset: ${rows.length} examples`);
    return rows;
  } catch (error: any) {
    loadError = error?.message || String(error);
    console.warn('Psyche dataset unavailable; continuing without dataset retrieval:', loadError);
    return [];
  }
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','is','are','was','were','be','been','to','of','in','on','for','with','my','me','i','it','that','this','have','has','had','do','does','did','not','as','at','by','from','so','if','than','then','about','over','feel','feeling','feels','just','really','very','like','you','your','we','they','them','our','their','what','when','how','why','can','could','would','should','am','im','ive','its','there','here','too','more','some','into','up','down','out','been'
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) || []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function overlap(query: Set<string>, text: string): number {
  const tokens = new Set(tokenize(text));
  if (!query.size || !tokens.size) return 0;
  let hits = 0;
  for (const token of query) {
    if (tokens.has(token)) hits++;
  }
  return hits / Math.max(4, Math.sqrt(query.size * tokens.size));
}

function toExample(row: PsycheDatasetRow, score: number): PsycheExample {
  const emotion = row.primary_emotion || row.ekman7 || '';
  return {
    id: row.id,
    text: row.text.slice(0, 900),
    primaryEmotion: row.primary_emotion,
    secondaryEmotion: row.secondary_emotion,
    emotion,
    domain: row.domain,
    screeningCategory: row.screening_category,
    cognitiveDistortion: row.cognitive_distortion,
    somaticTags: row.somatic_tags,
    riskLevel: row.risk_level,
    primaryNeed: row.primary_need,
    responseStrategy: row.response_strategy,
    technique: row.technique,
    tool: row.tool,
    reflection: row.reflection.slice(0, 500),
    sampleReply: row.sample_reply.slice(0, 900),
    searchText: [
      row.text,
      row.primary_emotion,
      row.secondary_emotion,
      row.ekman7,
      row.domain,
      row.screening_category,
      row.cognitive_distortion,
      row.somatic_tags,
      row.risk_level,
      row.primary_need,
      row.response_strategy,
      row.technique,
    ].filter(Boolean).join(' '),
    retrievalScore: Number(score.toFixed(4)),
  };
}

/**
 * Fast candidate generation only. The browser then applies MiniLM semantic
 * vector search to this small candidate set, so the CSV never needs to be
 * embedded in the browser all at once.
 */
export function retrievePsycheCandidates(options: {
  query: string;
  category?: string;
  riskLevel?: string;
  emotion?: string;
  limit?: number;
}): PsycheExample[] {
  const dataset = getPsycheDataset();
  if (!dataset.length) return [];
  const query = new Set(tokenize(options.query || ''));
  const category = (options.category || '').toLowerCase();
  const risk = (options.riskLevel || '').toLowerCase();
  const emotion = (options.emotion || '').toLowerCase();

  const scored = dataset.map((row) => {
    let score = overlap(query, row.text);
    score += 0.10 * overlap(query, `${row.domain} ${row.primary_need} ${row.technique} ${row.response_strategy}`);
    if (category && row.screening_category.toLowerCase().includes(category)) score += 0.16;
    if (category && row.domain.toLowerCase().includes(category)) score += 0.08;
    if (risk && row.risk_level.toLowerCase() === risk) score += 0.10;
    if (emotion && `${row.primary_emotion} ${row.secondary_emotion} ${row.ekman7}`.toLowerCase().includes(emotion)) score += 0.12;
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const limit = Math.max(1, Math.min(options.limit ?? 36, 60));
  return scored.slice(0, limit).map(({ row, score }) => toExample(row, score));
}
