import { getCurrentUser } from './authStorage';

export interface WellnessProfile {
  age?: number;
  heightCm?: number;
  weightKg?: number;
  sleepHours?: number;
  exerciseFrequency?: 'rarely' | '1-2x' | '3-4x' | '5+x';
  caffeineCups?: number;
  tobacco?: 'never' | 'sometimes' | 'daily' | 'prefer-not-to-say';
  alcohol?: 'never' | 'sometimes' | 'often' | 'prefer-not-to-say';
  medications?: string;
  physicalNotes?: string;
  /** Explicit user choice to let NeuroScope use these details for relevant personalization. */
  useForPersonalization?: boolean;
  updatedAt: string;
}

const STORAGE_PREFIX = 'neuroscope_wellness_profile_v1_';

function key(userId?: string): string {
  const id = userId || getCurrentUser()?.id || 'guest';
  return `${STORAGE_PREFIX}${id}`;
}


export function calculateWellnessBmi(profile?: WellnessProfile | null): number | null {
  const heightM = Number(profile?.heightCm) / 100;
  const weightKg = Number(profile?.weightKg);
  if (!Number.isFinite(heightM) || !Number.isFinite(weightKg) || heightM <= 0 || weightKg <= 0) return null;
  const bmi = weightKg / (heightM * heightM);
  return Number.isFinite(bmi) ? Number(bmi.toFixed(1)) : null;
}

/**
 * Compact, non-diagnostic context for the communication layer. The assessment
 * classifier itself never receives these values, so physical context can inform
 * explanations/recommendations without becoming a mental-health score.
 */
export function buildWellnessProfileContext(profile?: WellnessProfile | null): string {
  if (!profile || profile.useForPersonalization === false) return '';
  const lines: string[] = [];
  if (profile.age !== undefined) lines.push(`Age: ${profile.age} years.`);
  if (profile.heightCm !== undefined && profile.weightKg !== undefined) {
    lines.push(`Height: ${profile.heightCm} cm; weight: ${profile.weightKg} kg; BMI reference: ${calculateWellnessBmi(profile) ?? 'unavailable'}.`);
  } else {
    if (profile.heightCm !== undefined) lines.push(`Height: ${profile.heightCm} cm.`);
    if (profile.weightKg !== undefined) lines.push(`Weight: ${profile.weightKg} kg.`);
  }
  if (profile.sleepHours !== undefined) lines.push(`Average sleep: ${profile.sleepHours} hours/night.`);
  if (profile.exerciseFrequency) lines.push(`Exercise/movement: ${profile.exerciseFrequency}.`);
  if (profile.caffeineCups !== undefined) lines.push(`Caffeine: ${profile.caffeineCups} cups/day.`);
  if (profile.tobacco && profile.tobacco !== 'prefer-not-to-say') lines.push(`Tobacco/nicotine: ${profile.tobacco}.`);
  if (profile.alcohol && profile.alcohol !== 'prefer-not-to-say') lines.push(`Alcohol: ${profile.alcohol}.`);
  if (profile.medications) lines.push(`Medications the user chose to record: ${profile.medications.slice(0, 400)}.`);
  if (profile.physicalNotes) lines.push(`Physical notes the user chose to record: ${profile.physicalNotes.slice(0, 600)}.`);
  if (!lines.length) return '';
  return [
    'USER-PROVIDED WELLNESS CONTEXT (use only when relevant to the current conversation):',
    ...lines.map((line) => `- ${line}`),
    'PERSONALIZATION RULE: Use this context to tailor lifestyle suggestions and plain-language explanations. Do not diagnose from height, weight, BMI, medication names, or lifestyle alone, and do not use these values to alter the mental-health screening score.',
  ].join('\n');
}

export function getWellnessProfile(userId?: string): WellnessProfile | null {
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as WellnessProfile) : null;
  } catch {
    return null;
  }
}

export function saveWellnessProfile(profile: Omit<WellnessProfile, 'updatedAt'>, userId?: string): WellnessProfile {
  const saved: WellnessProfile = { useForPersonalization: true, ...profile, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(key(userId), JSON.stringify(saved));
  } catch {
    // Best effort: the profile is optional and should never block assessment.
  }
  return saved;
}

export function clearWellnessProfile(userId?: string): void {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    // ignore
  }
}
