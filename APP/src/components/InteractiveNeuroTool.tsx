import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Play, Pause, RotateCcw, Check, Wind, Clock, Eye, Sparkles, CheckCircle2 } from 'lucide-react';
import { recordToolCompleted } from '../utils/historyStorage';

interface InteractiveNeuroToolProps {
  toolType: 'breathing' | 'timer' | 'grounding' | 'journal';
  toolTitle: string;
}

export const InteractiveNeuroTool: React.FC<InteractiveNeuroToolProps> = ({
  toolType,
  toolTitle,
}) => {
  // Breathing state
  const [breathingActive, setBreathingActive] = useState(false);
  const [breathPhase, setBreathPhase] = useState<'inhale1' | 'inhale2' | 'exhale' | 'settle'>('inhale1');
  const [breathSecondsLeft, setBreathSecondsLeft] = useState(4);
  const [breathCycles, setBreathCycles] = useState(0);

  // Timer state (90-second urge surf or pause)
  const [timerDuration, setTimerDuration] = useState(90);
  const [timerLeft, setTimerLeft] = useState(90);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerDone, setTimerDone] = useState(false);

  // Grounding state
  const [groundingSteps, setGroundingSteps] = useState([
    { id: 1, label: '5 distinct physical objects you see', count: 5, checked: false },
    { id: 2, label: '4 textures or physical surfaces you can touch', count: 4, checked: false },
    { id: 3, label: '3 distinct sounds in your auditory field', count: 3, checked: false },
    { id: 4, label: '2 scents or ambient air sensations', count: 2, checked: false },
    { id: 5, label: '1 taste or gentle tongue/mouth sensation', count: 1, checked: false },
  ]);

  // Micro-journal state
  const [journalInput, setJournalInput] = useState('');
  const [savedAnchor, setSavedAnchor] = useState<string | null>(null);

  // Breathing Engine Effect
  useEffect(() => {
    if (!breathingActive) return;

    const interval = setInterval(() => {
      setBreathSecondsLeft((prev) => {
        if (prev > 1) return prev - 1;

        // Advance phase
        if (breathPhase === 'inhale1') {
          setBreathPhase('inhale2');
          return 2; // quick top-off sniff
        } else if (breathPhase === 'inhale2') {
          setBreathPhase('exhale');
          return 7; // long parasympathetic mouth exhale
        } else if (breathPhase === 'exhale') {
          setBreathPhase('settle');
          return 2; // brief reset
        } else {
          setBreathCycles((c) => {
            const next = c + 1;
            if (next >= 2) {
              recordToolCompleted('habit_sigh');
            }
            return next;
          });
          setBreathPhase('inhale1');
          return 4; // primary deep nasal inhale
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [breathingActive, breathPhase]);

  // Urge Timer Engine Effect
  useEffect(() => {
    if (!timerRunning || timerLeft <= 0) return;

    const interval = setInterval(() => {
      setTimerLeft((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          setTimerDone(true);
          recordToolCompleted('interactive_timer');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerRunning, timerLeft]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleGroundingItem = (id: number) => {
    setGroundingSteps((prev) => {
      const updated = prev.map((step) => (step.id === id ? { ...step, checked: !step.checked } : step));
      if (updated.every((s) => s.checked)) {
        recordToolCompleted('interactive_grounding');
      }
      return updated;
    });
  };

  const handleSaveAnchor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!journalInput.trim()) return;
    setSavedAnchor(journalInput.trim());
    setJournalInput('');
    recordToolCompleted('interactive_journal');
  };

  return (
    <div className="mt-3 p-4 rounded-2xl bg-slate-950/80 border border-cyan-500/20 shadow-inner">
      {/* Tool Header */}
      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
          {toolType === 'breathing' && <Wind className="w-3.5 h-3.5" />}
          {toolType === 'timer' && <Clock className="w-3.5 h-3.5" />}
          {toolType === 'grounding' && <Eye className="w-3.5 h-3.5" />}
          {toolType === 'journal' && <Sparkles className="w-3.5 h-3.5" />}
          <span className="uppercase tracking-wider">Live Neuro-Tool</span>
        </div>
        <span className="text-[11px] text-slate-400 font-medium">{toolTitle}</span>
      </div>

      {/* 1. BREATHING PACER TOOL */}
      {toolType === 'breathing' && (
        <div className="flex flex-col items-center justify-center py-3 space-y-4">
          <div className="relative flex items-center justify-center w-36 h-36">
            {/* Outer expanding guide ring */}
            <motion.div
              animate={{
                scale:
                  breathPhase === 'inhale1'
                    ? 1.35
                    : breathPhase === 'inhale2'
                    ? 1.5
                    : breathPhase === 'exhale'
                    ? 0.85
                    : 1.0,
                opacity: breathingActive ? 0.8 : 0.3,
              }}
              transition={{ duration: breathPhase === 'inhale2' ? 1.5 : 3.5, ease: 'easeInOut' }}
              className="absolute inset-0 rounded-full bg-gradient-to-tr from-cyan-500/20 via-sky-500/30 to-indigo-500/20 blur-sm"
            />

            {/* Inner Core Circle */}
            <motion.div
              animate={{
                scale:
                  breathPhase === 'inhale1'
                    ? 1.2
                    : breathPhase === 'inhale2'
                    ? 1.3
                    : breathPhase === 'exhale'
                    ? 0.9
                    : 1.0,
              }}
              transition={{ duration: breathPhase === 'inhale2' ? 1.5 : 3.5, ease: 'easeInOut' }}
              className="relative z-10 flex flex-col items-center justify-center w-28 h-28 rounded-full bg-slate-900 border-2 border-cyan-400/50 shadow-lg text-center p-2"
            >
              <span className="text-xl font-bold font-mono text-cyan-200">
                {breathingActive ? breathSecondsLeft : '4'}s
              </span>
              <span className="text-[10px] font-medium text-slate-300 leading-tight mt-0.5">
                {!breathingActive && 'Ready'}
                {breathingActive && breathPhase === 'inhale1' && 'Deep Inhale'}
                {breathingActive && breathPhase === 'inhale2' && 'Sniff Top-Off'}
                {breathingActive && breathPhase === 'exhale' && 'Slow Mouth Exhale'}
                {breathingActive && breathPhase === 'settle' && 'Gentle Pause'}
              </span>
            </motion.div>
          </div>

          <div className="text-center space-y-1">
            <p className="text-xs text-slate-300 font-medium">
              {breathingActive
                ? breathPhase === 'inhale1'
                  ? 'Inhale fully through your nose into lower belly'
                  : breathPhase === 'inhale2'
                  ? 'Take a sharp second sniff to fill alveolar pockets'
                  : breathPhase === 'exhale'
                  ? 'Release unforced sigh through open mouth (Vagal Brake)'
                  : 'Let body settle naturally'
                : 'Guided Physiological Sigh: 2 inhales, 1 prolonged exhale.'}
            </p>
            {breathCycles > 0 && (
              <p className="text-[11px] text-cyan-400 font-mono">
                {breathCycles} {breathCycles === 1 ? 'cycle' : 'cycles'} completed
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBreathingActive(!breathingActive)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                breathingActive
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                  : 'bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400'
              }`}
            >
              {breathingActive ? (
                <>
                  <Pause className="w-3.5 h-3.5" /> Pause Pacer
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Start Paced Breathing
                </>
              )}
            </button>

            {breathCycles > 0 && (
              <button
                type="button"
                onClick={() => {
                  setBreathingActive(false);
                  setBreathCycles(0);
                  setBreathPhase('inhale1');
                  setBreathSecondsLeft(4);
                }}
                className="p-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800 transition-colors"
                title="Reset Cycles"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. 90-SECOND URGE SURFER / NEURO-PAUSE TIMER */}
      {toolType === 'timer' && (
        <div className="py-2 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-300">
              {timerDone ? 'Neurochemical Surge Metabolized' : 'Biological Wave Surfing'}
            </span>
            <span className="text-2xl font-bold font-mono text-cyan-300">
              {formatTimer(timerLeft)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ${
                timerDone ? 'bg-emerald-400' : 'bg-gradient-to-r from-cyan-500 to-indigo-500'
              }`}
              style={{ width: `${((timerDuration - timerLeft) / timerDuration) * 100}%` }}
            />
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            {timerDone
              ? '90 seconds elapsed. The acute surge of adrenaline or craving has crossed its physiological crest. Breathe deeply and choose your conscious response.'
              : 'Notice the urge as a bodily wave. Do not fight it; watch it rise, peak, and begin its biological half-life decline without acting on reflex.'}
          </p>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (timerDone) {
                  setTimerLeft(timerDuration);
                  setTimerDone(false);
                  setTimerRunning(true);
                } else {
                  setTimerRunning(!timerRunning);
                }
              }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                timerRunning
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400'
              }`}
            >
              {timerRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5" /> Pause Wave
                </>
              ) : timerDone ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" /> Surf Another Wave
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Start 90-Second Wave
                </>
              )}
            </button>

            {(timerLeft < timerDuration || timerDone) && (
              <button
                type="button"
                onClick={() => {
                  setTimerRunning(false);
                  setTimerLeft(timerDuration);
                  setTimerDone(false);
                }}
                className="px-3 py-2 rounded-xl text-xs text-slate-400 hover:text-white bg-slate-900 border border-slate-800 transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. 5-4-3-2-1 GROUNDING CHECKLIST */}
      {toolType === 'grounding' && (
        <div className="py-2 space-y-2.5">
          <p className="text-xs text-slate-300">
            Anchor your somatosensory cortex by registering concrete inputs in your environment:
          </p>

          <div className="space-y-1.5">
            {groundingSteps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => toggleGroundingItem(step.id)}
                className={`w-full p-2.5 rounded-xl border flex items-center justify-between text-left transition-colors ${
                  step.checked
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200 line-through opacity-85'
                    : 'bg-slate-900/60 border-slate-800 text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      step.checked
                        ? 'bg-emerald-500/30 text-emerald-300'
                        : 'bg-cyan-500/20 text-cyan-300'
                    }`}
                  >
                    {step.checked ? <Check className="w-3 h-3" /> : step.count}
                  </span>
                  <span>{step.label}</span>
                </div>
              </button>
            ))}
          </div>

          {groundingSteps.every((s) => s.checked) && (
            <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>Full sensory circuit anchored. You are grounded in this physical moment.</span>
            </div>
          )}
        </div>
      )}

      {/* 4. MICRO-INTENT / REFLECTION JOURNAL */}
      {toolType === 'journal' && (
        <div className="py-2 space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">
            Externalize your commitment to free working memory and prime prefrontal agency:
          </p>

          {savedAnchor ? (
            <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-purple-400" />
                  Your Anchored Intention
                </span>
                <button
                  type="button"
                  onClick={() => setSavedAnchor(null)}
                  className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                >
                  Edit
                </button>
              </div>
              <p className="text-xs text-purple-100 font-medium italic">"{savedAnchor}"</p>
            </div>
          ) : (
            <form onSubmit={handleSaveAnchor} className="space-y-2">
              <input
                type="text"
                value={journalInput}
                onChange={(e) => setJournalInput(e.target.value)}
                placeholder="E.g., Take 15-min phone-free walk, set 7pm email boundary..."
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={!journalInput.trim()}
                className="px-3 py-1.5 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 disabled:opacity-50 transition-colors"
              >
                Anchor This Intention
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
