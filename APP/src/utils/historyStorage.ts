import { AssessmentResult } from '../types';
import { getCurrentUser } from './authStorage';

const STORAGE_KEY = 'neuroscope_assessment_history_v1';
const PROTOCOL_STREAKS_KEY = 'neuroscope_protocol_streaks_v1';

// Reports are scoped per signed-in account so one browser can be shared by
// more than one person without their assessment history bleeding together.
// Falls back to a shared "guest" bucket if nobody is signed in yet.
function scopedKey(base: string): string {
  const user = getCurrentUser();
  return user ? `${base}__${user.id}` : `${base}__guest`;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  verdict: string;
  severityLevel: 'optimal' | 'mild' | 'moderate' | 'high' | 'critical';
  dimensionalScores: { category: string; score: number }[];
  topConcerns: string[];
}

export function saveAssessmentToHistory(result: AssessmentResult): void {
  try {
    const existing = getAssessmentHistory();
    const entry: HistoryEntry = {
      id: `eval_${Date.now()}`,
      timestamp: result.timestamp || new Date().toISOString(),
      verdict: result.overallVerdict,
      severityLevel: result.severityLevel,
      dimensionalScores: result.dimensionalScores.map((d) => ({
        category: d.category,
        score: d.score,
      })),
      topConcerns: result.dimensionalScores
        .filter((d) => d.score < 65)
        .map((d) => d.category),
    };

    // Keep up to 15 entries, newest first
    const updated = [entry, ...existing.filter((e) => Math.abs(new Date(e.timestamp).getTime() - new Date(entry.timestamp).getTime()) > 5000)].slice(0, 15);
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(updated));
  } catch (err) {
    console.warn('Unable to persist assessment to localStorage:', err);
  }
}

export function getAssessmentHistory(): HistoryEntry[] {
  try {
    const data = localStorage.getItem(scopedKey(STORAGE_KEY));
    if (!data) return [];
    return JSON.parse(data) as HistoryEntry[];
  } catch {
    return [];
  }
}

export function clearAssessmentHistory(): void {
  try {
    localStorage.removeItem(scopedKey(STORAGE_KEY));
  } catch {
    // safe fallback
  }
}

export interface ProtocolStreakState {
  completedDates: string[]; // ISO 'YYYY-MM-DD'
  /** Which habit checkboxes are ticked — but only for `completedToolIdsDate`.
   * Deliberately NOT a lifetime record: see getProtocolStreakState(). */
  completedToolIds: Record<string, boolean>;
  /** The calendar date `completedToolIds` belongs to. */
  completedToolIdsDate: string;
  currentStreak: number;
  longestStreak: number;
  totalActivitiesCompleted: number;
}

const emptyProtocolStreak = (today: string): ProtocolStreakState => ({
  completedDates: [],
  completedToolIds: {},
  completedToolIdsDate: today,
  currentStreak: 0,
  longestStreak: 0,
  totalActivitiesCompleted: 0,
});

export function getProtocolStreakState(): ProtocolStreakState {
  const today = new Date().toISOString().split('T')[0];
  try {
    const data = localStorage.getItem(scopedKey(PROTOCOL_STREAKS_KEY));
    if (!data) return emptyProtocolStreak(today);

    const parsed = JSON.parse(data) as Partial<ProtocolStreakState>;
    const state: ProtocolStreakState = {
      completedDates: parsed.completedDates || [],
      completedToolIds: parsed.completedToolIds || {},
      completedToolIdsDate: parsed.completedToolIdsDate || today,
      currentStreak: parsed.currentStreak || 0,
      longestStreak: parsed.longestStreak ?? parsed.currentStreak ?? 0,
      totalActivitiesCompleted: parsed.totalActivitiesCompleted || 0,
    };

    // The saved checklist belongs to a previous day (or an older save with
    // no date tag at all) — this is the bug that made the streak feel
    // "stuck": a habit checked once stayed checked forever, so the next
    // real tap on it just unchecked it instead of recording a fresh
    // completion, and the streak never advanced. Clearing the checkboxes
    // here (while keeping the streak history intact) means today's
    // checklist always starts fresh, and ticking a box today always counts
    // as today's completion.
    if (state.completedToolIdsDate !== today) {
      return { ...state, completedToolIds: {}, completedToolIdsDate: today };
    }
    return state;
  } catch {
    return emptyProtocolStreak(today);
  }
}

export function recordToolCompleted(toolId: string): ProtocolStreakState {
  const today = new Date().toISOString().split('T')[0];
  const state = getProtocolStreakState(); // already resets stale checkboxes for a new day

  const newToolIds = { ...state.completedToolIds, [toolId]: true };
  const alreadyToday = state.completedDates.includes(today);
  const newDates = alreadyToday ? state.completedDates : [...state.completedDates, today];

  // Calculate streak: count consecutive calendar days, most recent first,
  // stopping at the first gap.
  let streak = 1;
  const sortedDates = [...newDates].sort().reverse();
  const oneDayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const current = new Date(sortedDates[i]).getTime();
    const prev = new Date(sortedDates[i + 1]).getTime();
    if (Math.round((current - prev) / oneDayMs) === 1) {
      streak++;
    } else {
      break;
    }
  }

  const newStreak = Math.max(streak, 1);
  const newState: ProtocolStreakState = {
    completedDates: newDates,
    completedToolIds: newToolIds,
    completedToolIdsDate: today,
    currentStreak: newStreak,
    longestStreak: Math.max(state.longestStreak || 0, newStreak),
    totalActivitiesCompleted: state.totalActivitiesCompleted + 1,
  };

  try {
    localStorage.setItem(scopedKey(PROTOCOL_STREAKS_KEY), JSON.stringify(newState));
  } catch {
    // safe fallback
  }

  return newState;
}
