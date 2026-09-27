import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  Circle, 
  Flame, 
  Sparkles, 
  Calendar, 
  Award, 
  Sun, 
  Wind, 
  Droplet, 
  EyeOff, 
  Footprints,
  RotateCcw
} from 'lucide-react';
import { 
  getProtocolStreakState, 
  recordToolCompleted, 
  ProtocolStreakState 
} from '../utils/historyStorage';
import confetti from 'canvas-confetti';

interface DailyRoutineItem {
  id: string;
  title: string;
  category: 'circadian' | 'somatic' | 'cognitive';
  neuroImpact: string;
  icon: React.ReactNode;
}

const DEFAULT_HABITS: DailyRoutineItem[] = [
  {
    id: 'habit_sunlight',
    title: '10 Mins Morning Viewing Sunlight',
    category: 'circadian',
    neuroImpact: 'Calibrates SCN circadian clock and pulses morning cortisol/dopamine.',
    icon: <Sun className="w-4 h-4 text-amber-400" />,
  },
  {
    id: 'habit_sigh',
    title: '3 Cycles of Double-Inhale Physiological Sighs',
    category: 'somatic',
    neuroImpact: 'Activates parasympathetic vagal brake on sinoatrial cardiac pacemaker.',
    icon: <Wind className="w-4 h-4 text-cyan-400" />,
  },
  {
    id: 'habit_walk',
    title: '15-Minute Screen-Free Optic Flow Walk',
    category: 'cognitive',
    neuroImpact: 'Lateral eye movement down-regulates limbic amygdala threat detection.',
    icon: <Footprints className="w-4 h-4 text-emerald-400" />,
  },
  {
    id: 'habit_hydrate',
    title: 'Morning Electrolyte & Water Hydration',
    category: 'somatic',
    neuroImpact: 'Restores ionic membrane potential for efficient synaptic firing.',
    icon: <Droplet className="w-4 h-4 text-sky-400" />,
  },
  {
    id: 'habit_digital_sunset',
    title: 'Blue Light Screen Cutoff 60m Pre-Sleep',
    category: 'circadian',
    neuroImpact: 'Prevents melatonin suppression by retinal ganglion cell photoreceptors.',
    icon: <EyeOff className="w-4 h-4 text-indigo-400" />,
  },
];

export const DailyProtocolTracker: React.FC<{
  onOpenDefusion?: () => void;
  onOpenSimulator?: () => void;
}> = ({ onOpenDefusion, onOpenSimulator }) => {
  const [streakState, setStreakState] = useState<ProtocolStreakState>(getProtocolStreakState());
  const [completedItems, setCompletedItems] = useState<Record<string, boolean>>({});

  // Load from state
  useEffect(() => {
    const s = getProtocolStreakState();
    setStreakState(s);
    setCompletedItems(s.completedToolIds || {});
  }, []);

  const handleToggleHabit = (id: string) => {
    const updated = !completedItems[id];
    setCompletedItems((prev) => ({ ...prev, [id]: updated }));

    if (updated) {
      const newState = recordToolCompleted(id);
      setStreakState(newState);

      try {
        confetti({
          particleCount: 25,
          spread: 45,
          origin: { y: 0.8 },
          colors: ['#06b6d4', '#10b981', '#a855f7'],
        });
      } catch {
        // safe fallback
      }
    }
  };

  const completedCount = Object.values(completedItems).filter(Boolean).length;
  const totalCount = DEFAULT_HABITS.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="rounded-3xl bg-slate-900/80 backdrop-blur-2xl border border-slate-700/60 p-6 md:p-8 space-y-5">
      {/* Header with Streak Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/40 text-amber-400 shadow-md">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>Daily Neuro-Resilience Protocols & Streaks</span>
            </h3>
            <p className="text-xs text-slate-400">
              Evidence-based biological anchors to build cumulative neuroplastic resilience.
            </p>
          </div>
        </div>

        {/* Streak Pill */}
        <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 px-3.5 py-1.5 rounded-2xl">
          <Flame className="w-4 h-4 text-orange-400 animate-pulse" />
          <div className="text-xs">
            <span className="font-bold text-white font-mono">{streakState.currentStreak} Day</span>
            <span className="text-slate-400 text-[11px] ml-1">Streak</span>
          </div>
        </div>
      </div>

      {/* Progress meter */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs text-slate-300">
          <span className="font-medium">Today's Biological Protocol Adherence</span>
          <span className="font-mono font-bold text-cyan-400">
            {completedCount}/{totalCount} ({progressPercent}%)
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <motion.div
            initial={false}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.4 }}
            className="h-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-indigo-400"
          />
        </div>
      </div>

      {/* Protocol Checklist */}
      <div className="space-y-2 pt-1">
        {DEFAULT_HABITS.map((habit) => {
          const isDone = !!completedItems[habit.id];

          return (
            <div
              key={habit.id}
              onClick={() => handleToggleHabit(habit.id)}
              className={`p-3.5 rounded-2xl border transition-all flex items-start justify-between gap-3 cursor-pointer ${
                isDone
                  ? 'bg-emerald-950/20 border-emerald-500/40 text-slate-200'
                  : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <button
                  type="button"
                  className="mt-0.5 shrink-0 transition-transform active:scale-90"
                >
                  {isDone ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-600 hover:text-slate-400" />
                  )}
                </button>

                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs sm:text-sm font-bold leading-snug ${isDone ? 'line-through text-slate-400' : 'text-white'}`}>
                      {habit.title}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {habit.neuroImpact}
                  </p>
                </div>
              </div>

              <div className="p-1.5 rounded-xl bg-slate-900 border border-slate-800 shrink-0">
                {habit.icon}
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Micro-Practice Shortcuts */}
      <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[11px] text-slate-400">
          Need an instant mental reset right now?
        </span>

        <div className="flex items-center gap-2">
          {onOpenDefusion && (
            <button
              type="button"
              onClick={onOpenDefusion}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Thought Defusion</span>
            </button>
          )}

          {onOpenSimulator && (
            <button
              type="button"
              onClick={onOpenSimulator}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Award className="w-3.5 h-3.5 text-cyan-400" />
              <span>Neuro Simulator</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
