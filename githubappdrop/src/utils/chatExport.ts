import type { AnswerRecord, AssessmentResult } from '../types';
import type { WellnessProfile } from './wellnessProfileStorage';
import { calculateWellnessBmi } from './wellnessProfileStorage';

export interface ExportChatMessage {
  role: 'user' | 'assistant';
  content: string;
  questionNumber?: number;
  questionText?: string;
  suggestedAction?: string;
}

function escapeText(value: string): string {
  return value.replace(/\r/g, '').trim();
}

export function downloadFullAssessmentChat(params: {
  userName?: string;
  profile?: WellnessProfile | null;
  answers: AnswerRecord[];
  messages: ExportChatMessage[];
  result: AssessmentResult;
}): void {
  const { userName, profile, answers, messages, result } = params;
  const lines: string[] = [];
  const date = new Date(result.timestamp || Date.now());

  lines.push('NEUROSCOPE — FULL ASSESSMENT CHAT');
  lines.push('='.repeat(42));
  lines.push(`Date: ${date.toLocaleString()}`);
  if (userName) lines.push(`User: ${userName}`);
  lines.push('');

  if (profile) {
    lines.push('WELLNESS PROFILE');
    lines.push(`Personalization enabled: ${profile.useForPersonalization !== false ? 'Yes' : 'No'}`);
    lines.push('-'.repeat(20));
    const entries: [string, string | number | undefined][] = [
      ['Age', profile.age],
      ['Height (cm)', profile.heightCm],
      ['Weight (kg)', profile.weightKg],
      ['Sleep (hours/night)', profile.sleepHours],
      ['Exercise', profile.exerciseFrequency],
      ['Caffeine (cups/day)', profile.caffeineCups],
      ['Tobacco / nicotine', profile.tobacco],
      ['Alcohol', profile.alcohol],
    ];
    for (const [label, value] of entries) if (value !== undefined) lines.push(`${label}: ${value}`);
    const bmi = calculateWellnessBmi(profile);
    if (bmi !== null) lines.push(`BMI reference: ${bmi} (display context only; not used in mental-health scoring)`);
    if (profile.medications) lines.push(`Medications: ${escapeText(profile.medications)}`);
    if (profile.physicalNotes) lines.push(`Physical notes: ${escapeText(profile.physicalNotes)}`);
    lines.push('');
  }

  lines.push('ASSESSMENT Q&A');
  lines.push('-'.repeat(20));
  answers.forEach((answer, index) => {
    lines.push(`Q${index + 1}. ${escapeText(answer.questionText)}`);
    lines.push(`You: ${escapeText(answer.answer || 'Not answered')}`);
    lines.push('');
  });

  if (messages.length) {
    lines.push('FOLLOW-UP CHAT');
    lines.push('-'.repeat(20));
    messages.forEach((message) => {
      lines.push(`${message.role === 'user' ? 'You' : 'NeuroScope AI'}: ${escapeText(message.content)}`);
      if (message.suggestedAction) lines.push(`Action: ${escapeText(message.suggestedAction)}`);
      lines.push('');
    });
  }

  lines.push('FINAL ASSESSMENT');
  lines.push('-'.repeat(20));
  lines.push(`Overall: ${escapeText(result.overallVerdict)}`);
  lines.push(`Severity: ${result.severityLevel}`);
  lines.push(`Summary: ${escapeText(result.verdictSummary)}`);
  lines.push('');
  if (result.motivationalMessage) lines.push(`Closing message: ${escapeText(result.motivationalMessage)}`);
  lines.push('');
  lines.push('Note: This export is a record of the NeuroScope interaction and is not a medical diagnosis.');

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  anchor.href = url;
  anchor.download = `neuroscope-full-chat-${stamp}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
