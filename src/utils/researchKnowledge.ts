/**
 * All insight variants below are distilled from the project's source library:
 *   - Porges, S.W. (2007). "The Polyvagal Perspective." Biological Psychology, 74(2), 116-143.
 *   - Pilkonis, P.A. et al. (2011). "Item Banks for Measuring Emotional Distress From the
 *     Patient-Reported Outcomes Measurement Information System (PROMIS): Depression,
 *     Anxiety, and Anger." Assessment, 18(3), 263-283.
 *   - Gibbons, R.D. et al. (2012). "Development of a Computerized Adaptive Test for
 *     Depression." Archives of General Psychiatry, 69(11), 1104-1112.
 *   - SAMHSA (2014). "Trauma-Informed Care in Behavioral Health Services."
 *     Treatment Improvement Protocol (TIP) Series No. 57.
 *
 * An expanded retrievable corpus (the same four papers plus eleven
 * clinical/neuroscience books) lives in `src/data/researchCorpus.ts` and is
 * matched to each individual answer semantically by
 * `src/utils/researchRetrieval.ts`; retrieved passages are then woven into
 * these paragraphs and into the LLM prompt brief below.
 *
 * The composers assemble ONE cohesive, medium-length, high-detail paragraph per
 * section. Every paragraph is dynamic: it interpolates the user's own words, the
 * question's topic/category, the detected tone family and intensity, and rotates
 * between research-grounded phrasing variants seeded by the answer itself — so
 * two different answers (or the same answer to a different question) never
 * produce the same paragraph.
 */

export type ResearchTheme =
  | 'anxious'
  | 'overthinking'
  | 'fatigued'
  | 'numb_sad'
  | 'disconnected'
  | 'neutral'
  | 'calm'
  | 'severe'
  | 'general';

export const RESEARCH_SOURCES = {
  PORGES: 'Porges, S.W. (2007). The Polyvagal Perspective. Biological Psychology, 74(2), 116-143',
  PILKONIS:
    'Pilkonis, P.A. et al. (2011). Item Banks for Measuring Emotional Distress From the PROMIS: Depression, Anxiety, and Anger. Assessment, 18(3), 263-283',
  GIBBONS:
    'Gibbons, R.D. et al. (2012). Development of a Computerized Adaptive Test for Depression. Archives of General Psychiatry, 69(11), 1104-1112',
  TIP57: 'SAMHSA (2014). Trauma-Informed Care in Behavioral Health Services. TIP Series No. 57',
} as const;

export interface ResearchComposeInput {
  theme: ResearchTheme;
  /** The user's own words, pre-quoted and clipped (e.g. `"yes" (your answer to "...")`). May be empty. */
  userSnippet?: string;
  questionText?: string;
  category?: string;
  /** Per-question topic focus (e.g. from the question's keywords), e.g. "sleep and energy". */
  focus?: string;
  toneLabel?: 'calm' | 'neutral' | 'distressed' | 'severe' | string;
  toneMagnitude?: number;
  questionNumber?: number;
  /** Extra entropy so the same answer to different questions varies. */
  seedText?: string;
  /** Semantically retrieved research passages for THIS answer (see
   * src/utils/researchRetrieval.ts) — woven in as explicit evidence so the
   * local paragraphs cite the same source library the API path does. */
  retrieved?: RetrievedPassage[];
  /** The project's own fine-tuned NeuroScope DistilBERT reading of THIS
   * answer (see src/utils/semanticEngine.ts::classifyWithNeuroScope), when
   * the on-device model produced one. Used to ground the nervous-system
   * paragraph in the actual classifier output instead of keywords alone,
   * and to bias theme selection when the keyword read is ambiguous. */
  neuroscope?: {
    topStatus: string;
    pTop: number;
    pRisk?: number;
    band?: string;
    top3?: { label: string; p: number }[];
  } | null;
  /** Dominant 7-way Ekman emotion for this answer, only when it came from
   * the real transformer classifier (never the lexicon fallback) — used to
   * make sure the composed language actually reflects the detected tone
   * rather than only the coarse calm/neutral/distressed/severe band. */
  dominantEmotion?: string | null;
  dominantEmotionScore?: number | null;
}

/**
 * A single research passage retrieved for the current answer — either the
 * paper/book layer of the project library (src/data/researchCorpus.ts) or a
 * compact theme insight. Structurally compatible with `ResearchPassage` so
 * the corpus can be used directly, with `score` added by retrieval and
 * `sourceShort` added for in-text attribution.
 */
export interface RetrievedPassage {
  id: string;
  source: string;
  sourceShort?: string;
  kind: 'paper' | 'book';
  theme: string;
  /** Research statement used for prompt grounding. */
  text: string;
  /** Plain-language sentence safe to show a user directly. */
  plain: string;
  score?: number;
}

type ToneFamily = 'positive' | 'even' | 'negative';

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

function toneFamilyOf(input: ResearchComposeInput): ToneFamily {
  if (input.toneLabel === 'calm') return 'positive';
  if (input.toneLabel === 'neutral') return 'even';
  return 'negative';
}

interface ThemeInsights {
  /** Validating, lived-experience sentences (trauma-informed register, TIP 57). */
  empathy: string[];
  /** Mechanism-level sentences naming the physiology in plain language. */
  neuro: string[];
  /** Reframe sentences that dissolve self-judgment, research-backed. */
  reframe: string[];
  /** Short noun/verb pair used to personalize the closing forward-look. */
  forward: { noun: string; verb: string }[];
}

const THEME_INSIGHTS: Record<ResearchTheme, ThemeInsights> = {
  anxious: {
    empathy: [
      'That internal alarm — the body bracing for danger while nothing visible is actually happening — is one of the most physically exhausting states a person can live in, and it is far more common than anyone admits out loud.',
      'Living wired and on edge means your body has been rehearsing for a danger you never chose; the tiredness underneath that vigilance is real physiological tiredness, not weakness or overreaction.',
    ],
    neuro: [
      'In polyvagal terms (Porges, 2007), neuroception — your below-awareness risk detector — is reading "danger" and pulling you into the sympathetic mobilization rung of the autonomic ladder: heart rate up, breathing shallow and high in the chest, muscles pre-loaded for action you never get to take.',
      'The myelinated "vagal brake" that would normally slow your heart (Porges, 2007) is being overridden by that alarm, so arousal keeps recycling even when you know the room is safe — the exact pattern PROMIS flags with its highest-signal anxiety items: sudden panic, a pounding heart, dread (Pilkonis et al., 2011).',
    ],
    reframe: [
      'Anxiety like this is not a character flaw or a broken brain — it is a protection system working overtime, and in polyvagal terms it is a state, not a trait: states move, and the same nervous system that escalated can be guided back down the ladder toward the social-engagement rung where connection and calm live (Porges, 2007).',
      'Trauma-informed research reads responses like this as adaptations your nervous system learned to keep you safe, not defects to be ashamed of (SAMHSA TIP 57) — so the useful question is never "what is wrong with me?" but "what is my body trying to protect, and how can I show it we are safe now?"',
    ],
    forward: [
      { noun: 'the alarm', verb: 'teach it, breath by breath, that the present moment is not the danger it is rehearsing for' },
      { noun: 'that hyper-vigilance', verb: 'give it a physical exit route — slow exhales, grounded posture, felt safety — instead of asking it to argue itself calm' },
    ],
  },
  overthinking: {
    empathy: [
      'The looping you describe is not idle worry — it is your mind trapped in a mental courtroom, re-litigating every worst case and past decision on repeat, and the exhaustion it leaves behind is as real as physical labor.',
      'When thoughts spin like this it feels like being locked inside your own head with a narrator who will not stop, and it makes complete sense that you are tired of it — rumination burns real cognitive fuel while producing no verdicts.',
    ],
    neuro: [
      'Loops like this keep the brain\'s default-mode network — its self-referential past-and-future circuitry — locked in recursive evaluation, and because each pass feels like problem-solving, willpower alone rarely stops it; the load then shows up in the cognition subdomain of distress: trouble concentrating, deciding, remembering (Gibbons et al., 2012).',
      'Underneath the spinning, neuroception (Porges, 2007) is treating unresolved uncertainty itself as risk, holding sympathetic tone elevated while the mind hunts for a certainty that would finally stand the nervous system down — which is why loops intensify at night and in silence.',
    ],
    reframe: [
      'Rumination is not a personality defect; it is your brain\'s clumsy, sincere attempt at protection — it believes that if it replays the worry enough times it can outrun surprise — and once the loop is seen as a misfiring safety strategy rather than truth-telling, you can change your relationship to the thoughts instead of fighting their content (SAMHSA TIP 57).',
      'Thoughts in a loop are mental events, not facts or commands: the observing part of you that notices the loop is already one step outside it, and that distance — not suppression — is what lets the default-mode circuitry downshift (Porges, 2007; Gibbons et al., 2012).',
    ],
    forward: [
      { noun: 'the loop', verb: 'meet it with distance and scheduled attention instead of midnight verdicts' },
      { noun: 'that mental courtroom', verb: 'adjourn it on purpose — park the case in a worry window and let the body leave the building' },
    ],
  },
  fatigued: {
    empathy: [
      'That heaviness — small tasks feeling like lifting weights under water — is the lived texture of genuine depletion, and it is nothing like laziness: laziness is not caring, while exhaustion is caring deeply without the biochemical bandwidth left to execute.',
      'When your inner battery is this low, ordinary life starts feeling like endurance sport, and anyone pushing through days like that deserves acknowledgment, not self-criticism, for still being in the race.',
    ],
    neuro: [
      'Chronic demand without recovery keeps stress physiology engaged until the body enforces its own conservation: tonic dopamine drops, adenosine accumulates, and the autonomic ladder slides toward the dorsal-vagal immobilization rung (Porges, 2007) — felt from the inside as fog, heaviness, and effort inflation on every single task.',
      'Measurement research treats exactly these indicators — sleep disturbance, low energy, slowed task initiation — as a distinct somatic-behavioral subdomain of distress because they carry real diagnostic signal (Gibbons et al., 2012): your fatigue is data about load and recovery debt, not evidence of a faulty character.',
    ],
    reframe: [
      'Rest is not a reward you must earn by finishing everything first; it is the biological repair state in which neurotransmitter reserve and vagal tone are actually rebuilt — a prerequisite, not a prize (Porges, 2007).',
      'A stress- and trauma-informed lens reads this fatigue as the invoice for how long you have been carrying load without repair, and sequences the fix the same way: safety, pacing, and recovery first, productivity second (SAMHSA TIP 57) — the tiredness is proof of endurance, not of inadequacy.',
    ],
    forward: [
      { noun: 'the depletion', verb: 'pay it back in small, unearned rest installments instead of waiting for a collapse to force the pause' },
      { noun: 'this conservation mode', verb: 'work with it — one micro-task, real breaks, daylight — until the battery stops reading empty' },
    ],
  },
  numb_sad: {
    empathy: [
      'The muted, gray quality you describe — life observed through thick glass, feelings flat or tearful without a clear reason — is one of the most isolating experiences there is, precisely because it is so hard to explain to people who expect sadness to look like crying.',
      'Naming flatness or heaviness takes real courage, because numbness whispers that nothing matters enough to even describe — and yet here you are, describing it honestly.',
    ],
    neuro: [
      'When emotional overload persists, the primitive dorsal-vagal circuit initiates a hypo-arousal conservation shutdown to protect you from further pain (Porges, 2007) — the same immobilization rung that produces emptiness, anhedonia, and the sense of watching life from behind glass.',
      'What you report maps onto the most discriminating indicators in the PROMIS depression item bank — hopelessness, worthlessness, helplessness felt as different from your usual self (Pilkonis et al., 2011) — which measurement models place in the mood subdomain alongside somatic and cognitive shifts (Gibbons et al., 2012).',
    ],
    reframe: [
      'Sadness and numbness of this kind are not character flaws or permanent identities; they are tender protective states — the nervous system\'s conservation mode — and states, by definition, move (Porges, 2007).',
      'A recovery-oriented, strengths-based reading (SAMHSA TIP 57) treats this heaviness as a signal that something matters deeply to you and has been asked to carry too much for too long — the flatness is not the absence of feeling, it is feeling in protective storage.',
    ],
    forward: [
      { noun: 'the flatness', verb: 'approach it with warmth and micro-doses of sensation and connection, not with demands to feel happy on command' },
      { noun: 'this protective shutdown', verb: 'thaw it gently — one warm drink, one patch of daylight, one honest sentence to one safe person at a time' },
    ],
  },
  disconnected: {
    empathy: [
      'Feeling alone or misunderstood the way you describe is one of the sharpest pains a human being can carry, because connection is not a luxury for our species — it is the baseline condition our nervous systems were built to expect.',
      'Isolation has a particular cruelty: it convinces you that no one else could possibly feel this unseen, while millions of thoughtful, sensitive people are carrying this exact longing today — a shared human wound, not a personal failure.',
    ],
    neuro: [
      'Neuroscience shows that social disconnection and feeling misunderstood activate the same physical pain pathways as bodily injury — the dorsal anterior cingulate and anterior insula light up as if you were hurt, because to a tribal brain, exclusion once meant death.',
      'Polyvagal theory adds the mechanism: the social-engagement system — face, voice, listening, the myelinated vagal circuits that make connection feel possible (Porges, 2007) — withdraws when neuroception reads the social world as risky, making reaching out feel terrifying exactly when it is most needed; trauma-informed work names the same pattern where trust was once wounded (SAMHSA TIP 57).',
    ],
    reframe: [
      'Loneliness is an evolutionary hunger signal, like hunger for food — proof that your capacity for connection is alive and asking for nourishment, not proof that you are unlovable or too much (Porges, 2007).',
      'Because nervous systems co-regulate — calm settles calm, presence settles presence (Porges, 2007) — reaching out is never "bothering" someone: it is the biological mechanism by which humans load-share pain, and trauma-informed practice treats peer connection as medicine, not weakness (SAMHSA TIP 57).',
    ],
    forward: [
      { noun: 'the isolation', verb: 'answer it with low-stakes contact — one text, one shared room, one small moment of being seen — rather than waiting to feel worthy of connection first' },
      { noun: 'this social pain signal', verb: 'treat it like the hunger it is: fed in small, safe portions until reaching out stops feeling like risk' },
    ],
  },
  neutral: {
    empathy: [
      'A steady-but-unremarkable stretch is its own kind of experience — not suffering, not sparkling — and noticing it clearly, the way you just did, is a quieter form of self-awareness that most people skip straight past.',
      'The honest middle you are describing is a real and worthwhile place to be, even though almost no one talks about it: stable enough to act from, quiet enough to feel like nothing is happening.',
    ],
    neuro: [
      'An even baseline corresponds to a regulated mid-state on the autonomic ladder: the vagal brake holding heart rate steady, the social-engagement system online (Porges, 2007) — meaning your nervous system is currently a stable platform, exactly the condition in which new positive input can be absorbed instead of burned for survival.',
      'Measurement science treats mood as a continuum, not a switch (Gibbons et al., 2012; Pilkonis et al., 2011): a mid-range reading is a real, movable position on that continuum, and behavioral-activation research shows that small scheduled positive inputs — novelty, connection, movement, small wins — raise reward tone from a neutral baseline faster than waiting for mood to improve on its own.',
    ],
    reframe: [
      '"Fine" is a starting point, not a ceiling: a neutral baseline is not emptiness waiting to be fixed, it is a stable platform holding the energy and stability required to invest deliberately — the rarest precondition in mental health, and you already have it.',
      'Because distress and wellbeing sit on one measurable continuum (Gibbons et al., 2012), small positive deposits made from a neutral place compound just as reliably as small withdrawals deplete a stressed one — the middle is not a dead zone, it is the best place to build from.',
    ],
    forward: [
      { noun: 'this even baseline', verb: 'invest in it deliberately — one small joy, one kind message, one patch of daylight at a time' },
      { noun: 'the stable middle', verb: 'use its stability on purpose instead of waiting for life to supply the uplift' },
    ],
  },
  calm: {
    empathy: [
      'Noticing and naming that things feel okay is just as skillful, and just as rare, as noticing and naming pain — and it deserves to be marked rather than assumed.',
      'What you shared shows a mind that is not just surviving this stretch but aware that it is going well — and that awareness is exactly what lets good periods teach you something instead of passing unnoticed.',
    ],
    neuro: [
      'A settled state like this is the polyvagal social-engagement system doing its job: the myelinated vagal brake holding the heart steady, face and voice expressive, listening open — the physiological platform from which connection, creativity, and clear thinking all run (Porges, 2007).',
      'Consciously noticing a positive state strengthens the very routines and cues that produced it: affect labeling and savoring engage prefrontal regulation circuits that make the state easier to recognize and re-enter later (Gibbons et al., 2012) — you are sitting on the healthy end of the same continuum distress is measured on (Pilkonis et al., 2011).',
    ],
    reframe: [
      'Calm is not merely the absence of a hard week and not mere luck — it is a skillful state your habits, relationships, and nervous system built together, and naming it turns it from weather into infrastructure (Porges, 2007).',
      'Because nervous systems co-regulate, your steadiness is not private property: a regulated state like yours is precisely what settles the people around you (Porges, 2007; SAMHSA TIP 57) — thriving, noticed, becomes something you can bank and something you can share.',
    ],
    forward: [
      { noun: 'this steadiness', verb: 'bank it — notice how it feels in the body, and name which habits built it so you can find your way back' },
      { noun: 'the good stretch', verb: 'let it teach you: one noticed breath, one shared good moment, one habit named out loud' },
    ],
  },
  severe: {
    empathy: [
      'What you have shared sounds genuinely heavy — the kind of weight that makes even describing it cost something — and putting it into words here, now, is an act of real courage, not overreaction.',
      'I want to meet what you said with the seriousness it deserves: pain this loud is exhausting for mind and body at once, and no one should be asked to carry it alone, least of all silently.',
    ],
    neuro: [
      'At this intensity the stress-response system is in full protective overdrive — sympathetic alarm and, in waves, dorsal-vagal shutdown alternating (Porges, 2007) — which is why thinking clearly, sleeping, or feeling hope can feel physiologically out of reach right now; this is a state of the nervous system, not a verdict on your future.',
      'Trauma-informed clinical guidance is explicit that responses of this magnitude make sense in context and deserve safety-first care: physical and emotional safety, connection, and stabilization before any other work (SAMHSA TIP 57); severity like yours is exactly what validated measurement treats as the signal to bring real human support alongside you now (Pilkonis et al., 2011).',
    ],
    reframe: [
      'Reaching out — to a helpline, a professional, one trusted person — is not weakness or burden-making; it is the strongest, most self-caring move available, and co-regulation science says another calm nervous system genuinely lightens the load your own system is carrying (Porges, 2007).',
      'Pain this loud is not proof that you are broken beyond repair; it is proof that something in you has been asked to endure too much for too long — and trauma-informed, recovery-oriented care exists precisely because states like this can and do move (SAMHSA TIP 57).',
    ],
    forward: [
      { noun: 'this weight', verb: 'set it down with help — one call, one message, one slow breath with a hand on your chest' },
      { noun: 'the crisis intensity', verb: 'let it be met by real support tonight, so your nervous system learns it does not have to hold this alone' },
    ],
  },
  general: {
    empathy: [
      'Putting an inner state into words, exactly as you just did, is the foundational act of emotional self-care — rarer and braver than it sounds.',
      'Answering a question like this thoughtfully instead of on autopilot is a sign of a mind that intends to stay in relationship with itself, whatever today feels like.',
    ],
    neuro: [
      'Putting feelings into language — affect labeling — activates right ventrolateral prefrontal circuits that measurably dampen amygdala reactivity, so the very act of answering this question honestly has already done a small piece of regulation work in your brain.',
      'In polyvagal terms, naming your state is one of the cheapest ways to engage the observing, social-engagement side of the nervous system (Porges, 2007); and because distress and wellbeing are measured as dimensions across mood, cognition, behavior, and body (Gibbons et al., 2012), each honest check-in like this one adds a real data point you can act on.',
    ],
    reframe: [
      'Mental well-being is not the absence of stress or difficult feelings; it is the capacity to meet each moment — steady or stormy — with grounded flexibility, and every honest check-in like this one is a rep in exactly that muscle (Porges, 2007).',
      'Self-awareness of this kind is not self-absorption: trauma-informed, recovery-oriented practice treats noticing and naming your own state as the first and most durable protective factor there is (SAMHSA TIP 57) — you are not indulging yourself, you are maintaining your own infrastructure.',
    ],
    forward: [
      { noun: 'this reflective habit', verb: 'keep it alive — short, honest check-ins like this one, repeated, are how balance is actually built' },
      { noun: 'your self-awareness', verb: 'put it to work: one noticed breath, one named feeling, one small kind choice today' },
    ],
  },
};

/** How the reported state tends to show up, per screening category. */
const CATEGORY_MANIFESTATION: Array<{ match: RegExp; clause: string }> = [
  { match: /thought|rumina|worry|cognit/i, clause: 'in thought speed, mental loops, and the quality of your sleep' },
  {
    match: /daily|function|routine|work|energy|physical/i,
    clause: 'in energy, task initiation, sleep, and the sheer effort cost of ordinary routines',
  },
  { match: /social|connect|relation|support/i, clause: 'in how reachable other people feel, and how safe it feels to be seen by them' },
  { match: /body|somatic/i, clause: 'in the body directly — tension, breath, heart rate, and rest' },
  { match: /mood|emotion|feel/i, clause: 'in mood tone, motivation, and the color of ordinary moments' },
];

function manifestationClause(category?: string): string {
  const c = (category || '').trim();
  if (!c) return 'in the places this area of life touches first — mood, body, sleep, and attention';
  const hit = CATEGORY_MANIFESTATION.find((x) => x.match.test(c));
  return hit ? hit.clause : `in the everyday texture of ${c.toLowerCase()}`;
}

function intensityPhrase(input: ResearchComposeInput): string {
  const family = toneFamilyOf(input);
  if (family === 'positive') return 'in a settled, workable register';
  if (family === 'even') return 'at a low, even hum';
  const mag = Math.abs(input.toneMagnitude ?? 0);
  if (input.toneLabel === 'severe' || mag >= 0.6) return 'at full volume';
  if (mag >= 0.3) return 'loudly enough to color much of your day';
  if (input.toneLabel === 'distressed') return 'clearly enough to be worth taking seriously';
  return 'in a way that is easy to normalize and easy to miss';
}

function seedFor(input: ResearchComposeInput, salt: number): number {
  return hashString(
    `${input.seedText || ''}|${input.userSnippet || ''}|${input.questionNumber ?? 0}|${input.theme}|${
      input.neuroscope?.topStatus || ''
    }|${input.dominantEmotion || ''}|${salt}`
  );
}

/** Plain-language, non-diagnostic phrasing for each NeuroScope dimension —
 * describes what the model's language patterns lean toward, never what the
 * person "has" (matching the DATASET-GROUNDING rule used server-side). */
const NEUROSCOPE_PLAIN: Record<string, string> = {
  Normal: 'steady and low-distress',
  Depression: 'depressive-leaning — heaviness, low mood, or flatness',
  Suicidal: 'high-risk in tone — language the model treats as a safety signal',
  Anxiety: 'anxious-leaning — bracing, worry, or a keyed-up nervous system',
  Bipolar: 'mood-variable — swings in energy or intensity',
  Stress: 'stress-loaded — pressure and load without much recovery',
  'Personality Disorder': 'relational and identity strain',
};

/** Maps a NeuroScope dimension onto the closest research theme, so the
 * model's own read of the language can fill in for (or agree with) the
 * keyword-based detector below. */
const NEUROSCOPE_THEME: Record<string, ResearchTheme> = {
  Normal: 'general',
  Depression: 'numb_sad',
  Suicidal: 'severe',
  Anxiety: 'anxious',
  Bipolar: 'disconnected',
  Stress: 'fatigued',
  'Personality Disorder': 'disconnected',
};

/**
 * One plain-language sentence citing the live NeuroScope DistilBERT reading
 * for this exact answer — the "dynamic" signal the local composer was
 * previously missing. Returns '' when no reading is available (model still
 * warming up, or an offline browser), so callers degrade gracefully.
 */
function neuroscopeSentence(input: ResearchComposeInput): string {
  const ns = input.neuroscope;
  if (!ns || !ns.topStatus) return '';
  const plain = NEUROSCOPE_PLAIN[ns.topStatus];
  if (!plain) return '';
  const pct = Math.round((ns.pTop ?? 0) * 100);
  const secondary = (ns.top3 || []).find((t) => t.label !== ns.topStatus);
  const secondaryClause =
    secondary && secondary.p >= 0.15
      ? `, with a secondary ${NEUROSCOPE_PLAIN[secondary.label]?.split(' — ')[0] || secondary.label.toLowerCase()} signal (${Math.round(secondary.p * 100)}%)`
      : '';
  return `Our own fine-tuned screening model reads the language in this answer as ${plain}${pct ? ` (${pct}% confidence)` : ''}${secondaryClause} — a live read of this one answer, not a label for who you are.`;
}

/** One short clause naming the dominant detected emotion in plain language,
 * so the paragraph visibly reacts to the tone the classifier actually
 * picked up rather than only the calm/neutral/distressed band. */
function emotionClause(input: ResearchComposeInput): string {
  const label = input.dominantEmotion;
  if (!label || label === 'neutral') return '';
  const score = input.dominantEmotionScore ?? 0;
  const strength = score >= 0.6 ? 'a strong, clear' : score >= 0.35 ? 'a fairly clear' : 'a quiet, underlying';
  return `The clearest emotional signal running underneath your words reads as ${strength} current of ${label} more than anything else, and that is worth naming plainly rather than smoothing over.`;
}

const OPENERS: Record<ToneFamily, { withSn: string[]; noSn: string[] }> = {
  negative: {
    withSn: [
      `Hearing you say %SN% — without dressing it up — tells me what this moment is actually costing you, and I want to start by honoring that honesty.`,
      `When you put it that way — %SN% — the weight behind the words comes through clearly, and that weight deserves to be met seriously, not brushed past.`,
      `You said %SN%, and I notice how much self-awareness it took to name it that plainly — thank you for trusting this space with something real.`,
    ],
    noSn: [
      `Thank you for pausing to look honestly at how you are doing — that check-in is itself a meaningful act of self-care, and I want to meet it with the attention it deserves.`,
      `Before anything else: showing up and answering this honestly takes quiet courage, and what you are carrying deserves to be met seriously rather than scrolled past.`,
    ],
  },
  positive: {
    withSn: [
      `Hearing you say %SN% is genuinely good news, and it deserves to be marked rather than scrolled past.`,
      `There is something quietly strong in %SN% — you are not just getting by right now, you are aware of how you are doing, and that awareness matters.`,
    ],
    noSn: [
      `Thank you for checking in with yourself this honestly — noticing your own state clearly is a skill, and it is worth honoring here.`,
    ],
  },
  even: {
    withSn: [
      `You said %SN%, and I want to honor the honest self-attention it took to report your state accurately instead of dressing it up or down.`,
      `Hearing %SN%, what stands out is the evenness of it — neither crisis nor celebration — and that flat middle deserves attention too.`,
    ],
    noSn: [
      `Thank you for reporting your state plainly — the honest middle is a real place to be, and it deserves attention just as much as the hard extremes do.`,
    ],
  },
};

const NORMALIZERS: Record<ToneFamily, string[]> = {
  negative: [
    `Validated distress measurement captures this texture of experience across thousands of people (Pilkonis et al., 2011) — a shared human state, not a personal malfunction.`,
    `And nothing about this makes you broken: trauma-informed practice reads responses like yours as adaptations to what you have been carrying, not defects in who you are (SAMHSA TIP 57).`,
  ],
  positive: [
    `And this steadiness is measurable, not luck: you sit on the healthy end of the same continuum clinical science measures distress on (Pilkonis et al., 2011).`,
    `States like this are worth taking seriously too — strengths-based practice treats noticing what works as protective infrastructure, not a pause between problems (SAMHSA TIP 57).`,
  ],
  even: [
    `And "fine" is a real position on the clinical continuum of distress and wellbeing (Gibbons et al., 2012) — not missing data, but a stable place to build from.`,
    `Nothing about the middle means you are stuck: trauma-informed practice reads an even baseline as capacity — energy and stability available to invest, not merely survive with (SAMHSA TIP 57).`,
  ],
};

const CLOSERS: Record<ToneFamily, string[]> = {
  negative: [
    `You do not need to have this figured out to deserve care with it — and looking at it directly, right here, is already doing something real for you.`,
    `There is no requirement to fix everything today; being witnessed accurately is itself a first step of relief, and we can move at your system's pace.`,
  ],
  positive: [
    `Keep doing whatever built this — and take one moment today to notice how it feels in your body, so you can return to it later.`,
    `Whatever created this steadiness is worth naming and repeating; checking in like this is exactly the habit that helps it last.`,
  ],
  even: [
    `You do not need a crisis to justify investing in your wellbeing — the stability you have now is the rarest precondition for doing it deliberately.`,
    `From here, small deliberate deposits of positivity compound; you are not waiting to feel better, you are building better from a place that can afford it.`,
  ],
};

const BRIDGES: Record<ToneFamily, { withSn: string[]; noSn: string[] }> = {
  negative: {
    withSn: [
      `From the inside of your nervous system, what you reported — %SN% — looks less like a mood and more like a protective physiology running a well-documented script.`,
      `Translated into physiology, %SN% reflects your autonomic nervous system taking a position on the ladder of states it has available — and the position it chose makes complete sense given what it is detecting.`,
    ],
    noSn: [
      `From the inside of your nervous system, what you reported looks less like a mood and more like a protective physiology running a well-documented script.`,
      `Translated into physiology, your answer reflects your autonomic nervous system taking a position on the ladder of states it has available — and the position it chose makes complete sense given what it is detecting.`,
    ],
  },
  positive: {
    withSn: [
      `From the inside of your nervous system, what you reported — %SN% — looks like a regulated physiology doing exactly what it was built to do.`,
      `Translated into physiology, %SN% reflects your autonomic nervous system sitting on the ventral-vagal rung of its ladder — the state from which connection, play, and clear thinking run.`,
    ],
    noSn: [
      `From the inside of your nervous system, what you reported looks like a regulated physiology doing exactly what it was built to do.`,
      `Translated into physiology, your answer reflects your autonomic nervous system sitting on the ventral-vagal rung of its ladder — the state from which connection, play, and clear thinking run.`,
    ],
  },
  even: {
    withSn: [
      `From the inside of your nervous system, what you reported — %SN% — looks like a regulated mid-state: not braced, not shut down, but idling on a stable platform.`,
      `Translated into physiology, %SN% reflects your autonomic nervous system holding a middle rung of its ladder — steady enough to act from, quiet enough to feel unremarkable.`,
    ],
    noSn: [
      `From the inside of your nervous system, what you reported looks like a regulated mid-state: not braced, not shut down, but idling on a stable platform.`,
      `Translated into physiology, your answer reflects your autonomic nervous system holding a middle rung of its ladder — steady enough to act from, quiet enough to feel unremarkable.`,
    ],
  },
};

const REASSURANCES: Record<ToneFamily, string[]> = {
  negative: [
    `None of this means something is wrong with you as a person; it means a measurable, well-studied physiological pattern is active — and patterns, unlike character, can be worked with.`,
    `Crucially, this is physiology, not identity: every mechanism above is reversible and responsive to the right inputs — which is why the steps below target the body first.`,
  ],
  positive: [
    `None of this is accidental: states like this are built by repeatable inputs, and naming the mechanism makes it returnable instead of random.`,
    `Crucially, this steadiness is physiology you can reinforce: every mechanism above responds to the inputs that built it — which is why the steps below focus on noticing and repeating.`,
  ],
  even: [
    `None of this means something is wrong with you: a mid-range baseline is a measurable, workable physiological position — and positions, unlike character, can be moved deliberately.`,
    `Crucially, this is physiology, not identity: the same reward and regulation circuits above respond to small scheduled inputs — which is why the steps below start small.`,
  ],
};

function fill(template: string, snippet: string): string {
  return template.replace(/%SN%/g, snippet);
}

/** Source attribution for a retrieved passage (short form when available). */
function attribution(passage: RetrievedPassage): string {
  return passage.sourceShort || passage.source.split('(')[0].trim() || 'the research literature';
}

/**
 * One evidence-grounded sentence built from a retrieved passage, phrased so it
 * reads as a citation of a real finding rather than name-dropping. Returns ''
 * when no passages were retrieved — the composers then fall back to their
 * built-in theme insights, exactly as before.
 */
function evidenceSentence(passages: RetrievedPassage[] | undefined, index: number, lead: string): string {
  if (!passages || passages.length === 0) return '';
  const passage = passages[index % passages.length];
  if (!passage?.plain) return '';
  return `${lead} ${passage.plain} (${attribution(passage)}).`;
}

/** Focus terms that add information beyond the category name itself. */
function focusPhrase(input: ResearchComposeInput): string {
  const cat = (input.category || '').toLowerCase();
  const words = (input.focus || '')
    .split(' and ')
    .map((w) => w.trim())
    .filter((w) => w && !cat.includes(w.toLowerCase()));
  return words.join(' and ');
}

/**
 * Empathetic Assessment & Reflection — one cohesive, high-detail paragraph
 * (~110-160 words) that mirrors the user's own words, validates the lived
 * experience, normalizes it through the research lens, and closes with alliance.
 */
export function composeEmpatheticParagraph(input: ResearchComposeInput): string {
  const t = THEME_INSIGHTS[input.theme] || THEME_INSIGHTS.general;
  const family = toneFamilyOf(input);
  const seed = seedFor(input, 11);
  const sn = (input.userSnippet || '').trim();
  const category = (input.category || 'your inner experience').trim().toLowerCase();

  const openerPool = sn ? OPENERS[family].withSn : OPENERS[family].noSn;
  const opener = fill(pick(openerPool, seed >> 1), sn);
  const empathySentence = pick(t.empathy, seed);
  const normalizer = pick(NORMALIZERS[family], seed >> 2);
  const focus = focusPhrase(input);
  const focusClause = focus ? ` — and specifically around ${focus},` : ',';
  const tieIn =
    family === 'positive'
      ? `It makes sense that this shows up around ${category}${focusClause} where steady routines and safe connection do their quiet work — right now it is registering ${intensityPhrase(input)}.`
      : family === 'even'
      ? `It makes sense that this sits around ${category}${focusClause} where life quietly runs on baseline — right now that baseline is registering ${intensityPhrase(input)}.`
      : `It makes sense that this speaks up around ${category}${focusClause} where load accumulates quietly before it announces itself — and right now it is registering ${intensityPhrase(input)}.`;
  const closer = pick(CLOSERS[family], seed >> 3);
  const emotion = emotionClause(input);

  return `${opener} ${empathySentence}${emotion ? ` ${emotion}` : ''} ${normalizer} ${tieIn} ${closer}`;
}

/**
 * What Is Happening In Your Nervous System — one cohesive, mechanism-level
 * paragraph (~100-145 words) grounded in the polyvagal, PROMIS, CAT-DI and
 * TIP 57 literature, tied to the user's words and screening category.
 */
export function composeNervousSystemParagraph(input: ResearchComposeInput): string {
  const t = THEME_INSIGHTS[input.theme] || THEME_INSIGHTS.general;
  const family = toneFamilyOf(input);
  const seed = seedFor(input, 29);
  const sn = (input.userSnippet || '').trim();

  const bridgePool = sn ? BRIDGES[family].withSn : BRIDGES[family].noSn;
  const bridge = fill(pick(bridgePool, seed >> 1), sn);
  const mechanism = pick(t.neuro, seed);
  const focusN = focusPhrase(input);
  const consequence = focusN
    ? `That is why it shows up for you ${manifestationClause(input.category)} — touching ${focusN} as well — registering ${intensityPhrase(input)}, not as a vague background mood.`
    : `That is why it shows up for you ${manifestationClause(input.category)} — registering ${intensityPhrase(input)}, not as a vague background mood.`;
  const reassurance = pick(REASSURANCES[family], seed >> 2);
  const evidence = evidenceSentence(
    input.retrieved,
    0,
    family === 'positive'
      ? 'Research on states like this finds that'
      : 'The research behind the mechanism above is clear:'
  );
  const nsLine = neuroscopeSentence(input);

  return `${bridge} ${mechanism}${evidence ? ` ${evidence}` : ''} ${consequence}${
    nsLine ? ` ${nsLine}` : ''
  } ${reassurance}`;
}

/**
 * Cognitive Perspective Shift — one cohesive reframe paragraph (~60-100 words)
 * that dissolves self-judgment using the research lens and points forward.
 */
export function composePerspectiveShiftParagraph(input: ResearchComposeInput): string {
  const t = THEME_INSIGHTS[input.theme] || THEME_INSIGHTS.general;
  const seed = seedFor(input, 47);

  const reframe = pick(t.reframe, seed);
  const fwd = pick(t.forward, seed >> 2);
  const forwards = [
    `So the work in front of you is not to delete ${fwd.noun} by force of will, but to ${fwd.verb}.`,
    `Put practically: the goal today is not to eliminate ${fwd.noun}, it is to ${fwd.verb} — small, physical, and repeatable.`,
  ];
  // Prefer a second (differently sourced) passage here so the reframe stands
  // on its own evidence rather than repeating the nervous-system citation.
  const evidence = evidenceSentence(input.retrieved, input.retrieved && input.retrieved.length > 1 ? 1 : 0, 'And this is documented:');

  return `${reframe}${evidence ? ` ${evidence}` : ''} ${pick(forwards, seed >> 1)}`;
}

/**
 * Lightweight theme detection so the server (and any caller without the
 * client's keyword branches) can ground the same research per topic.
 */
export function detectResearchTheme(
  lowerText: string,
  category = '',
  neuroscope?: { topStatus: string; pTop: number; band?: string } | null
): ResearchTheme {
  const l = (lowerText || '').toLowerCase();
  const c = category.toLowerCase();
  // Explicit crisis language always wins, regardless of what the model says —
  // safety detection must never depend on a single classifier being warm.
  if (/\b(kill myself|suicide|end my life|self.?harm|hurt myself|no reason to live)\b/.test(l)) return 'severe';
  // A confident, risk-flagged NeuroScope reading also forces the severe theme
  // even when the keyword scan misses it (the model's job is to catch phrasing
  // the fixed lexicon was never going to enumerate).
  if (neuroscope && (neuroscope.band === 'critical' || neuroscope.band === 'high')) return 'severe';

  const keywordTheme = ((): ResearchTheme | null => {
    if (/\b(anxi|panic|worry|nervous|tense|overwhelm|dread|racing|scared|fear)\b/.test(l) || /anxiety/.test(c))
      return 'anxious';
    if (/\b(overthink|rumina|loop|stop thinking|worst case|obsess|replay)\b/.test(l) || /thought/.test(c))
      return 'overthinking';
    if (/\b(exhaust|tired|drain|burnout|insomnia|no energy|heavy|foggy|fatigue)\b/.test(l) || /daily functioning/.test(c))
      return 'fatigued';
    if (/\b(sad|depress|empty|cry|hopeless|worthless|numb|flat|meaningless|grief)\b/.test(l) || /mood|emotion/.test(c))
      return 'numb_sad';
    if (/\b(alone|lonely|isolat|withdrawn|misunderstood|left out|abandon|burden)\b/.test(l) || /social|connect/.test(c))
      return 'disconnected';
    return null;
  })();

  if (keywordTheme) return keywordTheme;

  // Keywords found nothing specific: let the trained classifier's read of THIS
  // answer fill in the theme (when it is reasonably confident), instead of
  // always collapsing to the generic bucket.
  if (neuroscope && neuroscope.topStatus && neuroscope.pTop >= 0.35) {
    const mapped = NEUROSCOPE_THEME[neuroscope.topStatus];
    if (mapped) return mapped;
  }

  return 'general';
}

/**
 * Compact research digest injected into the LLM prompt so API-generated
 * responses are grounded in the same source library as the local engine.
 *
 * `retrieved` is optional: when the client (or the server's keyword fallback)
 * has semantically matched passages from `src/data/researchCorpus.ts` against
 * this user's own answer, those passages are appended as an ANSWER-SPECIFIC
 * EVIDENCE block so the model cites the literature that actually applies
 * here instead of the same generic digest every time.
 */
export function buildResearchBrief(theme?: ResearchTheme, retrieved?: RetrievedPassage[]): string {
  const base = `RESEARCH GROUNDING (distilled from the project source library — draw on these in plain language wherever they genuinely fit, never as name-dropping):
- Polyvagal Theory (Porges, 2007, Biological Psychology): "neuroception" = below-awareness neural detection of safety vs danger; a three-rung autonomic ladder (ventral-vagal social engagement -> sympathetic mobilization fight/flight -> dorsal-vagal immobilization/shutdown); the myelinated "vagal brake" calms the heart and dampens stress physiology; autonomic STATE is the platform for behavior, and states move; co-regulation — one regulated nervous system helps settle another.
- PROMIS emotional-distress item banks (Pilkonis et al., 2011, Assessment): depression's most discriminating indicators are hopelessness, worthlessness, helplessness felt as different from one's usual self; anxiety's are sudden panic, pounding/racing heart, dread that something bad will happen; anger's are persistent, explosive temper; distress sits on a measurable continuum, not a switch.
- CAT-DI / bifactor measurement (Gibbons et al., 2012, Arch Gen Psychiatry): distress expresses across subdomains — mood, cognition, behavior, somatic — severity is dimensional, and the patient's own report is the primary valid evidence.
- SAMHSA TIP 57 (2014), Trauma-Informed Care in Behavioral Health Services: symptoms are creative adaptations and survival strategies, not defects; physical, emotional and psychological safety come first; hypervigilance, avoidance and self-medication are coping logic that made sense in context; care must be strengths-based and recovery-oriented.`;

  const passages = (retrieved || []).filter((p) => p && p.text).slice(0, 4);
  if (passages.length === 0) return base;

  const block = passages
    .map((p, i) => {
      const label = p.kind === 'book' ? 'BOOK' : 'PAPER';
      const themeTag = theme && p.theme === theme ? ' [matches this answer\'s theme]' : '';
      return `[${i + 1}] (${label}) ${p.source}${themeTag}\n    Finding: ${p.text}\n    Say it plainly: ${p.plain}`;
    })
    .join('\n');

  return `${base}

ANSWER-SPECIFIC EVIDENCE (retrieved from the project research corpus for THIS user's exact words${theme ? `, theme: ${theme}` : ''} — prefer these findings over generic references, cite the source briefly and in plain language where it genuinely supports the response):
${block}`;
}

/** Strict formatting rules for the three core sections, shared by all providers. */
export function buildSectionFormatRules(): string {
  return `STRICT FORMAT RULES FOR THE THREE CORE SECTIONS:
- 'conversationalEmpathy' (Empathetic Assessment & Reflection): exactly ONE cohesive paragraph of 110-160 words. Open by mirroring the user's OWN words back naturally, validate the lived experience with real warmth, normalize it without minimizing, and close with alliance ("we", "you don't have to fix this alone"). High detail, zero filler, no bullet points, no line breaks.
- 'detailedAnalysis' (What Is Happening In Your Nervous System): exactly ONE cohesive paragraph of 100-145 words. Explain the psychology AND the body-level mechanism behind their exact reported experience, grounded in the RESEARCH GROUNDING above (name the mechanism in plain language, e.g. "in polyvagal terms, your neuroception is..."), say where it shows up in their life, and end by separating physiology from identity ("this is a state/pattern, not who you are"). No bullet points, no line breaks.
- 'perspectiveShift' (Cognitive Perspective Shift): exactly ONE cohesive paragraph of 60-100 words. A transformative reframe that dissolves guilt/shame/self-judgment, backed by the research lens (adaptation not defect; state not trait; continuum not switch), ending with one concrete forward-looking sentence. No bullet points, no line breaks.
- All three MUST be freshly composed from THIS user's THIS answer and THIS question: reference their actual words or the question's topic, and never reuse a canned paragraph. Two different answers must produce visibly different paragraphs in all three sections.
- In 'detailedAnalysis', ground the mechanism in ONE finding from the ANSWER-SPECIFIC EVIDENCE block when it is present, attributed briefly and in plain language (e.g. "research on response styles shows...", "sleep research finds..."). Never list sources as a bibliography, never stack more than one citation in a paragraph, and never invent a study that is not in the evidence block.`;
}
