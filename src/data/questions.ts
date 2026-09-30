import { Question, AssessmentLength, AssessmentModeOption } from '../types.js';

export const CATEGORIES = [
  'Mood and Emotional State',
  'Daily Functioning and Physical Well-being',
  'Thought Patterns and Perception of Reality',
  'Stress, Coping, and Impulse Control',
  'Social Connections and Relationships'
] as const;

/** Default/full-length run. Kept as a named export for backwards
 * compatibility with anything that still imports TOTAL_QUESTIONS directly. */
export const TOTAL_QUESTIONS = 20;

/**
 * The three lengths a person can choose at the start of an assessment.
 * Every option draws from the same 50-item QUESTION_POOL and is scored by
 * the same adaptive engine and clinical rubric — only how many questions are
 * asked (and therefore how long it takes) changes. Shorter runs are for
 * people who want a quick read on how they're doing without committing to
 * the full 20-question screening.
 */
export const ASSESSMENT_MODES: AssessmentModeOption[] = [
  {
    length: 5,
    label: 'Quick Check-In',
    description: 'A fast pulse-check across all five dimensions. Good when you just want a quick read.',
    estimatedMinutes: '~2 min'
  },
  {
    length: 10,
    label: 'Balanced Check-In',
    description: 'More coverage per dimension for a fuller picture, still brief.',
    estimatedMinutes: '~5 min'
  },
  {
    length: 20,
    label: 'Full Assessment',
    description: 'The complete adaptive screening with the deepest per-dimension detail.',
    estimatedMinutes: '~10 min'
  }
];

export const DEFAULT_ASSESSMENT_LENGTH: AssessmentLength = 20;

/**
 * QUESTION_POOL is the full candidate bank the adaptive engine selects from.
 * It is intentionally larger than any single assessment length so that each
 * run can dynamically pick, reorder, and randomize a fresh question path
 * based on the sentiment and content of the user's previous answers, while
 * every category still gets meaningful coverage. `keywords` power the
 * information-retrieval relevance scoring used to pick the next question.
 * The pool holds 50 items (10 per category); a run asks 5, 10, or 20 of them
 * depending on the chosen assessment mode.
 */
export const QUESTION_POOL: Question[] = [
  // --- 1. Mood and Emotional State ---
  {
    id: 1,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'How have you been feeling emotionally on most days over the past two weeks?',
    rationale: 'Establishes a baseline mood and checks for chronic low or high periods.',
    placeholder: 'Describe your prevailing mood, energy, emotional weight, or lightness over the past 14 days...',
    keywords: ['mood', 'feeling', 'emotion', 'baseline', 'energy', 'weight', 'lightness'],
    quickPrompts: [
      'Mostly calm and balanced',
      'Exhausted, low energy, and empty',
      'High anxiety, feeling tense constantly',
      'Fluctuating between okay and overwhelmed'
    ]
  },
  {
    id: 2,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'Do you frequently experience sudden, extreme, or unpredictable shifts in your mood?',
    rationale: 'Assesses emotional regulation and stability.',
    placeholder: 'Do minor events trigger intense emotional swings, or do you feel stable throughout the day?...',
    keywords: ['mood swings', 'unpredictable', 'regulation', 'trigger', 'irritable', 'unstable'],
    quickPrompts: [
      'My mood is predictable and steady',
      'Small triggers cause sudden anger or tears',
      'Rapid shifts from euphoria to deep lows',
      'Sometimes irritable without clear reason'
    ]
  },
  {
    id: 3,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'Have you lost interest, joy, or motivation in activities you previously enjoyed?',
    rationale: 'A key indicator of depression, known as anhedonia.',
    placeholder: 'Think about hobbies, music, games, spending time with others—do they still bring fulfillment?...',
    keywords: ['interest', 'joy', 'motivation', 'anhedonia', 'hobbies', 'pleasure', 'flat'],
    quickPrompts: [
      'Still passionate and engaged in hobbies',
      'Everything feels like a chore or meaningless',
      'I force myself to do things but feel flat',
      'Occasional lack of motivation when tired'
    ]
  },
  {
    id: 4,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'Do you often feel overwhelmed by feelings of sadness, anxiety, or anger without a clear, immediate trigger?',
    rationale: 'Checks for generalized anxiety or mood disorders.',
    placeholder: 'Reflect on whether heavy emotions arrive unexpectedly without any external event...',
    keywords: ['overwhelmed', 'sadness', 'anxiety', 'anger', 'trigger', 'dread', 'unexplained'],
    quickPrompts: [
      'Rarely, emotions usually match the situation',
      'Sudden waves of dread or sadness hit out of nowhere',
      'Frequent tightness in my chest and unwarranted worry',
      'Occasional bouts of unexplained frustration'
    ]
  },
  {
    id: 21,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'Do you find yourself crying more easily than usual, or feeling emotionally numb instead?',
    rationale: 'Distinguishes heightened emotional reactivity from emotional blunting, two distinct mood presentations.',
    placeholder: 'Notice whether small things bring you to tears, or whether you feel oddly disconnected from your emotions...',
    keywords: ['crying', 'numb', 'emotional', 'tears', 'blunted', 'reactivity', 'disconnected'],
    quickPrompts: [
      'Neither, my emotional responses feel proportionate',
      'Crying more easily than usual lately',
      'Feeling numb, like emotions are muted',
      'Swinging between tearful and completely flat'
    ]
  },

  {
    id: 26,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'In the past two weeks, how often have you felt hopeless, worthless, or like a failure, even when nothing specific caused it?',
    rationale: 'Mirrors the highest-discriminating item stems from validated depression item banks (e.g. hopelessness, worthlessness, self-as-failure) rather than a single generic "are you sad" question.',
    placeholder: 'Notice how often these specific feelings show up, not just whether you feel sad in general...',
    keywords: ['hopeless', 'worthless', 'failure', 'helpless', 'guilt', 'blame', 'discouraged'],
    quickPrompts: [
      'Never — I don\u2019t recognize those feelings in myself',
      'Rarely, only on a genuinely bad day',
      'Often, several days felt heavy with hopelessness or self-blame',
      'Almost always, it colors most of my days'
    ]
  },
  {
    id: 27,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'Do waves of dread or panic ever hit you out of nowhere, as if your body senses danger before your mind can explain why?',
    rationale: 'Grounded in the concept of anticipatory anxiety and the nervous system\u2019s automatic threat-detection response (neuroception) preceding conscious appraisal, plus validated anxiety-bank items on sudden panic and feeling something awful is about to happen.',
    placeholder: 'Think about whether your body seems to sound an alarm before your thoughts catch up to why...',
    keywords: ['dread', 'panic', 'sudden', 'alarm', 'body', 'danger', 'racing heart', 'uneasy'],
    quickPrompts: [
      'No, my worry usually has a clear, traceable cause',
      'Occasionally a wave of unexplained unease passes through',
      'Fairly often — sudden panic with no obvious trigger',
      'Frequently, and it feels like my body reacts before I even think'
    ]
  },

  {
    id: 36,
    yesMeansConcern: false,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'Do you still find things to look forward to, or does the near future feel flat, empty, or pointless?',
    rationale: 'Grounded in validated depression item stems on loss of positive affect and a sense of an empty or purposeless life, distinct from anhedonia about past hobbies (already covered) by focusing on forward-looking motivation.',
    placeholder: 'Notice whether upcoming plans, weekends, or small events still pull your interest, or whether the future feels blank...',
    keywords: ['future', 'empty', 'pointless', 'anticipation', 'meaning', 'purpose', 'look forward'],
    quickPrompts: [
      'Yes, there are things I genuinely look forward to',
      'A little, though it takes more effort than before',
      'Mostly flat — the future feels empty or blank',
      'Nothing feels worth looking forward to right now'
    ]
  },
  {
    id: 37,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'How often do you find yourself blaming or being harshly critical of yourself, even for things that weren\u2019t really your fault?',
    rationale: 'Mirrors validated depression item stems on guilt and self-blame, a distinct facet from hopelessness or failure already screened elsewhere.',
    placeholder: 'Think about your inner voice after a mistake or setback — is it harsh, forgiving, or somewhere in between...',
    keywords: ['guilt', 'blame', 'self-critical', 'self-blame', 'punish', 'forgive', 'harsh'],
    quickPrompts: [
      'I\u2019m fairly forgiving of my own mistakes',
      'I\u2019m a bit harder on myself than I\u2019d like',
      'I often blame myself even when it isn\u2019t my fault',
      'A harsh inner voice runs almost constantly'
    ]
  },
  {
    id: 38,
    yesMeansConcern: true,
    category: 'Mood and Emotional State',
    categoryIndex: 0,
    question: 'Do small annoyances leave you feeling irritated or on edge for longer than you\u2019d expect, even if you don\u2019t show it outwardly?',
    rationale: 'Mirrors validated anger item stems on being annoyed or irritated "more than people knew," capturing an internalized mood-level irritability distinct from outward anger behavior covered elsewhere.',
    placeholder: 'Notice whether minor things linger and color your mood, even when your outward reaction seems calm...',
    keywords: ['irritated', 'annoyed', 'on edge', 'simmer', 'lingering', 'mood', 'internal'],
    quickPrompts: [
      'Small annoyances pass quickly for me',
      'They linger a bit longer than I\u2019d like',
      'I\u2019m often irritated inside more than people realize',
      'I feel on edge for a large part of most days'
    ]
  },

  // --- 2. Daily Functioning and Physical Well-being ---
  {
    id: 5,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'How consistent is your sleep schedule?',
    rationale: 'Significant changes—either insomnia or sleeping excessively—are primary indicators of distress.',
    placeholder: 'How many hours do you sleep? Do you struggle falling asleep, wake frequently, or oversleep?...',
    keywords: ['sleep', 'insomnia', 'oversleep', 'rest', 'tired', 'exhausted', 'racing thoughts'],
    quickPrompts: [
      'Consistent 7-8 hours, restful quality',
      'Severe insomnia, racing thoughts at night',
      'Oversleeping 10+ hours and still exhausted',
      'Irregular sleep due to stress or screen time'
    ]
  },
  {
    id: 6,
    yesMeansConcern: true,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'Have you noticed significant, unintentional changes in your appetite or weight recently?',
    rationale: 'Physical manifestations of psychological stress.',
    placeholder: 'Have you lost your desire to eat, or have you been stress-eating and craving comfort foods?...',
    keywords: ['appetite', 'weight', 'eating', 'binge', 'nauseated', 'comfort food'],
    quickPrompts: [
      'Appetite and weight remain normal',
      'Forgetting to eat or feeling nauseated by food',
      'Compulsive binge eating under stress',
      'Mild changes related to busy schedule'
    ]
  },
  {
    id: 7,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'How difficult is it for you to maintain basic routines, such as daily hygiene, household chores, or going to work/school?',
    rationale: 'Evaluates executive functioning and energy levels.',
    placeholder: 'Is taking a shower, brushing teeth, cleaning your room, or completing work feeling monumental?...',
    keywords: ['routine', 'hygiene', 'chores', 'work', 'executive function', 'procrastinating'],
    quickPrompts: [
      'Manageable and part of my regular cadence',
      'Extremely hard; basic self-care takes massive effort',
      'Keeping up with work, but personal tasks fall behind',
      'Procrastinating more than usual, but getting by'
    ]
  },
  {
    id: 8,
    yesMeansConcern: true,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'Are you currently struggling to concentrate, remember things, or make everyday decisions?',
    rationale: 'Assesses cognitive load and focus.',
    placeholder: 'Notice brain fog, difficulty reading, forgetting recent conversations, or decision paralysis...',
    keywords: ['concentrate', 'memory', 'focus', 'brain fog', 'decision', 'cognitive'],
    quickPrompts: [
      'Sharp focus and clear decision making',
      'Dense brain fog, cannot focus for >10 minutes',
      'Paralyzed by even simple choices like what to wear',
      'Mild distraction caused by multitasking'
    ]
  },
  {
    id: 22,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'How has your physical energy level throughout a typical day changed recently?',
    rationale: 'Fatigue and energy dysregulation often precede or accompany mood and functioning declines.',
    placeholder: 'Do you wake up already tired, crash mid-afternoon, or feel wired and unable to slow down?...',
    keywords: ['energy', 'fatigue', 'exhausted', 'crash', 'wired', 'lethargic', 'motivation'],
    quickPrompts: [
      'Steady energy through most of the day',
      'Drained and heavy from the moment I wake up',
      'Crashing hard by mid-afternoon',
      'Wired and restless, hard to physically slow down'
    ]
  },

  {
    id: 28,
    yesMeansConcern: true,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'Do you notice physical signs of your nervous system being \u201con alert\u201d \u2014 a pounding heart, tight chest, or knotted stomach \u2014 even when nothing is actually wrong?',
    rationale: 'Grounded in the polyvagal account of autonomic state and validated anxiety item banks that isolate somatic arousal (racing/pounding heart, trembling, tight chest) as distinct from worry itself.',
    placeholder: 'Notice whether your body carries tension, a racing pulse, or a tight gut, separately from what you\u2019re consciously thinking about...',
    keywords: ['racing heart', 'pounding heart', 'tight chest', 'stomach', 'tense', 'body', 'arousal', 'somatic'],
    quickPrompts: [
      'My body generally feels settled and relaxed',
      'Occasional tension when something is genuinely stressful',
      'Frequent racing heart or tight chest with no clear cause',
      'My body feels braced or \u201con guard\u201d almost constantly'
    ]
  },
  {
    id: 29,
    yesMeansConcern: false,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'Once something upsets you, how easily can you calm your body back down \u2014 slow your breathing, unclench, and feel steady again?',
    rationale: 'Reflects the polyvagal concept of the myelinated "vagal brake" \u2014 the capacity to actively downshift out of a stress response \u2014 as distinct from how intensely someone reacts in the first place.',
    placeholder: 'Think about the minutes or hours after an upset: does your body reset on its own, or does the tension linger?...',
    keywords: ['calm down', 'settle', 'reset', 'recover', 'breathing', 'soothe', 'linger', 'wind down'],
    quickPrompts: [
      'Fairly quickly \u2014 my body settles within minutes',
      'It takes real effort, but I can eventually calm down',
      'It lingers for hours; I stay wound up long after',
      'I rarely feel like I fully reset before the next stressor hits'
    ]
  },

  {
    id: 39,
    yesMeansConcern: true,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'Under stress, do you notice digestive changes \u2014 nausea, a knotted stomach, or bowel changes \u2014 that seem tied to how you\u2019re feeling rather than to what you\u2019ve eaten?',
    rationale: 'Grounded in the polyvagal account of gut-brain autonomic coupling, where dorsal vagal activity under stress shows up as gastrointestinal symptoms distinct from cardiac/respiratory arousal already screened elsewhere.',
    placeholder: 'Think about whether stressful periods line up with stomach or digestive changes, independent of diet...',
    keywords: ['stomach', 'nausea', 'digestive', 'gut', 'bowel', 'gastrointestinal', 'stress'],
    quickPrompts: [
      'No noticeable connection between stress and my digestion',
      'Occasionally my stomach reacts during a rough week',
      'Fairly often \u2014 stress reliably upsets my stomach',
      'Frequent digestive distress that tracks closely with stress'
    ]
  },
  {
    id: 40,
    yesMeansConcern: true,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'Do you ever feel physically frozen or shut down under pressure \u2014 unable to move, speak up, or act \u2014 even when you know you need to?',
    rationale: 'Grounded in the polyvagal concept of dorsal-vagal immobilization (the "freeze" response), a distinct physiological pattern from fatigue or racing arousal already covered elsewhere.',
    placeholder: 'Notice whether high-pressure moments ever leave your body feeling stuck or heavy, separate from ordinary tiredness...',
    keywords: ['frozen', 'freeze', 'shut down', 'stuck', 'immobilized', 'paralyzed', 'unable to move'],
    quickPrompts: [
      'No, I stay physically responsive even under pressure',
      'Occasionally I go blank or stiffen up briefly',
      'It happens fairly often in stressful moments',
      'I frequently feel physically stuck or shut down'
    ]
  },
  {
    id: 41,
    category: 'Daily Functioning and Physical Well-being',
    categoryIndex: 1,
    question: 'Have you become noticeably more or less sensitive to pain, temperature, or physical sensation than you used to be?',
    rationale: 'Mirrors validated anxiety item stems on altered sensitivity to heat, cold, or pain, a somatic marker distinct from the racing-heart/tight-chest arousal item already covered.',
    placeholder: 'Think about whether ordinary bumps, temperature changes, or discomfort feel more intense, muted, or unchanged...',
    keywords: ['sensitive', 'pain', 'temperature', 'sensation', 'numb', 'heightened', 'muted'],
    quickPrompts: [
      'My sensitivity to pain or temperature feels normal',
      'Slightly more sensitive than usual lately',
      'Noticeably more sensitive \u2014 things feel more intense',
      'Oddly numb or under-sensitive to things that used to register'
    ]
  },

  // --- 3. Thought Patterns and Perception of Reality ---
  {
    id: 9,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you ever feel detached from your own body, or feel as though the world around you isn\'t real?',
    rationale: 'Checks for dissociation, depersonalization, or derealization.',
    placeholder: 'Does your reflection feel foreign, or does reality seem like watching a movie or fog?...',
    keywords: ['detached', 'dissociation', 'unreal', 'depersonalization', 'derealization', 'foggy'],
    quickPrompts: [
      'No, I feel grounded and connected to reality',
      'Frequently feel like a robotic spectator of my body',
      'World feels foggy, dreamlike, or artificial',
      'Only momentarily when deeply exhausted'
    ]
  },
  {
    id: 10,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you experience intrusive, racing, or obsessive thoughts that you feel you cannot control?',
    rationale: 'Points toward severe anxiety, OCD, or mania.',
    placeholder: 'Do repetitive alarming thoughts loop in your mind despite trying to push them away?...',
    keywords: ['intrusive', 'racing thoughts', 'obsessive', 'loop', 'ocd', 'uncontrollable'],
    quickPrompts: [
      'Mind feels calm and orderly',
      'Constant catastrophic "what if" thought loops',
      'Racing thoughts moving too fast to keep track',
      'Distressing intrusive images or obsessive doubts'
    ]
  },
  {
    id: 11,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you ever hear, see, or feel things that other people do not seem to notice?',
    rationale: 'A standard screening question for hallucinations or psychosis.',
    placeholder: 'Have you noticed auditory whispers, shadows in peripheral vision, or unusual sensory experiences?...',
    keywords: ['hallucination', 'voices', 'shadows', 'sensory', 'psychosis'],
    quickPrompts: [
      'Never experienced anything like that',
      'Occasionally when falling asleep or waking up (hypnagogic)',
      'Hearing voices or seeing shadowy figures when fully awake',
      'Heightened sensitivity to loud sounds or bright lights'
    ]
  },
  {
    id: 12,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you have strong beliefs that others tell you are untrue, or feel like people are constantly watching or conspiring against you?',
    rationale: 'Assesses reality testing and potential delusions/paranoia.',
    placeholder: 'Do you sense hidden surveillance, secret agendas, or profound convictions others reject?...',
    keywords: ['paranoia', 'conspiring', 'watched', 'delusion', 'surveillance', 'suspicion'],
    quickPrompts: [
      'No, I trust consensus reality and facts',
      'Hypervigilant; feeling judged or stared at in public',
      'Suspicion that people in my circle talk behind my back',
      'Strong persistent feelings that I am targeted or surveilled'
    ]
  },
  {
    id: 23,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you find it hard to make sense of your own thoughts, or does your thinking feel unusually slow or unusually fast?',
    rationale: 'Screens for cognitive slowing (common in depression) or racing cognition (common in mania/anxiety).',
    placeholder: 'Notice whether your thinking feels sluggish and effortful, or sped-up and hard to keep pace with...',
    keywords: ['thinking', 'slow', 'fast', 'confusion', 'clarity', 'cognition', 'sluggish'],
    quickPrompts: [
      'My thinking feels clear and normally paced',
      'Thoughts feel sluggish, like wading through mud',
      'Thoughts move too fast to keep track of',
      'Occasional confusion when tired or stressed'
    ]
  },

  {
    id: 30,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Even in situations that are objectively safe, do you find yourself scanning the room, staying on guard, or unable to fully relax around other people?',
    rationale: 'Grounded in the concept of neuroception \u2014 the nervous system\u2019s automatic, below-conscious evaluation of safety versus danger \u2014 which can misfire and keep someone in a defensive state despite no real threat.',
    placeholder: 'Notice whether you catch yourself watching exits, reading faces for danger, or bracing, even when you know you\u2019re safe...',
    keywords: ['scanning', 'on guard', 'vigilant', 'unsafe', 'watchful', 'relax', 'threat', 'defensive'],
    quickPrompts: [
      'I can fully relax once I know a place or person is safe',
      'I catch myself scanning or staying alert out of habit',
      'It\u2019s hard to relax even in places I logically know are safe',
      'I feel on guard almost everywhere, even at home'
    ]
  },
  {
    id: 31,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do memories, images, or feelings from a difficult past experience ever resurface uninvited and make the present moment feel like it\u2019s happening again?',
    rationale: 'Screens for intrusive re-experiencing and hypervigilance, common trauma-related responses that can persist below the level of a full diagnosis and are best asked about directly and non-judgmentally.',
    placeholder: 'Notice whether certain sounds, places, or situations pull you back into a past moment rather than staying in the present...',
    keywords: ['flashback', 'intrusive', 'memories', 'past', 'resurface', 'trigger', 'reliving'],
    quickPrompts: [
      'No, the past stays in the past for me',
      'Occasionally a memory surfaces but passes quickly',
      'Certain triggers pull me back vividly and it\u2019s hard to shake',
      'It happens often enough that it disrupts my day'
    ]
  },

  {
    id: 42,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you frequently assume the worst possible outcome will happen, even when there\u2019s little evidence for it?',
    rationale: 'Mirrors validated anxiety item stems on the conviction that "something awful will happen," capturing future-oriented catastrophic thinking as a distinct cognitive pattern from the body-first, unexplained panic already screened elsewhere.',
    placeholder: 'Notice whether your mind jumps to disaster scenarios before considering more likely, ordinary outcomes...',
    keywords: ['catastrophic', 'worst case', 'assume', 'disaster', 'worry', 'anticipate', 'awful'],
    quickPrompts: [
      'I usually consider likely outcomes, not just worst-case ones',
      'I catch myself catastrophizing sometimes, but can reframe it',
      'I frequently expect the worst before I have evidence',
      'Worst-case thinking dominates most of my planning'
    ]
  },
  {
    id: 43,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you find yourself replaying past conversations, arguments, or mistakes over and over, unable to let them go?',
    rationale: 'Screens for ruminative thinking, a cognitive pattern distinct from held-onto anger (already screened as a behavioral/emotional item) that focuses specifically on repetitive, involuntary mental replay.',
    placeholder: 'Think about whether your mind loops back to the same past moment repeatedly, even when you try to move on...',
    keywords: ['replay', 'rumination', 'overthinking', 'looping', 'past', 'cannot let go', 'obsess'],
    quickPrompts: [
      'I can usually process something and move on',
      'I replay things sometimes, but it fades within a day',
      'I often get stuck re-running the same memory or conversation',
      'Certain moments loop in my head for days or longer'
    ]
  },
  {
    id: 44,
    yesMeansConcern: true,
    category: 'Thought Patterns and Perception of Reality',
    categoryIndex: 2,
    question: 'Do you ever feel like you don\u2019t recognize who you\u2019ve become, or that you\u2019ve drifted far from the person you used to be?',
    rationale: 'Screens for a disrupted sense of self/identity continuity, distinct from derealization about the external world or dissociation from the body, already covered elsewhere.',
    placeholder: 'Notice whether your values, personality, or sense of self feel continuous, or whether you feel like a stranger to your past self...',
    keywords: ['identity', 'self', 'unrecognizable', 'changed', 'drifted', 'lost myself', 'continuity'],
    quickPrompts: [
      'I feel like a consistent version of myself over time',
      'I\u2019ve changed some, but I still recognize myself',
      'I often feel like a stranger to who I used to be',
      'I genuinely don\u2019t know who I am anymore'
    ]
  },

  // --- 4. Stress, Coping, and Impulse Control ---
  {
    id: 13,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'How do you typically react when faced with unexpected stress, failure, or interpersonal conflict?',
    rationale: 'Evaluates resilience and coping strategies.',
    placeholder: 'Do you shut down, confront it constructively, panic, lash out, or retreat inward?...',
    keywords: ['stress', 'coping', 'conflict', 'resilience', 'panic', 'shut down'],
    quickPrompts: [
      'Take a step back, breathe, and problem-solve',
      'Completely shut down, freeze, or dissociate',
      'Panic and fear the worst possible outcome',
      'Lash out impulsively, then feel guilty later'
    ]
  },
  {
    id: 14,
    yesMeansConcern: true,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'Are you using alcohol, drugs, or prescription medications more frequently to cope with your feelings?',
    rationale: 'Checks for substance abuse as a maladaptive coping mechanism.',
    placeholder: 'Do you rely on substances, sedatives, or alcohol to numb emotional pain or sleep?...',
    keywords: ['alcohol', 'drugs', 'substance', 'coping', 'numb', 'dependency'],
    quickPrompts: [
      'No reliance on substances for emotional coping',
      'Drinking or smoking occasionally on tough days',
      'Relying on alcohol/meds daily to numb pain or get sleep',
      'Worried about my recent substance dependency'
    ]
  },
  {
    id: 15,
    yesMeansConcern: true,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'Have you had any thoughts of harming yourself, or felt that life is no longer worth living?',
    rationale: 'The most critical safety assessment in any mental health evaluation.',
    placeholder: 'Please be honest with yourself; your well-being and safety are the top priority...',
    keywords: ['self-harm', 'suicide', 'safety', 'worth living', 'hopeless'],
    // This safety screener is always included in every assessment, regardless
    // of adaptive selection, and is never skipped or substituted.
    mandatory: true,
    quickPrompts: [
      'Never, I value my life and future',
      'Passive wish to go to sleep and not wake up',
      'Fleeting intrusive thoughts with no intent',
      'Active thoughts or plans—I need support'
    ]
  },
  {
    id: 16,
    yesMeansConcern: true,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'Do you engage in highly impulsive or risky behaviors (e.g., reckless driving, extreme spending, unsafe situations) during periods of high stress or elevated mood?',
    rationale: 'Assesses impulse control and potential manic behavior.',
    placeholder: 'Notice acts done without regard for consequences, sudden reckless expenditures, or risky adrenaline rushes?...',
    keywords: ['impulsive', 'risky', 'reckless', 'spending', 'impulse control', 'manic'],
    quickPrompts: [
      'Cautious and deliberate in my actions',
      'Impulsive shopping or overspending when stressed',
      'Reckless driving or thrill-seeking when agitated',
      'Rarely, only during intense arguments'
    ]
  },
  {
    id: 24,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'When plans change unexpectedly or you feel criticized, how do you usually respond internally?',
    rationale: 'Probes distress tolerance and self-criticism under everyday friction, not just major stressors.',
    placeholder: 'Notice whether small disruptions or feedback spark disproportionate frustration, shame, or rigidity...',
    keywords: ['criticism', 'control', 'frustration', 'rigidity', 'shame', 'distress tolerance'],
    quickPrompts: [
      'I adapt fairly easily and let it go',
      'Criticism spirals into harsh self-judgment',
      'Unexpected change makes me anxious and rigid',
      'I get irritated but recover within the hour'
    ]
  },

  {
    id: 32,
    yesMeansConcern: false,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'When you get angry, does it pass quickly, or do you find yourself staying angry for hours, feeling ready to explode, or struggling to control your temper?',
    rationale: 'Mirrors the highest-discriminating item stems from validated anger item banks (sustained anger, feeling ready to explode, trouble controlling temper) rather than asking about anger as a single blunt category.',
    placeholder: 'Think about the intensity and duration of anger, separate from whether you show it outwardly...',
    keywords: ['anger', 'explode', 'temper', 'irritable', 'grudge', 'resentful', 'stayed angry'],
    quickPrompts: [
      'Anger passes fairly quickly once the moment is over',
      'It lingers longer than I\u2019d like, but I manage it',
      'I often feel ready to explode or hold onto anger for hours',
      'I have real trouble controlling my temper once it\u2019s triggered'
    ]
  },
  {
    id: 33,
    yesMeansConcern: true,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'Do you avoid certain places, people, topics, or situations because they remind you of something painful, or use distraction, numbing, or substances to keep difficult feelings at bay?',
    rationale: 'Grounded in trauma-informed care literature on avoidance and self-medication as common, often adaptive-turned-costly coping strategies that reinforce perceived danger over time.',
    placeholder: 'Notice what you steer around \u2014 routes, conversations, people, feelings \u2014 and what you lean on to numb out when they can\u2019t be avoided...',
    keywords: ['avoid', 'avoidance', 'numb', 'distract', 'substance', 'reminder', 'cope', 'self-medicate'],
    quickPrompts: [
      'I face difficult reminders without needing to avoid or numb out',
      'I steer around a few specific triggers, but it\u2019s manageable',
      'I actively avoid multiple places, people, or topics',
      'I lean on distraction, numbing, or substances fairly often to cope'
    ]
  },

  {
    id: 45,
    yesMeansConcern: true,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'Under real pressure, does your default response tend to be freezing up or going quiet, rather than fighting back or fleeing the situation?',
    rationale: 'Grounded in the polyvagal account of dorsal-vagal immobilization as a third stress-response style alongside fight and flight, since a coping-style question that only offers "shut down/panic/lash out" can miss freeze as its own distinct pattern worth naming directly.',
    placeholder: 'Think about your very first reflexive response to sudden pressure, before you consciously choose how to react...',
    keywords: ['freeze', 'shut down', 'quiet', 'immobilized', 'stress response', 'default reaction'],
    quickPrompts: [
      'I tend to actively engage or problem-solve first',
      'I sometimes go quiet, then re-engage once I process',
      'Freezing up or going quiet is my most common first reaction',
      'I feel physically stuck and can\u2019t respond in the moment'
    ]
  },
  {
    id: 46,
    yesMeansConcern: true,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'Do you use busyness, work, screens, or constant activity to avoid sitting with difficult feelings?',
    rationale: 'Grounded in trauma-informed care literature on avoidance as a coping strategy that extends beyond substances to behavioral distraction (overwork, screens, constant activity), which can look productive while still functioning as emotional avoidance.',
    placeholder: 'Notice whether staying constantly occupied is sometimes a way of not having to feel something underneath...',
    keywords: ['busy', 'distract', 'avoid', 'overwork', 'screens', 'numb', 'occupied'],
    quickPrompts: [
      'I can sit with difficult feelings without needing distraction',
      'I lean on busyness sometimes, but I notice when I\u2019m doing it',
      'I fairly often stay busy specifically to avoid feeling something',
      'I rarely let myself slow down enough to feel anything'
    ]
  },
  {
    id: 47,
    category: 'Stress, Coping, and Impulse Control',
    categoryIndex: 3,
    question: 'How difficult is it for you to ask for or accept help, even from people who have offered it?',
    rationale: 'Grounded in trauma-informed care literature on help-seeking barriers, where past experiences of unmet need or unsafe dependence can make accepting support feel unsafe rather than simply unnecessary.',
    placeholder: 'Think about what happens internally when someone offers to help \u2014 relief, suspicion, guilt, or something else...',
    keywords: ['help', 'ask for help', 'accept help', 'independence', 'burden', 'support'],
    quickPrompts: [
      'I can ask for and accept help reasonably comfortably',
      'It\u2019s a little uncomfortable, but I can do it when needed',
      'I find it very hard to ask, even when I clearly need it',
      'I almost always refuse help, even when it\u2019s offered freely'
    ]
  },

  // --- 5. Social Connections and Relationships ---
  {
    id: 17,
    yesMeansConcern: true,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Have you been actively isolating yourself or withdrawing from interactions with friends and family?',
    rationale: 'Social withdrawal is a common protective behavior during mental health declines.',
    placeholder: 'Are you ignoring texts, canceling plans, or staying locked in your room for days?...',
    keywords: ['isolating', 'withdrawing', 'social', 'alone', 'seclusion'],
    quickPrompts: [
      'Regularly socializing and connecting with loved ones',
      'Ghosting messages and staying secluded in my room',
      'Too drained to engage, though I miss my friends',
      'Balancing alone time with occasional social contact'
    ]
  },
  {
    id: 18,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'How frequently do you experience severe conflict, intense irritability, or sudden anger with the people around you?',
    rationale: 'Evaluates externalized stress and emotional volatility.',
    placeholder: 'Do minor interactions make you snap at colleagues, family, or friends?...',
    keywords: ['conflict', 'irritability', 'anger', 'snap', 'volatility', 'resentment'],
    quickPrompts: [
      'Relationships are peaceful and harmonious',
      'Very short fuse; small annoyances make me snap',
      'Simmering internal resentment, rarely expressed',
      'Occasional constructive disagreements'
    ]
  },
  {
    id: 19,
    yesMeansConcern: true,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Do you feel intensely suspicious, fearful, or untrusting of the people closest to you?',
    rationale: 'Assesses paranoia within personal networks.',
    placeholder: 'Do you doubt friends’ loyalty or feel like they harbor hidden motives against you?...',
    keywords: ['suspicious', 'trust', 'fearful', 'betrayed', 'guarded'],
    quickPrompts: [
      'Deep trust in my close friends and family',
      'Constantly questioning if friends secretly hate me',
      'Guarded and hesitant to be vulnerable with anyone',
      'Felt betrayed in the past, so trust takes time'
    ]
  },
  {
    id: 20,
    yesMeansConcern: false,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Do you have a reliable support system—someone you trust and can speak to honestly when you are struggling?',
    rationale: 'Evaluates the individual\'s safety net and isolation level.',
    placeholder: 'Is there a friend, family member, therapist, or mentor you can open up to without judgment?...',
    keywords: ['support system', 'trust', 'confide', 'safety net', 'connection'],
    quickPrompts: [
      'Yes, several trusted people I can confide in anytime',
      'I have one close confidant who supports me',
      'I feel completely alone with no one to turn to',
      'I have acquaintances, but cannot be truly honest with them'
    ]
  },
  {
    id: 25,
    yesMeansConcern: true,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Do you ever feel like a burden to the people around you, or unsure whether your presence really matters to them?',
    rationale: 'Perceived burdensomeness is a well-studied risk factor distinct from simple loneliness.',
    placeholder: 'Notice whether you hold back from reaching out because you assume others are better off without the ask...',
    keywords: ['burden', 'belonging', 'worth', 'connection', 'matter', 'reaching out'],
    quickPrompts: [
      'I know my presence is valued by others',
      'I often feel like a burden when I reach out',
      'Unsure whether people would notice if I withdrew',
      'It depends on the relationship and the day'
    ]
  },
  {
    id: 34,
    yesMeansConcern: false,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Does being around a calm, warm person actually help settle your body and mood, or do you stay tense even in good company?',
    rationale: 'Grounded in the polyvagal Social Engagement System and co-regulation \u2014 the idea that a calm nervous system nearby can help settle one\u2019s own, and that a persistent inability to feel that effect is itself informative.',
    placeholder: 'Think about time spent with someone genuinely safe and warm \u2014 does your body visibly ease, or does the tension stay?...',
    keywords: ['co-regulation', 'calm', 'settle', 'warm', 'connection', 'ease', 'tense', 'company'],
    quickPrompts: [
      'Yes, good company reliably helps me settle and unwind',
      'It helps somewhat, but some tension usually remains',
      'Rarely \u2014 I stay guarded even with people I trust',
      'I tend to avoid closeness before I can find out'
    ]
  },
  {
    id: 35,
    yesMeansConcern: true,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Has being hurt or let down by someone close to you in the past made it hard to fully trust or relax with people now, even ones who\u2019ve done nothing wrong?',
    rationale: 'Grounded in trauma-informed care literature on betrayal by trusted others, which can carry forward as generalized vigilance toward new relationships independent of present-day evidence.',
    placeholder: 'Notice whether you find yourself testing, guarding, or holding back with people now because of who hurt you before...',
    keywords: ['betrayed', 'trust', 'guarded', 'wary', 'let down', 'vulnerable', 'relax'],
    quickPrompts: [
      'Past hurt hasn\u2019t really changed how I trust people now',
      'I\u2019m a little more careful, but I can still open up',
      'I stay guarded and test people before trusting them',
      'It\u2019s genuinely hard to relax or be vulnerable with anyone'
    ]
  },
  {
    id: 48,
    yesMeansConcern: true,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Do you find yourself agreeing to things you don\u2019t want to do, or hiding your real opinion, to keep others happy or avoid conflict?',
    rationale: 'Screens for boundary-setting difficulty and people-pleasing, a relational pattern distinct from trust or isolation already covered, that often quietly drives resentment and burnout over time.',
    placeholder: 'Notice how often you say yes when you mean no, or stay quiet to keep the peace, even at your own expense...',
    keywords: ['boundaries', 'people-pleasing', 'say no', 'conflict avoidance', 'resentment', 'agree'],
    quickPrompts: [
      'I can say no and voice my real opinion fairly comfortably',
      'I sometimes go along with things to avoid friction',
      'I frequently hide my real feelings to keep others happy',
      'I almost always put others\u2019 comfort ahead of my own needs'
    ]
  },
  {
    id: 49,
    yesMeansConcern: false,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'Do you feel safe showing your real feelings to the people close to you, or do you tend to put on a calmer or happier face than you actually feel?',
    rationale: 'Grounded in the polyvagal Social Engagement System, which links genuine facial and vocal expression to a felt sense of safety \u2014 a persistent gap between the face shown and the feeling underneath is itself informative.',
    placeholder: 'Think about whether the face and tone you show close friends or family usually matches what\u2019s actually going on inside...',
    keywords: ['authentic', 'mask', 'hide feelings', 'real feelings', 'safe', 'expression', 'facade'],
    quickPrompts: [
      'I generally feel safe showing my real feelings',
      'I show most of it, but soften the harder parts',
      'I often put on a calmer face than I actually feel',
      'I rarely let anyone see what I\u2019m really feeling'
    ]
  },
  {
    id: 50,
    yesMeansConcern: false,
    category: 'Social Connections and Relationships',
    categoryIndex: 4,
    question: 'After an argument or misunderstanding with someone close to you, do you two usually reconnect and repair, or does distance tend to linger?',
    rationale: 'Screens for relational repair capacity \u2014 a marker of relationship health distinct from conflict frequency (already covered) that focuses on what happens after conflict rather than the conflict itself.',
    placeholder: 'Notice what typically happens in the hours or days after a disagreement \u2014 does it get talked through, or does it just fade into distance...',
    keywords: ['repair', 'reconnect', 'argument', 'distance', 'resolve', 'silent treatment', 'linger'],
    quickPrompts: [
      'We usually talk it through and reconnect fairly quickly',
      'It takes a little while, but we do eventually repair it',
      'Distance often lingers longer than it probably should',
      'Arguments tend to leave lasting distance that rarely gets addressed'
    ]
  }
];

/** Backwards-compatible static export (original fixed 20-question order). */
export const QUESTIONS: Question[] = QUESTION_POOL.filter((q) => q.id <= 20);
