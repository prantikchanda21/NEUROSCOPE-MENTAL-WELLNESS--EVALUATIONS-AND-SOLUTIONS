import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sliders, 
  Brain, 
  Moon, 
  Coffee, 
  Smartphone, 
  Flame, 
  RotateCcw, 
  Info, 
  Zap, 
  Activity, 
  Sparkles,
  ShieldCheck,
  ChevronDown
} from 'lucide-react';

interface NeuroSimulatorProps {
  initialSleep?: number;
  initialCaffeine?: number;
  initialScreens?: number;
  initialExercise?: number;
}

export const NeurochemicalSimulatorModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [sleepHrs, setSleepHrs] = useState<number>(7.5);
  const [caffeineMg, setCaffeineMg] = useState<number>(150);
  const [screenMins, setScreenMins] = useState<number>(45);
  const [exerciseMins, setExerciseMins] = useState<number>(30);
  const [selectedMolecule, setSelectedMolecule] = useState<string | null>('dopamine');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Computed Neurotransmitter and Physiological Equilibrium (0-100)
  const dopamine = Math.min(100, Math.max(10, Math.round(
    30 + (exerciseMins * 0.7) + (sleepHrs >= 7 ? 25 : sleepHrs * 3) + (caffeineMg > 50 && caffeineMg <= 250 ? 20 : 0) - (screenMins > 90 ? 15 : 0)
  )));

  const adenosineClearance = Math.min(100, Math.max(10, Math.round(
    (sleepHrs / 8.5) * 100 - (caffeineMg > 300 ? 25 : 0)
  )));

  const cortisolArousal = Math.min(100, Math.max(10, Math.round(
    (caffeineMg / 400) * 45 + (sleepHrs < 6 ? 40 : 10) + (screenMins / 120) * 25 - (exerciseMins * 0.3)
  )));

  const gabaSerotonin = Math.min(100, Math.max(10, Math.round(
    40 + (exerciseMins * 0.6) + (sleepHrs >= 7 ? 30 : sleepHrs * 3) - (caffeineMg > 250 ? 20 : 0) - (screenMins > 60 ? 15 : 0)
  )));

  const prefrontalClarity = Math.min(100, Math.max(10, Math.round(
    (adenosineClearance * 0.4) + (gabaSerotonin * 0.35) + (dopamine * 0.25) - (cortisolArousal > 75 ? 30 : 0)
  )));

  const amygdalaReactivity = Math.min(100, Math.max(10, Math.round(
    cortisolArousal * 0.8 + (100 - gabaSerotonin) * 0.3
  )));

  // Interactive Live Canvas rendering the biological neural ripple
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;
    let t = 0;

    const render = () => {
      t += 0.035;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      // Brain silhouette base glow
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, w * 0.45);
      const glowAlpha = Math.min(0.7, 0.2 + (prefrontalClarity / 100) * 0.4);
      grad.addColorStop(0, `rgba(6, 182, 212, ${glowAlpha})`);
      grad.addColorStop(0.5, `rgba(168, 85, 247, ${0.15 + (dopamine / 100) * 0.25})`);
      grad.addColorStop(1, 'rgba(3, 7, 18, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // Draw Prefrontal Cortex Sector (Frontal Top/Left)
      const pfcAlpha = Math.min(1, Math.max(0.2, prefrontalClarity / 100));
      ctx.fillStyle = `rgba(56, 189, 248, ${pfcAlpha * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(cx - 50, cy - 35, 60 + Math.sin(t) * 4, 45, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(56, 189, 248, ${pfcAlpha * 0.9})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw Amygdala Sector (Center Limbic)
      const amyAlpha = Math.min(1, Math.max(0.2, amygdalaReactivity / 100));
      ctx.fillStyle = `rgba(244, 63, 94, ${amyAlpha * 0.55})`;
      ctx.beginPath();
      ctx.arc(cx + 15, cy + 15, 28 + Math.sin(t * 1.5) * (amyAlpha * 6), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(244, 63, 94, ${amyAlpha * 0.9})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Synaptic impulse arcs bridging Frontal Cortex to Amygdala
      const arcPoints = 6;
      ctx.strokeStyle = cortisolArousal > 60 ? 'rgba(251, 146, 60, 0.7)' : 'rgba(52, 211, 153, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= arcPoints; i++) {
        const prog = i / arcPoints;
        const x = (cx - 50) + prog * 65 + Math.sin(t * 3 + i) * 5;
        const y = (cy - 35) + prog * 50 + Math.cos(t * 2 + i) * 5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Labels on canvas
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText('Prefrontal Cortex', cx - 95, cy - 50);
      ctx.fillStyle = 'rgba(244, 63, 94, 0.9)';
      ctx.fillText('Limbic Amygdala', cx + 15, cy + 48);

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [isOpen, prefrontalClarity, amygdalaReactivity, cortisolArousal, dopamine]);

  if (!isOpen) return null;

  const moleculeInfo: Record<string, { title: string; role: string; drainedBy: string; replenishedBy: string }> = {
    dopamine: {
      title: 'Dopamine (Drive & Incentive Salience)',
      role: 'Fuels motivation, focus stamina, and reward anticipation.',
      drainedBy: 'Excessive rapid screen doom-scrolling, prolonged sleep debt, stimulants crash.',
      replenishedBy: 'Aerobic exercise, task completion momentum, morning natural sunlight.',
    },
    adenosine: {
      title: 'Adenosine (Sleep Pressure & Cellular Recovery)',
      role: 'Byproduct of cellular ATP breakdown that creates natural homeostatic sleep drive.',
      drainedBy: 'High late caffeine (which blocks adenosine receptors without clearing them).',
      replenishedBy: '7.5+ hours of uninterrupted sleep architecture (Stage 3 slow-wave sleep).',
    },
    gaba: {
      title: 'GABA & Serotonin (Neural Quieting & Mood Buffer)',
      role: 'Primary inhibitory neurotransmitter preventing runaway neuronal hyperexcitation.',
      drainedBy: 'Chronic psychological stress, alcohol rebound, severe circadian misalignment.',
      replenishedBy: 'Slow rhythmic breathing (4-7-8), magnesium-rich nutrition, resistance pacing.',
    },
    cortisol: {
      title: 'Cortisol & Epinephrine (HPA Arousal Drive)',
      role: 'Mobilizes glucose and sympathetic alert tone for real-world challenge response.',
      drainedBy: 'Under-recovery, late-night blue light exposure, hyper-caffeination.',
      replenishedBy: 'Physiological sighing, somatic grounding, predictable evening wind-down.',
    },
  };

  const currentMol = moleculeInfo[selectedMolecule || 'dopamine'];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl bg-slate-900 border border-cyan-500/40 p-5 sm:p-7 md:p-8 text-slate-100 shadow-2xl shadow-cyan-950/50 space-y-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
                <Sliders className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
                  <span>Interactive "What-If" Neurochemical Simulator</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Live Model
                  </span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-400">
                  Manipulate daily biological variables to see how your brain circuitry and neurotransmitter equilibrium shift in real-time.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Interactive Layout: Controls Left + Canvas/Metrics Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 6 cols: Biological Input Sliders */}
            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Daily Biological Inputs</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setSleepHrs(8);
                    setCaffeineMg(100);
                    setScreenMins(30);
                    setExerciseMins(30);
                  }}
                  className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Optimal</span>
                </button>
              </div>

              {/* Slider 1: Sleep Quality */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-2">
                    <Moon className="w-4 h-4 text-indigo-400" />
                    Sleep Duration & Architecture
                  </span>
                  <span className="font-mono font-bold text-cyan-400">{sleepHrs} hrs</span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="10"
                  step="0.5"
                  value={sleepHrs}
                  onChange={(e) => setSleepHrs(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>4 hrs (Severe debt)</span>
                  <span>7.5-8.5 hrs (Target)</span>
                  <span>10 hrs</span>
                </div>
              </div>

              {/* Slider 2: Caffeine Intake */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-amber-400" />
                    Caffeine Intake & Adenosine Block
                  </span>
                  <span className="font-mono font-bold text-amber-400">{caffeineMg} mg</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="500"
                  step="25"
                  value={caffeineMg}
                  onChange={(e) => setCaffeineMg(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>0 mg (Clean)</span>
                  <span>150 mg (1-2 cups)</span>
                  <span>500 mg (Overdrive)</span>
                </div>
              </div>

              {/* Slider 3: Screen Time Pre-Bed */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-rose-400" />
                    Evening Screen Exposure (Blue Light)
                  </span>
                  <span className="font-mono font-bold text-rose-400">{screenMins} mins</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="180"
                  step="15"
                  value={screenMins}
                  onChange={(e) => setScreenMins(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>0 mins (Melatonin intact)</span>
                  <span>45 mins</span>
                  <span>180+ mins</span>
                </div>
              </div>

              {/* Slider 4: Aerobic Exercise */}
              <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white flex items-center gap-2">
                    <Flame className="w-4 h-4 text-emerald-400" />
                    Aerobic Physical Movement (BDNF Stim)
                  </span>
                  <span className="font-mono font-bold text-emerald-400">{exerciseMins} mins</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="10"
                  value={exerciseMins}
                  onChange={(e) => setExerciseMins(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>0 mins (Sedentary)</span>
                  <span>30 mins (Optimal)</span>
                  <span>90 mins</span>
                </div>
              </div>
            </div>

            {/* Right 6 cols: Live Anatomical Canvas & Neurotransmitter Balances */}
            <div className="lg:col-span-6 space-y-4">
              {/* Canvas Imager */}
              <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-center">
                <div className="w-full flex items-center justify-between px-2 pb-2 text-[11px] text-slate-400 font-mono">
                  <span>Anatomical Circuit Reactivity</span>
                  <span className={prefrontalClarity > 65 ? 'text-emerald-400' : 'text-amber-400'}>
                    {prefrontalClarity > 65 ? 'Executive Dominance' : 'Limbic Hyperarousal'}
                  </span>
                </div>
                <canvas
                  ref={canvasRef}
                  width={340}
                  height={190}
                  className="rounded-xl w-full max-w-[340px] h-[190px]"
                />
              </div>

              {/* Dynamic Neurotransmitter Meters */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                {/* Dopamine */}
                <div 
                  onClick={() => setSelectedMolecule('dopamine')}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedMolecule === 'dopamine' ? 'bg-cyan-950/40 border-cyan-400' : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex justify-between items-center text-slate-300 font-medium">
                    <span>Dopamine (Drive)</span>
                    <span className="font-mono font-bold text-cyan-300">{dopamine}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                    <div className="h-full bg-cyan-400 transition-all duration-300" style={{ width: `${dopamine}%` }} />
                  </div>
                </div>

                {/* Adenosine Clearance */}
                <div 
                  onClick={() => setSelectedMolecule('adenosine')}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedMolecule === 'adenosine' ? 'bg-indigo-950/40 border-indigo-400' : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex justify-between items-center text-slate-300 font-medium">
                    <span>Adenosine Clearance</span>
                    <span className="font-mono font-bold text-indigo-300">{adenosineClearance}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                    <div className="h-full bg-indigo-400 transition-all duration-300" style={{ width: `${adenosineClearance}%` }} />
                  </div>
                </div>

                {/* GABA / Serotonin */}
                <div 
                  onClick={() => setSelectedMolecule('gaba')}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedMolecule === 'gaba' ? 'bg-emerald-950/40 border-emerald-400' : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex justify-between items-center text-slate-300 font-medium">
                    <span>GABA & Serotonin</span>
                    <span className="font-mono font-bold text-emerald-300">{gabaSerotonin}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                    <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${gabaSerotonin}%` }} />
                  </div>
                </div>

                {/* Cortisol Arousal */}
                <div 
                  onClick={() => setSelectedMolecule('cortisol')}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    selectedMolecule === 'cortisol' ? 'bg-rose-950/40 border-rose-400' : 'bg-slate-950/60 border-slate-800'
                  }`}
                >
                  <div className="flex justify-between items-center text-slate-300 font-medium">
                    <span>Cortisol (Arousal)</span>
                    <span className="font-mono font-bold text-rose-300">{cortisolArousal}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                    <div className="h-full bg-rose-500 transition-all duration-300" style={{ width: `${cortisolArousal}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Molecule Educational Explainer Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-slate-700/80 text-xs space-y-2">
            <div className="flex items-center gap-2 text-cyan-300 font-bold uppercase tracking-wider text-[11px]">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>{currentMol.title}</span>
            </div>
            <p className="text-slate-200 leading-relaxed font-medium">{currentMol.role}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px]">
              <div className="p-2 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-200">
                <span className="font-bold text-rose-300">Drained by: </span>
                {currentMol.drainedBy}
              </div>
              <div className="p-2 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-200">
                <span className="font-bold text-emerald-300">Replenished by: </span>
                {currentMol.replenishedBy}
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs text-slate-400">
            <span>Click any molecule to inspect physiological pathways</span>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all cursor-pointer"
            >
              Apply Understanding & Return
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
