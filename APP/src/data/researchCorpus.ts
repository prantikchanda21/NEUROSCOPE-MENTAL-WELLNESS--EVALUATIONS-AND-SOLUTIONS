import type { ResearchTheme } from '../utils/researchKnowledge.js';

/**
 * Expanded research corpus — the retrieved-evidence layer behind every
 * personalized solution.
 *
 * Four peer-reviewed papers (the project's original source library) plus
 * eleven clinical/neuroscience books, distilled into short, retrievable
 * passages. Each passage is a PARAPHRASED distillation of the source's
 * finding (never a verbatim quote) written so it can be:
 *   - fused into an LLM prompt as grounding evidence (`text`), and
 *   - shown directly to a user as a plain-language line (`plain`).
 *
 * Passages are retrieved semantically at request time (see
 * `src/utils/researchRetrieval.ts`): the user's own answer is embedded with
 * all-MiniLM-L6-v2 and matched against each passage's `keywords`+`text`
 * vector, with a keyword-overlap fallback when the transformer runtime is
 * unavailable. Retrieval keeps solutions grounded in the literature the user
 * asked for instead of relying on the model's memory of it.
 */

export interface ResearchPassage {
  id: string;
  /** Key into CORPUS_SOURCES. */
  sourceKey: keyof typeof CORPUS_SOURCES;
  /** Full citation, printed when the passage is surfaced. */
  source: string;
  kind: 'paper' | 'book';
  theme: ResearchTheme;
  /** Research statement used for prompt grounding (paraphrased, not quoted). */
  text: string;
  /** Plain-language sentence a user can read without any jargon. */
  plain: string;
  keywords: string[];
}

export const CORPUS_SOURCES = {
  PORGES: {
    short: 'Porges (2007)',
    full: 'Porges, S.W. (2007). The Polyvagal Perspective. Biological Psychology, 74(2), 116-143',
    kind: 'paper' as const,
    about: 'Polyvagal theory: neuroception, the autonomic ladder, and co-regulation',
  },
  PILKONIS: {
    short: 'Pilkonis et al. (2011)',
    full: 'Pilkonis, P.A. et al. (2011). Item Banks for Measuring Emotional Distress From the PROMIS: Depression, Anxiety, and Anger. Assessment, 18(3), 263-283',
    kind: 'paper' as const,
    about: 'Which symptoms actually discriminate depression, anxiety and anger',
  },
  GIBBONS: {
    short: 'Gibbons et al. (2012)',
    full: 'Gibbons, R.D. et al. (2012). Development of a Computerized Adaptive Test for Depression. Archives of General Psychiatry, 69(11), 1104-1112',
    kind: 'paper' as const,
    about: 'CAT-DI: distress as a dimensional, multi-subdomain continuum',
  },
  TIP57: {
    short: 'SAMHSA TIP 57 (2014)',
    full: 'SAMHSA (2014). Trauma-Informed Care in Behavioral Health Services. Treatment Improvement Protocol (TIP) Series No. 57',
    kind: 'paper' as const,
    about: 'Symptoms as adaptations; safety, trust and strengths before technique',
  },
  VANDERKOLK: {
    short: 'van der Kolk (2014)',
    full: 'van der Kolk, B.A. (2014). The Body Keeps the Score: Brain, Mind, and Body in the Healing of Trauma',
    kind: 'book' as const,
    about: 'The body keeps score: somatic memory, window of tolerance, and why talk alone is not enough',
  },
  SIEGEL: {
    short: 'Siegel (2010)',
    full: 'Siegel, D.J. (2010). Mindsight: The New Science of Personal Transformation',
    kind: 'book' as const,
    about: 'Integration, name-it-to-tame-it, and the wheel of awareness',
  },
  LINEHAN: {
    short: 'Linehan (1993)',
    full: 'Linehan, M.M. (1993). Skills Training Manual for Treating Borderline Personality Disorder',
    kind: 'book' as const,
    about: 'DBT skills: distress tolerance, emotion regulation, and radical acceptance',
  },
  SAPOLSKY: {
    short: 'Sapolsky (1994)',
    full: 'Sapolsky, R.M. (1994). Why Zebras Don\'t Get Ulcers: The Acclaimed Guide to Stress, Stress-Related Diseases, and Coping',
    kind: 'book' as const,
    about: 'Chronic stress physiology: why psychological stressors run the same machinery as physical ones',
  },
  WALKER: {
    short: 'Walker (2017)',
    full: 'Walker, M.P. (2017). Why We Sleep: Unlocking the Power of Sleep and Dreams',
    kind: 'book' as const,
    about: 'Sleep architecture, REM emotional processing, and the cost of sleep debt',
  },
  NOLEN: {
    short: 'Nolen-Hoeksema (2003)',
    full: 'Nolen-Hoeksema, S. (2003). Women Who Think Too Much: How to Break Free of Overthinking and Reclaim Your Life',
    kind: 'book' as const,
    about: 'Response styles theory: rumination versus distraction and problem-solving',
  },
  SELIGMAN: {
    short: 'Seligman (2006)',
    full: 'Seligman, M.E.P. (2006). Learned Optimism: How to Change Your Mind and Your Life',
    kind: 'book' as const,
    about: 'Explanatory style, learned helplessness, and disputing pessimistic thinking',
  },
  KABATZINN: {
    short: 'Kabat-Zinn (1990)',
    full: 'Kabat-Zinn, J. (1990). Full Catastrophe Living: Using the Wisdom of Your Body and Mind to Face Stress, Pain, and Illness',
    kind: 'book' as const,
    about: 'Mindfulness-based stress reduction: present-moment awareness and the 3-minute breathing space',
  },
  BURNS: {
    short: 'Burns (1980)',
    full: 'Burns, D.D. (1980). Feeling Good: The New Mood Therapy',
    kind: 'book' as const,
    about: 'Cognitive distortions and behavioral activation in low mood',
  },
  EMMONS: {
    short: 'Emmons (2007)',
    full: 'Emmons, R.A. (2007). Thanks! How the New Science of Gratitude Can Make You Happier',
    kind: 'book' as const,
    about: 'Gratitude as a trainable, measurable contributor to wellbeing',
  },
  MATE: {
    short: 'Maté (2003)',
    full: 'Maté, G. (2003). When the Body Says No: Understanding the Stress-Disease Connection',
    kind: 'book' as const,
    about: 'Suppressed emotion, people-pleasing, and the physiology of chronic self-neglect',
  },
} as const;

const PORGES = CORPUS_SOURCES.PORGES.full;
const PILKONIS = CORPUS_SOURCES.PILKONIS.full;
const GIBBONS = CORPUS_SOURCES.GIBBONS.full;
const TIP57 = CORPUS_SOURCES.TIP57.full;
const VANDERKOLK = CORPUS_SOURCES.VANDERKOLK.full;
const SIEGEL = CORPUS_SOURCES.SIEGEL.full;
const LINEHAN = CORPUS_SOURCES.LINEHAN.full;
const SAPOLSKY = CORPUS_SOURCES.SAPOLSKY.full;
const WALKER = CORPUS_SOURCES.WALKER.full;
const NOLEN = CORPUS_SOURCES.NOLEN.full;
const SELIGMAN = CORPUS_SOURCES.SELIGMAN.full;
const KABATZINN = CORPUS_SOURCES.KABATZINN.full;
const BURNS = CORPUS_SOURCES.BURNS.full;
const EMMONS = CORPUS_SOURCES.EMMONS.full;
const MATE = CORPUS_SOURCES.MATE.full;

export const RESEARCH_CORPUS: ResearchPassage[] = [
  // ======================= ANXIOUS =======================
  {
    id: 'porges-neuroception-alarm',
    sourceKey: 'PORGES',
    source: PORGES,
    kind: 'paper',
    theme: 'anxious',
    text: 'Neuroception is the nervous system\'s below-awareness evaluation of safety, danger and life threat; when it reads danger, the sympathetic branch mobilizes — heart rate rises, breath goes shallow and high, muscles pre-load — before any conscious thought about the situation occurs.',
    plain: 'Your body can sound the alarm before your mind knows why — that is neuroception doing its job too eagerly, not you overreacting.',
    keywords: ['anxiety', 'panic', 'alert', 'danger', 'heart racing', 'chest tight', 'hypervigilance', 'on edge', 'somatic arousal'],
  },
  {
    id: 'porges-vagal-brake',
    sourceKey: 'PORGES',
    source: PORGES,
    kind: 'paper',
    theme: 'anxious',
    text: 'The myelinated ventral-vagal pathway acts as a "vagal brake" on the heart; when that brake is withdrawn, sympathetic arousal recycles even in objectively safe settings, because the brake is what normally keeps arousal from escalating.',
    plain: 'Extended exhales re-engage the vagal brake — the built-in calming pathway that slows the heart and stands the alarm down.',
    keywords: ['breathing', 'exhale', 'vagus', 'calm down', 'slow heart rate', 'panic', 'anxiety', 'breathwork'],
  },
  {
    id: 'pilkonis-anxiety-signals',
    sourceKey: 'PILKONIS',
    source: PILKONIS,
    kind: 'paper',
    theme: 'anxious',
    text: 'The most statistically discriminating anxiety indicators in the PROMIS item bank are sudden episodes of intense fear, a pounding or racing heart, and a persistent sense that something bad is about to happen — which is why dread and somatic arousal, not worry alone, carry the strongest signal.',
    plain: 'Racing heart and dread are the core, best-validated signs of anxiety — not a lack of willpower.',
    keywords: ['panic attack', 'pounding heart', 'dread', 'fear', 'anxiety', 'sudden fear', 'worried'],
  },
  {
    id: 'sapolsky-same-machinery',
    sourceKey: 'SAPOLSKY',
    source: SAPOLSKY,
    kind: 'book',
    theme: 'anxious',
    text: 'The human stress response evolved for acute physical emergencies but is triggered just as powerfully by purely psychological anticipation; the same glucocorticoid and catecholamine machinery floods the body for a deadline or a social threat as for a physical predator, and it is the duration of that activation — not the trigger — that causes damage.',
    plain: 'Worrying about something burns the same stress chemistry as physically facing it — the body does not distinguish the two.',
    keywords: ['stress', 'anxiety', 'cortisol', 'worry', 'tension', 'on edge', 'chronic stress', 'burned out'],
  },
  {
    id: 'kabatzinn-present-moment-anxiety',
    sourceKey: 'KABATZINN',
    source: KABATZINN,
    kind: 'book',
    theme: 'anxious',
    text: 'Anxiety is largely generated by anticipatory thinking — the mind rehearsing a future that has not arrived; deliberately returning attention to present-moment sensation interrupts that forward projection, since the body in the actual present is almost always safer than the imagined future.',
    plain: 'Anxiety lives in the imagined future; the fastest exit is deliberately returning to what your senses are reporting right now.',
    keywords: ['anxiety', 'worry', 'future', 'what if', 'grounding', 'mindfulness', 'present', 'catastrophe'],
  },
  {
    id: 'vanderkolk-window-of-tolerance',
    sourceKey: 'VANDERKOLK',
    source: VANDERKOLK,
    kind: 'book',
    theme: 'anxious',
    text: 'Trauma survivors live with a narrowed window of tolerance: arousal that would be ordinary for others tips quickly into hyperarousal (agitation, panic, hypervigilance) because the nervous system\'s baseline threat calibration was set by past experience, not by present facts.',
    plain: 'A nervous system shaped by hard experience responds to small triggers with big alarms — a calibration issue, not a character flaw.',
    keywords: ['hypervigilance', 'triggered', 'overreact', 'panic', 'anxiety', 'trauma', 'on guard', 'unsafe'],
  },
  {
    id: 'mate-anxiety-suppressed',
    sourceKey: 'MATE',
    source: MATE,
    kind: 'book',
    theme: 'anxious',
    text: 'Chronic anxiety frequently reflects an unresolved conflict between authentic feeling and the need to maintain attachment or approval; when self-assertion is chronically suppressed to keep peace, the body sustains a low-grade alarm that no amount of reassurance resolves.',
    plain: 'Anxiety often signals something unsaid — a need or boundary you have been keeping quiet to keep the peace.',
    keywords: ['anxiety', 'people pleasing', 'boundaries', 'saying no', 'anger', 'suppressed', 'approval', 'resentment'],
  },

  // ======================= OVERTHINKING =======================
  {
    id: 'nolen-rumination-response-style',
    sourceKey: 'NOLEN',
    source: NOLEN,
    kind: 'book',
    theme: 'overthinking',
    text: 'Response-styles research shows rumination — passively and repetitively focusing on distress and its causes — predicts longer and more severe depressive episodes, whereas active distraction followed by concrete problem-solving shortens them; rumination masquerades as useful analysis while producing no decisions.',
    plain: 'Overthinking feels like problem-solving but is the opposite: it lengthens distress, while a real decision or a deliberate distraction shortens it.',
    keywords: ['overthinking', 'rumination', 'loops', 'can\'t stop thinking', 'analysis paralysis', 'replaying', 'spiraling'],
  },
  {
    id: 'gibbons-cognition-subdomain',
    sourceKey: 'GIBBONS',
    source: GIBBONS,
    kind: 'paper',
    theme: 'overthinking',
    text: 'In the CAT-DI bifactor model, cognitive symptoms — difficulty concentrating, indecisiveness, slowed thinking, self-criticism — form a distinct subdomain of depression severity, meaning mental loop exhaustion is a measured severity signal in its own right and not merely a side effect of low mood.',
    plain: 'Fog, indecision and endless self-review are a measured part of the distress picture, not a personal failing.',
    keywords: ['concentration', 'decisions', 'brain fog', 'overthinking', 'self-criticism', 'mental fatigue'],
  },
  {
    id: 'siegel-name-it-to-tame-it',
    sourceKey: 'SIEGEL',
    source: SIEGEL,
    kind: 'book',
    theme: 'overthinking',
    text: 'Affect labeling — putting a felt state into precise words — engages right ventrolateral prefrontal circuits that measurably dampen amygdala reactivity; the observing capacity this creates allows a thought to be witnessed as an event rather than obeyed as an instruction.',
    plain: 'Naming a thought or feeling precisely calms the brain\'s alarm centre and creates distance between you and the thought.',
    keywords: ['naming feelings', 'labeling', 'overthinking', 'amygdala', 'mindfulness', 'observing thoughts', 'journal'],
  },
  {
    id: 'kabatzinn-thoughts-are-not-facts',
    sourceKey: 'KABATZINN',
    source: KABATZINN,
    kind: 'book',
    theme: 'overthinking',
    text: 'Mindfulness practice treats thoughts as passing mental events rather than facts or commands: the instruction is to notice a thought as a thought, without arguing with its content or acting on it, which disengages the loop instead of feeding it with rebuttals.',
    plain: 'You do not have to argue with a thought to be free of it — noticing "this is a thought" is enough to step out of the loop.',
    keywords: ['thoughts', 'overthinking', 'mindfulness', 'observing', 'meditation', 'loop', 'intrusive'],
  },
  {
    id: 'burns-cognitive-distortions',
    sourceKey: 'BURNS',
    source: BURNS,
    kind: 'book',
    theme: 'overthinking',
    text: 'Cognitive therapy identifies recurring distortions — catastrophizing, all-or-nothing thinking, mind-reading, should-statements — as the fuel of mental loops; the effective intervention is not to stop thinking but to write the thought down and test it against evidence.',
    plain: 'Overthinking usually runs on a handful of repeat distortions; writing the thought down and checking it against the facts breaks the loop.',
    keywords: ['cognitive distortion', 'catastrophizing', 'negative thoughts', 'all or nothing', 'self-criticism', 'overthinking'],
  },
  {
    id: 'seligman-dispute-pessimism',
    sourceKey: 'SELIGMAN',
    source: SELIGMAN,
    kind: 'book',
    theme: 'overthinking',
    text: 'Explanatory style shapes vulnerability: attributing setbacks to permanent, pervasive, personal causes predicts helplessness, while the same setbacks explained as temporary, specific and situational predict persistence — and explanatory style is changeable through disputation practice.',
    plain: 'How you explain a setback changes what happens next — and that explanatory habit can be retrained.',
    keywords: ['pessimism', 'hopeless thinking', 'explanations', 'self-blame', 'helplessness', 'rumination', 'optimism'],
  },

  // ======================= FATIGUED =======================
  {
    id: 'porges-dorsal-shutdown',
    sourceKey: 'PORGES',
    source: PORGES,
    kind: 'paper',
    theme: 'fatigued',
    text: 'When mobilization fails or threat is inescapable, the dorsal-vagal circuit produces hypo-arousal: conservation of energy, blunted affect, heaviness, and reduced capacity for social engagement — a protective shutdown rather than a loss of will.',
    plain: 'Deep fatigue with flatness is the nervous system\'s protective shutdown setting, not laziness or weakness.',
    keywords: ['exhaustion', 'shutdown', 'numb', 'no energy', 'heaviness', 'freeze', 'can\'t function', 'burnout'],
  },
  {
    id: 'sapolsky-cortisol-energy',
    sourceKey: 'SAPOLSKY',
    source: SAPOLSKY,
    kind: 'book',
    theme: 'fatigued',
    text: 'Prolonged glucocorticoid elevation mobilizes glucose for immediate action while suppressing digestion, immunity, growth and repair; sustained over a long period the same system produces fatigue, poor sleep, impaired memory and reduced immune function — the body borrowing against its own reserves.',
    plain: 'Long-running stress drains energy and repair systems — the exhaustion is a physiological debt, not a mindset.',
    keywords: ['burnout', 'exhaustion', 'fatigue', 'overworked', 'stress', 'sleep', 'drained', 'tired all the time'],
  },
  {
    id: 'walker-sleep-debt',
    sourceKey: 'WALKER',
    source: WALKER,
    kind: 'book',
    theme: 'fatigued',
    text: 'Sleep loss degrades prefrontal function, emotional regulation and memory consolidation, and the deficit accumulates: after several nights of restriction subjective alertness partially adapts while objective performance continues to fall, which is why chronically under-slept people under-report how impaired they are.',
    plain: 'Sleep debt quietly degrades mood, focus and emotional control, and you will feel less impaired than you actually are.',
    keywords: ['sleep', 'insomnia', 'tired', 'fatigue', 'no energy', 'sleep debt', 'waking up', 'restless'],
  },
  {
    id: 'walker-rem-emotional-processing',
    sourceKey: 'WALKER',
    source: WALKER,
    kind: 'book',
    theme: 'fatigued',
    text: 'REM sleep performs overnight emotional triage: it appears to strip the affective charge from difficult memories while preserving their content, which is why sleep loss leaves emotionally significant material feeling raw and unresolved the following day.',
    plain: 'Sleep is when the emotional charge of the day gets processed — cutting it short leaves feelings raw.',
    keywords: ['sleep', 'emotional processing', 'mood', 'irritable', 'raw', 'grief', 'bad dreams', 'rest'],
  },
  {
    id: 'tip57-rest-as-safety',
    sourceKey: 'TIP57',
    source: TIP57,
    kind: 'paper',
    theme: 'fatigued',
    text: 'Trauma-informed practice sequences stabilization before change: establishing physical and emotional safety, then pacing, then integration. Pushing processing or productivity before safety is established reliably destabilizes, which is why rest and pacing are clinical interventions rather than indulgences.',
    plain: 'In trauma-informed care, safety and pacing come first — rest is a real clinical step, not a reward you must earn.',
    keywords: ['rest', 'pacing', 'burnout', 'exhaustion', 'overwhelmed', 'safety first', 'too much', 'recovery'],
  },
  {
    id: 'kabatzinn-body-scan-rest',
    sourceKey: 'KABATZINN',
    source: KABATZINN,
    kind: 'book',
    theme: 'fatigued',
    text: 'Mindfulness-based stress reduction trains attention on bodily sensation without judgment; in depleted states this is restorative rather than effortful because it replaces rumination and resistance with direct proprioceptive attention, which down-regulates the stress response.',
    plain: 'A few minutes of simply feeling your body — without fixing anything — reverses the stress response more than forcing yourself to push on.',
    keywords: ['body scan', 'rest', 'relaxation', 'tension', 'fatigue', 'meditation', 'stress', 'recovery'],
  },

  // ======================= NUMB / SAD =======================
  {
    id: 'pilkonis-depression-signals',
    sourceKey: 'PILKONIS',
    source: PILKONIS,
    kind: 'paper',
    theme: 'numb_sad',
    text: 'The most discriminating depression items in PROMIS are hopelessness, worthlessness, helplessness and feeling that nothing matters — experienced as markedly different from one\'s usual self — followed by anhedonia and low energy.',
    plain: 'Hopelessness and worthlessness are the strongest measurable signs of depression — a medical picture, not a moral one.',
    keywords: ['depression', 'hopeless', 'worthless', 'empty', 'nothing matters', 'can\'t enjoy', 'numb', 'sad'],
  },
  {
    id: 'burns-behavioral-activation',
    sourceKey: 'BURNS',
    source: BURNS,
    kind: 'book',
    theme: 'numb_sad',
    text: 'In low mood, action precedes motivation rather than following it: behavioral activation schedules small, concrete activities independent of how the person feels, and mood typically improves afterward — meaning waiting to "feel like it" is the mechanism that maintains the depression.',
    plain: 'In low mood, motivation never arrives first — small scheduled actions come first and mood follows.',
    keywords: ['depression', 'no motivation', 'numb', 'anhedonia', 'stuck', 'apathy', 'can\'t start anything'],
  },
  {
    id: 'vanderkolk-emotion-in-body',
    sourceKey: 'VANDERKOLK',
    source: VANDERKOLK,
    kind: 'book',
    theme: 'numb_sad',
    text: 'Traumatic and depressive states are stored as somatic patterns, not only as ideas: numbing, breathing restriction and chronic muscle tension are the body\'s way of not feeling what the mind cannot yet process, and bodily interventions (breath, movement, rhythm) are needed alongside talking.',
    plain: 'Numbness is stored in the body, so reconnecting through breath and movement often works where thinking alone does not.',
    keywords: ['numb', 'disconnected from body', 'tension', 'breathing', 'depression', 'feel nothing', 'dissociation'],
  },
  {
    id: 'mate-suppressed-grief',
    sourceKey: 'MATE',
    source: MATE,
    kind: 'book',
    theme: 'numb_sad',
    text: 'Emotional suppression maintained across years — grief that was never allowed, anger that was never expressed — shows up somatically as chronic fatigue, immune dysregulation and depression; the body says no when the person cannot.',
    plain: 'Feelings kept down for years do not disappear; they surface as fatigue and low mood because the body carries what the mind defers.',
    keywords: ['grief', 'suppressed sadness', 'crying', 'numb', 'depression', 'holding it in', 'breakdown'],
  },
  {
    id: 'tip57-adaptations-not-defects',
    sourceKey: 'TIP57',
    source: TIP57,
    kind: 'paper',
    theme: 'numb_sad',
    text: 'Trauma-informed care reframes symptoms as creative adaptations and survival strategies rather than defects: hypervigilance, avoidance, numbing and self-medication all made sense in the context that produced them, and recovery work is strengths-based and sequenced, not judgmental.',
    plain: 'Everything you learned to do to survive made sense in its context — recovery starts from that respect, not from blame.',
    keywords: ['shame', 'self-blame', 'depression', 'avoidance', 'coping', 'survival', 'why am i like this'],
  },
  {
    id: 'seligman-learned-helplessness',
    sourceKey: 'SELIGMAN',
    source: SELIGMAN,
    kind: 'book',
    theme: 'numb_sad',
    text: 'Learned helplessness arises when a person experiences outcomes as uncontrollable, producing passivity even when escape later becomes possible; the antidote is restoring genuine, small experiences of control and mastery, which re-teach the nervous system that action matters.',
    plain: 'When nothing you did seemed to matter, giving up is a learned response — and small regained control un-learns it.',
    keywords: ['helpless', 'hopeless', 'giving up', 'passive', 'depression', 'nothing works', 'pointless'],
  },

  // ======================= DISCONNECTED =======================
  {
    id: 'porges-co-regulation',
    sourceKey: 'PORGES',
    source: PORGES,
    kind: 'paper',
    theme: 'disconnected',
    text: 'Nervous systems co-regulate: a calm, prosocial nervous system sends safety cues — prosody, facial expression, gaze, breathing rate — that directly settle another person\'s physiology. Co-regulation is therefore the biological mechanism by which human contact reduces distress, not merely emotional support.',
    plain: 'Being near a calm person physically settles your nervous system — connection is biology, not just comfort.',
    keywords: ['lonely', 'alone', 'support', 'connection', 'reaching out', 'co-regulation', 'isolated', 'no one understands'],
  },
  {
    id: 'porges-social-engagement-system',
    sourceKey: 'PORGES',
    source: PORGES,
    kind: 'paper',
    theme: 'disconnected',
    text: 'The social-engagement system — face, voice, listening, and the myelinated vagal pathways that make approach behavior possible — goes offline when neuroception reads the social world as risky, so reaching out feels most dangerous exactly when it is most needed.',
    plain: 'When connection feels terrifying, that is the social-engagement system going quiet — the safety it needs comes from small, low-stakes contact.',
    keywords: ['social anxiety', 'can\'t reach out', 'isolated', 'fear of people', 'withdrawn', 'lonely', 'trust'],
  },
  {
    id: 'vanderkolk-social-pain',
    sourceKey: 'VANDERKOLK',
    source: VANDERKOLK,
    kind: 'book',
    theme: 'disconnected',
    text: 'Social exclusion and rejection activate overlapping neural regions with physical pain, which is why ostracism and loneliness are felt somatically — and why restoring relational safety, not merely reframing thoughts, is required for relief.',
    plain: 'Rejection and loneliness register in the brain as physical pain — the ache is real, and it needs relational safety to heal.',
    keywords: ['lonely', 'rejected', 'excluded', 'abandoned', 'hurt', 'no friends', 'left out', 'misunderstood'],
  },
  {
    id: 'linehan-interpersonal-effectiveness',
    sourceKey: 'LINEHAN',
    source: LINEHAN,
    kind: 'book',
    theme: 'disconnected',
    text: 'DBT interpersonal-effectiveness skills train asking clearly for what is needed and saying no while protecting the relationship and self-respect — treating relational competence as a learnable set of behaviors rather than a personality trait.',
    plain: 'Asking for what you need and holding a boundary are learnable skills, not personality traits you either have or lack.',
    keywords: ['relationships', 'asking for help', 'boundaries', 'saying no', 'conflict', 'friendship', 'lonely'],
  },
  {
    id: 'mate-attachment-self-neglect',
    sourceKey: 'MATE',
    source: MATE,
    kind: 'book',
    theme: 'disconnected',
    text: 'When early attachment required suppressing one\'s own needs to preserve the bond, the adult pattern becomes compulsive caregiving and difficulty receiving: needs go unmet not because they are unworthy but because attending to them was learned as dangerous.',
    plain: 'If your needs were once unsafe to have, tending to them now takes deliberate practice — the difficulty is learned, not earned.',
    keywords: ['can\'t receive', 'people pleasing', 'put others first', 'lonely', 'unworthy', 'relationships', 'self-neglect'],
  },
  {
    id: 'siegel-integration-relationships',
    sourceKey: 'SIEGEL',
    source: SIEGEL,
    kind: 'book',
    theme: 'disconnected',
    text: 'Integration — linking differentiated parts of experience, including other people\'s minds and one\'s own — underlies both mental health and satisfying relationships; isolation narrows integration, while attuned relationships restore it by creating a shared, regulated state.',
    plain: 'Attuned relationships literally restore mental integration — isolation narrows it, connection widens it back.',
    keywords: ['lonely', 'connection', 'integration', 'attunement', 'relationships', 'isolated', 'understood'],
  },

  // ======================= NEUTRAL =======================
  {
    id: 'gibbons-dimensional-continuum',
    sourceKey: 'GIBBONS',
    source: GIBBONS,
    kind: 'paper',
    theme: 'neutral',
    text: 'CAT-DI models depression severity dimensionally rather than categorically, with the patient\'s own report as the primary valid evidence; a mid-range position is a real, measurable point on the continuum and the most responsive place from which to move.',
    plain: 'Feeling "fine" is a real, measurable place on the same continuum as distress — and the best place to build from.',
    keywords: ['fine', 'okay', 'average', 'neutral', 'stable', 'nothing wrong', 'middling'],
  },
  {
    id: 'seligman-positive-psychology-build',
    sourceKey: 'SELIGMAN',
    source: SELIGMAN,
    kind: 'book',
    theme: 'neutral',
    text: 'Wellbeing is not the mere absence of symptoms: it is built from separate, trainable elements — positive emotion, engagement, meaning, relationships and accomplishment — so raising a neutral baseline means adding deliberate inputs rather than removing problems.',
    plain: 'Feeling okay is not the finish line — deliberately adding engagement, meaning and connection raises the baseline further.',
    keywords: ['wellbeing', 'meaning', 'flourishing', 'neutral', 'motivation', 'fine', 'improve mood'],
  },
  {
    id: 'emmons-gratitude-practice',
    sourceKey: 'EMMONS',
    source: EMMONS,
    kind: 'book',
    theme: 'neutral',
    text: 'Randomized studies of gratitude journaling find measurable increases in wellbeing and sleep quality and reductions in reported physical symptoms — the effect comes from systematic, specific noticing, not from mood-dependent feeling.',
    plain: 'A regular, specific gratitude note measurably lifts wellbeing and sleep — the practice works regardless of current mood.',
    keywords: ['gratitude', 'journaling', 'positive', 'wellbeing', 'appreciation', 'fine', 'okay'],
  },
  {
    id: 'kabatzinn-savoring',
    sourceKey: 'KABATZINN',
    source: KABATZINN,
    kind: 'book',
    theme: 'neutral',
    text: 'Mindfulness cultivates the capacity to be present for pleasant experience without grasping at it or hurrying past it — which is precisely what allows a stable period to register and be remembered rather than passing unnoticed.',
    plain: 'Noticing a good, ordinary moment on purpose is what lets it register — otherwise it passes unremembered.',
    keywords: ['noticing', 'savoring', 'present', 'mindfulness', 'neutral', 'fine', 'good moment'],
  },

  // ======================= CALM =======================
  {
    id: 'porges-ventral-state',
    sourceKey: 'PORGES',
    source: PORGES,
    kind: 'paper',
    theme: 'calm',
    text: 'The ventral-vagal state supports social engagement, flexible attention, and restorative physiology; autonomic state is the platform from which behavior emerges, so a regulated state is not a pause between problems but the condition that makes growth, creativity and connection possible.',
    plain: 'A calm state is not the absence of problems — it is the platform that makes growth and connection possible.',
    keywords: ['calm', 'settled', 'grounded', 'balanced', 'good', 'stable', 'peaceful'],
  },
  {
    id: 'gibbons-measured-wellbeing',
    sourceKey: 'GIBBONS',
    source: GIBBONS,
    kind: 'paper',
    theme: 'calm',
    text: 'Because distress and wellbeing are measured on one dimensional continuum, low distress scores are not merely the absence of a problem: they are the healthy end of the measured range, and stable low readings predict better functional outcomes than intermittent fluctuation.',
    plain: 'Feeling well measures as genuinely healthy on the clinical continuum — steadiness is an outcome, not luck.',
    keywords: ['well', 'healthy', 'calm', 'stable', 'doing good', 'fine', 'resilient'],
  },
  {
    id: 'emmons-noticing-sustains',
    sourceKey: 'EMMONS',
    source: EMMONS,
    kind: 'book',
    theme: 'calm',
    text: 'Gains from positive practices fade when they stop being practiced: gratitude and savoring interventions show benefits while maintained and return toward baseline when discontinued, so a good period is best treated as something to reinvest in rather than bank passively.',
    plain: 'The habits that built a good period need to keep being practiced for it to last — steadiness is maintained, not stored.',
    keywords: ['keep it up', 'maintain', 'sustainable', 'calm', 'good habits', 'gratitude', 'balance'],
  },
  {
    id: 'kabatzinn-informal-practice',
    sourceKey: 'KABATZINN',
    source: KABATZINN,
    kind: 'book',
    theme: 'calm',
    text: 'MBSR formalizes practice into daily life through short structured exercises — the three-minute breathing space, body scan, mindful walking — on the premise that regulation is a trainable capacity reinforced by brief, frequent repetitions rather than rare long sessions.',
    plain: 'Brief, frequent moments of deliberate attention build lasting steadiness better than occasional long practice.',
    keywords: ['habit', 'practice', 'meditation', 'routine', 'calm', 'sustainable', 'breathing space'],
  },

  // ======================= SEVERE =======================
  {
    id: 'tip57-safety-first-crisis',
    sourceKey: 'TIP57',
    source: TIP57,
    kind: 'paper',
    theme: 'severe',
    text: 'In crisis, trauma-informed care prioritizes physical and emotional safety, connection and stabilization ahead of any processing or problem-solving; the presence of a safe, caring other person is the first intervention, and technical work is deferred until safety is established.',
    plain: 'When things are this heavy, safety and human connection come first — everything else can wait.',
    keywords: ['crisis', 'suicidal', 'can\'t cope', 'unsafe', 'emergency', 'need help now', 'end my life'],
  },
  {
    id: 'pilkonis-severity-support-signal',
    sourceKey: 'PILKONIS',
    source: PILKONIS,
    kind: 'paper',
    theme: 'severe',
    text: 'Validated distress measures flag the highest severity levels through combinations of hopelessness, worthlessness, helplessness and marked role impairment; the clinical purpose of that measurement is to route proportionate human support to the person now, not to label them permanently.',
    plain: 'Severity readings exist so the right human support can reach you now — a signal to act on, not a permanent label.',
    keywords: ['severe', 'hopeless', 'worthless', 'can\'t function', 'unbearable', 'suicidal', 'breaking down'],
  },
  {
    id: 'vanderkolk-touch-and-rhythm',
    sourceKey: 'VANDERKOLK',
    source: VANDERKOLK,
    kind: 'book',
    theme: 'severe',
    text: 'Because overwhelming experience is stored subcortically and somatically, regulation in acute states is best achieved through bottom-up channels — breath, physical pressure, movement, rhythm, and safe human presence — rather than through reasoning or insight.',
    plain: 'In overwhelming states, the body settles through breath, pressure, rhythm and safe presence — not through reasoning.',
    keywords: ['overwhelmed', 'crisis', 'panic', 'can\'t think', 'dissociating', 'body', 'grounding', 'somatic'],
  },
  {
    id: 'linehan-distress-tolerance',
    sourceKey: 'LINEHAN',
    source: LINEHAN,
    kind: 'book',
    theme: 'severe',
    text: 'Distress-tolerance skills are designed for moments when the situation cannot yet be changed: paced breathing, cold-water or temperature shifts, paired muscle relaxation and brief intense sensory input interrupt escalating arousal enough to keep a person safe until the wave passes.',
    plain: 'When nothing can be fixed yet, brief physical interventions can carry you safely through the peak until it passes.',
    keywords: ['can\'t take it', 'crisis', 'urge', 'self-harm', 'overwhelmed', 'panic', 'distress tolerance', 'ride it out'],
  },
  {
    id: 'linehan-radical-acceptance',
    sourceKey: 'LINEHAN',
    source: LINEHAN,
    kind: 'book',
    theme: 'severe',
    text: 'Radical acceptance — fully acknowledging reality as it is without approval or resignation — reduces the secondary suffering generated by fighting what has already happened; it is a deliberate practice, not a feeling, and it is compatible with later change.',
    plain: 'Accepting what has already happened is not giving up — it stops the extra suffering that comes from fighting reality.',
    keywords: ['acceptance', 'unfair', 'can\'t accept', 'grief', 'why me', 'suffering', 'pain'],
  },

  // ======================= GENERAL =======================
  {
    id: 'gibbons-self-report-primary',
    sourceKey: 'GIBBONS',
    source: GIBBONS,
    kind: 'paper',
    theme: 'general',
    text: 'Computerized adaptive testing demonstrates that the patient\'s own report is the primary valid evidence about their internal state, and that a small number of well-chosen items can estimate severity with the precision of far longer instruments.',
    plain: 'Your own account of how you feel is the most valid evidence there is about your inner state.',
    keywords: ['self report', 'honest', 'check in', 'assessment', 'measuring feelings', 'how i feel'],
  },
  {
    id: 'gibbons-subdomains',
    sourceKey: 'GIBBONS',
    source: GIBBONS,
    kind: 'paper',
    theme: 'general',
    text: 'Distress expresses across four subdomains — mood, cognition, behavior and somatic experience — so a full picture requires attending to sleep, energy, appetite, concentration and social behavior alongside felt emotion.',
    plain: 'How you feel shows up in mood, thinking, body and daily behavior — all four matter equally.',
    keywords: ['mood', 'body', 'sleep', 'energy', 'concentration', 'appetite', 'daily function', 'overall'],
  },
  {
    id: 'siegel-name-and-integrate',
    sourceKey: 'SIEGEL',
    source: SIEGEL,
    kind: 'book',
    theme: 'general',
    text: 'Naming an inner state precisely recruits prefrontal regulatory circuits and increases the capacity to observe experience, which is why the simple act of describing a feeling accurately is itself a regulatory intervention rather than a preliminary to one.',
    plain: 'Describing what you feel accurately is not just preparation — the description itself is doing the regulating.',
    keywords: ['describing feelings', 'naming', 'self awareness', 'reflection', 'journal', 'honest', 'check in'],
  },
  {
    id: 'kabatzinn-awareness-training',
    sourceKey: 'KABATZINN',
    source: KABATZINN,
    kind: 'book',
    theme: 'general',
    text: 'Mindfulness is described as awareness cultivated on purpose, in the present moment, without judgment; it is a trainable attention skill rather than a relaxation technique, and its benefits accumulate with regular short practice.',
    plain: 'Mindfulness is trainable attention, not relaxation tricks — short regular practice is what builds it.',
    keywords: ['mindfulness', 'awareness', 'practice', 'attention', 'self awareness', 'meditation', 'habit'],
  },
  {
    id: 'tip57-strengths-recovery',
    sourceKey: 'TIP57',
    source: TIP57,
    kind: 'paper',
    theme: 'general',
    text: 'Recovery-oriented trauma-informed care assumes that people are the experts on their own lives and that care must build on existing strengths, choices and cultural context rather than pathologize; the therapeutic relationship itself is a primary agent of change.',
    plain: 'You are the expert on your own life, and care works by building on your existing strengths — not by labelling you.',
    keywords: ['strengths', 'recovery', 'support', 'empowerment', 'respect', 'self worth', 'choices'],
  },
  {
    id: 'walkersapolsky-regulation-basics',
    sourceKey: 'SAPOLSKY',
    source: SAPOLSKY,
    kind: 'book',
    theme: 'general',
    text: 'Because the stress response is modulated by predictability, control, outlets for frustration and social support, the same objective demands produce markedly different physiological tolls depending on those four psychological variables.',
    plain: 'Predictability, a sense of control, an outlet for frustration and social support change what stress does to your body.',
    keywords: ['stress', 'control', 'predictability', 'support', 'coping', 'pressure', 'overwhelm'],
  },
  {
    id: 'emmons-gratitude-specificity',
    sourceKey: 'EMMONS',
    source: EMMONS,
    kind: 'book',
    theme: 'general',
    text: 'Gratitude interventions produce larger effects when entries are specific and interpersonal rather than global and abstract; recounting particular people and events engages memory retrieval and social cognition, not just positive wording.',
    plain: 'Naming specific people and small events you appreciated works better than general "I am grateful" statements.',
    keywords: ['gratitude', 'thankful', 'appreciation', 'journal', 'positive', 'kindness', 'connection'],
  },
];
