import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  Coffee,
  Dumbbell,
  Info,
  Moon,
  Ruler,
  Save,
  ShieldCheck,
  UserRound,
  Weight,
  Wine,
} from 'lucide-react';
import type { WellnessProfile } from '../utils/wellnessProfileStorage';

interface WellnessProfileCardProps {
  initialProfile?: WellnessProfile | null;
  onSave: (profile: Omit<WellnessProfile, 'updatedAt'>) => void;
  onSkip: () => void;
}

type Step = 1 | 2;

const asNumber = (value: string): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && value.trim() !== '' ? n : undefined;
};

export const WellnessProfileCard: React.FC<WellnessProfileCardProps> = ({
  initialProfile,
  onSave,
  onSkip,
}) => {
  const [step, setStep] = useState<Step>(1);
  const [age, setAge] = useState(initialProfile?.age?.toString() || '');
  const [heightCm, setHeightCm] = useState(initialProfile?.heightCm?.toString() || '');
  const [weightKg, setWeightKg] = useState(initialProfile?.weightKg?.toString() || '');
  const [sleepHours, setSleepHours] = useState(initialProfile?.sleepHours?.toString() || '');
  const [exerciseFrequency, setExerciseFrequency] = useState<WellnessProfile['exerciseFrequency']>(initialProfile?.exerciseFrequency);
  const [caffeineCups, setCaffeineCups] = useState(initialProfile?.caffeineCups?.toString() || '');
  const [tobacco, setTobacco] = useState<WellnessProfile['tobacco']>(initialProfile?.tobacco);
  const [alcohol, setAlcohol] = useState<WellnessProfile['alcohol']>(initialProfile?.alcohol);
  const [medications, setMedications] = useState(initialProfile?.medications || '');
  const [physicalNotes, setPhysicalNotes] = useState(initialProfile?.physicalNotes || '');
  const [useForPersonalization, setUseForPersonalization] = useState(initialProfile?.useForPersonalization !== false);
  const [error, setError] = useState('');

  const stepLabel = useMemo(() => (step === 1 ? 'Basics' : 'Lifestyle & context'), [step]);

  const next = () => {
    setError('');
    const ageValue = asNumber(age);
    if (age.trim() && (!ageValue || ageValue < 13 || ageValue > 120)) {
      setError('Please enter an age between 13 and 120, or leave it blank.');
      return;
    }
    setStep(2);
  };

  const save = () => {
    setError('');
    const ageValue = asNumber(age);
    const heightValue = asNumber(heightCm);
    const weightValue = asNumber(weightKg);
    const sleepValue = asNumber(sleepHours);
    const caffeineValue = asNumber(caffeineCups);

    if (heightValue !== undefined && (heightValue < 80 || heightValue > 250)) {
      setError('Height should be between 80 and 250 cm.');
      return;
    }
    if (weightValue !== undefined && (weightValue < 20 || weightValue > 350)) {
      setError('Weight should be between 20 and 350 kg.');
      return;
    }
    if (sleepValue !== undefined && (sleepValue < 0 || sleepValue > 24)) {
      setError('Sleep should be between 0 and 24 hours.');
      return;
    }
    if (caffeineValue !== undefined && (caffeineValue < 0 || caffeineValue > 30)) {
      setError('Caffeine should be between 0 and 30 cups/day.');
      return;
    }

    onSave({
      age: ageValue,
      heightCm: heightValue,
      weightKg: weightValue,
      sleepHours: sleepValue,
      exerciseFrequency,
      caffeineCups: caffeineValue,
      tobacco,
      alcohol,
      medications: medications.trim() || undefined,
      physicalNotes: physicalNotes.trim() || undefined,
      useForPersonalization,
    });
  };

  return (
    <motion.div
      key="wellness-profile"
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.32 }}
      className="mx-auto w-full max-w-[760px]"
    >
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,.08)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-600">Personal wellness profile</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">A little context helps</h2>
              <p className="mt-1.5 max-w-xl text-sm font-medium leading-relaxed text-slate-500">
                Add optional physical and lifestyle details so you have a fuller personal record. You can skip anything you do not want to share.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            Skip
          </button>
        </div>

        <div className="mt-6 flex items-center gap-2">
          {[1, 2].map((item) => (
            <div key={item} className="flex flex-1 items-center gap-2">
              <div className={`h-2 flex-1 rounded-full ${step >= item ? 'bg-emerald-500' : 'bg-slate-100'}`} />
              <span className={`text-[10px] font-black uppercase tracking-wider ${step === item ? 'text-emerald-600' : 'text-slate-400'}`}>
                {item}
              </span>
            </div>
          ))}
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{stepLabel}</span>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="profile-basics"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              className="mt-6 space-y-5"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field icon={<CalendarDays className="h-4 w-4" />} label="Age" hint="years" value={age} onChange={setAge} inputMode="numeric" />
                <Field icon={<Ruler className="h-4 w-4" />} label="Height" hint="cm" value={heightCm} onChange={setHeightCm} inputMode="decimal" />
                <Field icon={<Weight className="h-4 w-4" />} label="Weight" hint="kg" value={weightKg} onChange={setWeightKg} inputMode="decimal" />
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="text-xs font-semibold leading-relaxed text-emerald-900/80">
                    These fields are optional and are saved locally on this device in the current app build. NeuroScope does not require them to run the assessment.
                  </p>
                </div>
              </div>

              {error && <ErrorText>{error}</ErrorText>}

              <button
                type="button"
                onClick={next}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800 active:scale-[.99]"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="profile-lifestyle"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              className="mt-6 space-y-5"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field icon={<Moon className="h-4 w-4" />} label="Average sleep" hint="hours/night" value={sleepHours} onChange={setSleepHours} inputMode="decimal" />
                <Field icon={<Coffee className="h-4 w-4" />} label="Caffeine" hint="cups/day" value={caffeineCups} onChange={setCaffeineCups} inputMode="numeric" />
              </div>

              <ChoiceField
                icon={<Dumbbell className="h-4 w-4" />}
                label="Exercise / movement"
                value={exerciseFrequency}
                options={[
                  ['rarely', 'Rarely'],
                  ['1-2x', '1–2× / week'],
                  ['3-4x', '3–4× / week'],
                  ['5+x', '5+× / week'],
                ]}
                onChange={(value) => setExerciseFrequency(value as WellnessProfile['exerciseFrequency'])}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ChoiceField
                  icon={<UserRound className="h-4 w-4" />}
                  label="Tobacco / nicotine"
                  value={tobacco}
                  options={[
                    ['never', 'Never'],
                    ['sometimes', 'Sometimes'],
                    ['daily', 'Daily'],
                    ['prefer-not-to-say', 'Prefer not to say'],
                  ]}
                  onChange={(value) => setTobacco(value as WellnessProfile['tobacco'])}
                />
                <ChoiceField
                  icon={<Wine className="h-4 w-4" />}
                  label="Alcohol"
                  value={alcohol}
                  options={[
                    ['never', 'Never'],
                    ['sometimes', 'Sometimes'],
                    ['often', 'Often'],
                    ['prefer-not-to-say', 'Prefer not to say'],
                  ]}
                  onChange={(value) => setAlcohol(value as WellnessProfile['alcohol'])}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextareaField label="Current medications (optional)" value={medications} onChange={setMedications} placeholder="Only share what you're comfortable recording" />
                <TextareaField label="Physical notes (optional)" value={physicalNotes} onChange={setPhysicalNotes} placeholder="Anything about your physical state you'd like kept with your profile" />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <input
                  type="checkbox"
                  checked={useForPersonalization}
                  onChange={(event) => setUseForPersonalization(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600"
                />
                <span>
                  <span className="block text-sm font-extrabold text-slate-800">Use my profile to personalize NeuroScope</span>
                  <span className="mt-1 block text-xs font-medium leading-relaxed text-slate-500">When enabled, relevant details can shape AI explanations, lifestyle suggestions, follow-up chat, and your final report. They do not change the mental-health screening score.</span>
                </span>
              </label>

              {error && <ErrorText>{error}</ErrorText>}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={save}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 sm:flex-none"
                >
                  <Save className="h-4 w-4" />
                  Save & Continue
                  <Check className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-center gap-2 text-[11px] font-semibold text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                Optional profile • You can edit or skip this later
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

function Field({
  icon,
  label,
  hint,
  value,
  onChange,
  inputMode,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <label className="block rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
      <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500">
        <span className="text-emerald-600">{icon}</span>
        {label}
        <span className="ml-auto normal-case tracking-normal text-[10px] font-semibold text-slate-400">{hint}</span>
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        className="mt-2 w-full border-0 bg-transparent px-0 py-1 text-xl font-black text-slate-900 outline-none"
        placeholder="—"
      />
    </label>
  );
}

function ChoiceField({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500">
        <span className="text-emerald-600">{icon}</span>
        {label}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map(([option, labelText]) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-xl border px-3 py-3 text-left text-xs font-bold transition ${value === option ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {labelText}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextareaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
      <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={placeholder}
        className="mt-2 min-h-[100px] w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm font-medium text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
      />
    </label>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-3 text-xs font-bold text-rose-700">{children}</p>;
}
