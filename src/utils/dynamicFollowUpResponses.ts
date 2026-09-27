/**
 * Dynamic local follow-up chat response engine.
 *
 * This is the layer that answers "Chat with AI About This Feeling" whenever the
 * remote Gemini/Groq call is unavailable (no API key configured, network error,
 * or timeout). Previously this path always returned one single hard-coded
 * sentence, so the "AI Mental Health Partner" looked broken/scripted no matter
 * what the person typed.
 *
 * Instead, this engine reads the user's actual follow-up text (and the solution
 * context it was asked from) and picks from a bank of specific, topic-matched,
 * multi-variant responses — so two different questions get two different,
 * relevant answers, and even the *same* question asked twice gets a
 * different phrasing/variant.
 */

export interface FollowUpContext {
  questionText?: string;
  userAnswer?: string;
  solutionTitle?: string;
  emotionalStateLabel?: string;
  neurobiology?: string;
  /** Dominant 7-way Ekman emotion detected for the answer this chat is
   * attached to (from the transformer emotion classifier), used to pick a
   * relevant topic bank when the typed follow-up itself has no clear
   * keyword match — so the reply still reacts to the user's actual tone
   * instead of always falling through to the generic default bank. */
  dominantEmotion?: string;
  /** Dynamic risk band for the run (low/elevated/high/critical) so a
   * distressed-leaning follow-up can lead a little more gently. */
  riskBand?: string;
}

export interface FollowUpReply {
  reply: string;
  suggestedAction?: string;
}

// Small deterministic string hash so the same input reliably maps to the same
// bucket, while different inputs (or the same question re-asked with slightly
// different wording) can land on different variants.
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function snippet(text: string, max = 70): string {
  const clean = (text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

interface TopicBank {
  id: string;
  matches: (lower: string) => boolean;
  variants: Array<{ reply: string; suggestedAction: string }>;
}

const TOPIC_BANKS: TopicBank[] = [
  {
    id: 'sleep_night',
    matches: (l) =>
      /\b(sleep|insomnia|bed|bedtime|night|can'?t sleep|wake up|waking up|3am|3 am)\b/.test(l),
    variants: [
      {
        reply:
          "Nights are harder because there are fewer distractions to compete with your thoughts, and your cortisol/melatonin rhythm is also naturally shifting around then, which is why feelings can spike right as you're trying to wind down.\n\n" +
          '- Dim lights and stop screens 30–45 minutes before bed so melatonin can actually rise.\n' +
          "- If your mind is looping, keep a notepad by the bed and write the thought down — you're not solving it, just parking it for tomorrow.\n" +
          '- Try box breathing (4 in, 4 hold, 4 out, 4 hold) for 6 rounds; it slows your heart rate enough to make lying still tolerable.',
        suggestedAction: 'Do 6 rounds of box breathing (4-4-4-4) before you try to fall back asleep tonight.',
      },
      {
        reply:
          "That 2–3am wake-up is a very common stress pattern — a small cortisol pulse pulls you out of light sleep, and with nothing else happening, your brain fills the silence with worry.\n\n" +
          "It's not a sign anything is wrong with you specifically; it's your nervous system being a little over-alert. Keeping the room cool and dark, and avoiding checking the time or your phone, both make it easier to drift back down rather than fully waking up.",
        suggestedAction: 'Turn your clock/phone face-down so checking the time isn\'t an option tonight.',
      },
    ],
  },
  {
    id: 'work',
    matches: (l) =>
      /\b(work|job|boss|meeting|office|deadline|coworker|colleague|shift|workplace)\b/.test(l),
    variants: [
      {
        reply:
          "Feelings like this hit hardest at work because you're often expected to look composed while your internal state is anything but — that gap itself is exhausting.\n\n" +
          '- Give yourself a 60-second reset in a bathroom stall or stairwell: two slow exhales, unclench your jaw, drop your shoulders.\n' +
          '- Lower the bar for the next hour to "just the next task," not the whole day.\n' +
          "- If it's safe to, a short, honest sentence to a trusted colleague (\"rough morning, pushing through\") can relieve some of the pressure of pretending.",
        suggestedAction: 'Take a 60-second private reset before your next task: two slow exhales, drop your shoulders.',
      },
      {
        reply:
          "Work stress compounds fast because it combines real deadlines with the fear of being judged, and those two things activate the same threat circuitry as physical danger.\n\n" +
          "Try separating the two: write down what's actually due today versus what's just anxious noise about how you're perceived. Usually the list of real, urgent items is much shorter than it feels.",
        suggestedAction: 'Write two short lists: "actually due today" and "just anxious noise" — act only on the first.',
      },
    ],
  },
  {
    id: 'cant_calm_down',
    matches: (l) =>
      /\b(can'?t calm down|panic|panicking|racing heart|can'?t breathe|hyperventilat)\b/.test(l),
    variants: [
      {
        reply:
          "When you genuinely can't calm down, trying to \"think\" your way calm usually makes it worse, because the thinking brain is offline during a real spike — the body has to lead first.\n\n" +
          '- Do a **physiological sigh**: inhale through your nose, then a second short top-off inhale, then a long, slow exhale through your mouth. Repeat 3 times.\n' +
          '- Press your feet flat into the floor and notice the actual physical contact — that pulls blood flow back toward your prefrontal cortex.\n' +
          "- Remind yourself: this will peak and pass, usually within 10–20 minutes, even if you do nothing else.",
        suggestedAction: 'Do 3 physiological sighs right now: double inhale through the nose, long exhale through the mouth.',
      },
      {
        reply:
          "That out-of-control feeling is your sympathetic nervous system in full swing — it's uncomfortable but not dangerous, and it always has a ceiling; it cannot climb forever.\n\n" +
          'Cold is one of the fastest circuit-breakers available: splash cold water on your face or hold something cold for 20–30 seconds. It triggers the dive reflex, which directly slows your heart rate.',
        suggestedAction: 'Hold something cold (ice, a cold can, cold water) against your wrists or face for 20–30 seconds.',
      },
    ],
  },
  {
    id: 'chest_body',
    matches: (l) =>
      /\b(chest|heart racing|tight chest|stomach|nausea|shaking|dizzy|body ache|headache)\b/.test(l),
    variants: [
      {
        reply:
          "Physical symptoms like that are your body's stress response made visible — a tight chest and a racing heart are the same adrenaline surge, just felt in different places.\n\n" +
          "It's genuinely uncomfortable, and also genuinely not dangerous on its own. Slowing your exhale longer than your inhale (try 4 in, 7 out) directly tells your vagus nerve to apply the brakes.\n\n" +
          "If these physical symptoms are new, severe, or you're at all unsure whether it's anxiety versus something medical, it's worth mentioning to a doctor so it can be ruled out and you can stop worrying about it.",
        suggestedAction: 'Breathe in for 4 seconds, out for 7 seconds, for 5 rounds.',
      },
    ],
  },
  {
    id: 'relationships',
    matches: (l) =>
      /\b(friend|family|partner|relationship|breakup|marriage|parents|argu|fight with|lonely with people|misunderstood)\b/.test(
        l
      ),
    variants: [
      {
        reply:
          "Relationship pain lands differently than other stress because connection is a core survival need, not a luxury — your brain treats being hurt by someone close the same way it treats physical injury.\n\n" +
          "It's okay to still care about someone and also need space or boundaries from the pain they're causing right now. Those aren't contradictions.\n\n" +
          'One small, doable step: write down (even just for yourself, not to send) what you actually needed in that moment. It often clarifies the real ask underneath the hurt.',
        suggestedAction: 'Write one sentence, just for yourself, that finishes: "What I actually needed was…"',
      },
    ],
  },
  {
    id: 'motivation',
    matches: (l) =>
      /\b(motivat|procrastinat|can'?t start|no energy to|lazy|unproductive|stuck on)\b/.test(l),
    variants: [
      {
        reply:
          "Low motivation is usually a dopamine and energy-budget problem, not a character flaw — your brain is refusing to spend resources on a task it can't yet see the payoff of.\n\n" +
          "- Shrink the task until it feels almost silly small (\"open the document,\" not \"finish the project\").\n" +
          '- Do that one tiny piece with zero expectation of continuing — momentum often shows up after starting, not before.\n' +
          "- Pair it with something mildly pleasant (music, a drink you like) so your brain has an immediate, not just eventual, reward.",
        suggestedAction: 'Pick the smallest possible first step and do only that, with no expectation of continuing.',
      },
    ],
  },
  {
    id: 'sad_hopeless',
    matches: (l) =>
      /\b(hopeless|sad|empty|numb|worthless|pointless|meaningless|cry|crying)\b/.test(l),
    variants: [
      {
        reply:
          "That heaviness is real, and it makes sense that even small things feel like a lot right now — emotional depletion narrows your capacity, it doesn't reflect your worth.\n\n" +
          "You don't need to fix the whole feeling today. A very small act of self-warmth — a hand on your chest, a few minutes outside, a warm drink — can be enough to interrupt the spiral without demanding much energy.\n\n" +
          "If this heaviness has been sticking around for weeks rather than passing through, it's worth talking to a doctor or therapist — not because something is wrong with you, but because you deserve real support, not just coping tricks.",
        suggestedAction: 'Do one small act of warmth for yourself in the next 10 minutes — nothing that requires much energy.',
      },
    ],
  },
  {
    id: 'anger',
    matches: (l) => /\b(angry|anger|frustrat|irritat|furious|resent)\b/.test(l),
    variants: [
      {
        reply:
          "Anger is often a secondary emotion covering something more vulnerable underneath — hurt, fear, or feeling disrespected. It's a valid signal, not something to suppress.\n\n" +
          "Physically discharging it helps before you try to think it through: a hard, fast walk, shaking out your hands, or pressing your palms together as hard as you can for 10 seconds all give the surge somewhere to go.",
        suggestedAction: 'Press your palms together as hard as you can for 10 seconds, then release slowly.',
      },
    ],
  },
  {
    id: 'overthinking',
    matches: (l) =>
      /\b(overthink|racing thoughts|can'?t stop thinking|rumina|worst case|loop|spiral)\b/.test(l),
    variants: [
      {
        reply:
          "Once a thought starts looping, arguing with its content usually feeds it. What actually helps is changing your relationship to the thought rather than the thought itself.\n\n" +
          'Try prefacing it: "I notice I\'m having the thought that…" — that small shift creates just enough distance for your prefrontal cortex to step back in.',
        suggestedAction: 'Say the looping thought out loud starting with "I notice I\'m having the thought that…"',
      },
    ],
  },
  {
    id: 'default',
    matches: () => true,
    variants: [
      {
        reply:
          "Thank you for sharing that — it takes real self-awareness to name what you're feeling instead of pushing past it.\n\n" +
          "What you're describing sounds genuinely tiring to carry. There's no need to have it all figured out right now; naming it clearly, the way you just did, is itself a form of progress.\n\n" +
          "If it would help, tell me a bit more about when this feeling tends to show up most — that can point to a more specific next step.",
        suggestedAction: 'Notice the next moment this feeling shows up, and just label it silently, for example "this is anxiety" or "this is exhaustion."',
      },
      {
        reply:
          "I hear you. Whatever is underneath this is worth taking seriously, even if it's hard to fully put into words right now.\n\n" +
          "One thing that reliably helps in the short term is lowering the pressure to solve everything at once — pick the smallest next moment, not the whole situation, as the thing you're responsible for right now.",
        suggestedAction: 'Choose one small, concrete thing you can do in the next 5 minutes, and only focus on that.',
      },
    ],
  },
];

/** Falls back on the dominant detected emotion (rather than keywords) to pick
 * a relevant topic bank when the typed follow-up itself has no clear match —
 * this is how the chat "catches the tone" of the user even for short or
 * vague follow-ups like "why?" or "what do I do". */
const EMOTION_TO_BANK: Record<string, string> = {
  sadness: 'sad_hopeless',
  fear: 'cant_calm_down',
  anger: 'anger',
  disgust: 'sad_hopeless',
};

/**
 * Generates a personalized, non-repetitive fallback reply for the live
 * "Chat with AI About This Feeling" follow-up box, based on what the user
 * actually typed (and, secondarily, the solution context — including the
 * detected emotional tone — it was asked from).
 */
export function generateDynamicFollowUpReply(
  userFollowUp: string,
  context: FollowUpContext = {}
): FollowUpReply {
  const raw = (userFollowUp || '').trim();
  const lower = raw.toLowerCase();
  const seed = hashString(`${raw}|${context.emotionalStateLabel || ''}|${context.dominantEmotion || ''}`);

  let bank = TOPIC_BANKS.find((b) => b.id !== 'default' && b.matches(lower));
  if (!bank && context.dominantEmotion) {
    const emotionBankId = EMOTION_TO_BANK[context.dominantEmotion];
    bank = emotionBankId ? TOPIC_BANKS.find((b) => b.id === emotionBankId) : undefined;
  }
  bank = bank || TOPIC_BANKS[TOPIC_BANKS.length - 1];
  const variant = pick(bank.variants, seed);

  const quoted = snippet(raw);
  const lead = quoted
    ? pick(
        [
          `About "${quoted}" — `,
          `On what you just shared ("${quoted}") — `,
          `Reflecting on "${quoted}": `,
        ],
        seed
      )
    : '';

  // Only prepend the quoted lead for non-default banks, since default replies
  // already reference "what you're describing" generically.
  let reply = bank.id === 'default' ? variant.reply : `${lead}${variant.reply}`;

  if (context.riskBand === 'high' || context.riskBand === 'critical') {
    reply += "\n\nOne more thing — if this ever tips into feeling unsafe, please reach out to one of the support lines on this page. You don't have to carry it alone.";
  }

  return {
    reply,
    suggestedAction: variant.suggestedAction,
  };
}
