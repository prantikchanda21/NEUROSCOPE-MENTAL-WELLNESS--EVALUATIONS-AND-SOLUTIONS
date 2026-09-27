import React, { useState } from 'react';
import { Sun, Moon, Volume2, VolumeX } from 'lucide-react';
import { neuralAudio } from '../utils/audio';

export interface LandscapeThemeOption {
  id: string;
  name: string;
  mode: 'sunshine' | 'moonlight';
  image: string;
  description: string;
}

// A single, exact background per mode: the user's own framed landscape
// artwork, served locally from /public/landscapes as a static image.
// The scene (pillars + pond) sits dead-centre in each source image, so
// rendering it with object-fit: cover / object-position: center keeps that
// centre point locked to the viewport centre at every screen size — which
// is exactly where the dashboard card is centred too, so the dashboard
// always reads as sitting "inside the frame", between the two pillars.
export const SUNSHINE_LANDSCAPES: LandscapeThemeOption[] = [
  {
    id: 'day_landscape_image',
    name: 'Day Landscape',
    mode: 'sunshine',
    image: '/landscapes/day-landscape.jpg',
    description: "The user's own sunlit framed landscape artwork",
  },
];

export const MOONLIGHT_LANDSCAPES: LandscapeThemeOption[] = [
  {
    id: 'night_landscape_image',
    name: 'Night Landscape',
    mode: 'moonlight',
    image: '/landscapes/night-landscape.jpg',
    description: "The user's own moonlit framed landscape artwork",
  },
];

interface RealisticGreeneryLandscapeProps {
  selectedLandscapeId?: string;
  onLandscapeChange?: (id: string) => void;
  showControls?: boolean;
  // Optional controlled mode: when provided, the parent (App) owns the
  // day/night state so it can theme the rest of the dashboard (glass panels,
  // etc.) in sync with the landscape. When omitted, the component falls back
  // to its own internal state exactly as before — fully backward compatible.
  isMoonlightMode?: boolean;
  onModeChange?: (isMoonlightMode: boolean) => void;
}

// Deterministic pseudo-random so the star field is identical on every render
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A thin layer of twinkling stars laid over the night landscape image,
 * confined to the upper sky band so it never washes out the foreground
 * scene. Deterministic positions + staggered CSS twinkle delays so it
 * reads as a living sky rather than static noise. */
const TwinklingStarsOverlay: React.FC = () => {
  const stars = React.useMemo(() => {
    const rand = mulberry32(71829);
    return Array.from({ length: 90 }).map(() => ({
      xPct: rand() * 100,
      yPct: rand() * 42,
      size: 0.6 + rand() * 1.6,
      opacity: 0.25 + rand() * 0.6,
      delay: rand() * 6,
      duration: 2.5 + rand() * 3.5,
    }));
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white animate-star-twinkle"
          style={{
            left: `${s.xPct}%`,
            top: `${s.yPct}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            opacity: s.opacity,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
            boxShadow: s.size > 1.6 ? '0 0 4px 1px rgba(255,255,255,0.6)' : undefined,
          }}
        />
      ))}
    </div>
  );
};

export const RealisticGreeneryLandscape: React.FC<RealisticGreeneryLandscapeProps> = ({
  showControls = true,
  isMoonlightMode: controlledIsMoonlightMode,
  onModeChange,
}) => {
  const [internalIsMoonlightMode, setInternalIsMoonlightMode] = useState<boolean>(false);
  const isControlled = controlledIsMoonlightMode !== undefined;
  const isMoonlightMode = isControlled ? controlledIsMoonlightMode! : internalIsMoonlightMode;
  const [isMuted, setIsMuted] = useState<boolean>(neuralAudio.getIsMuted());

  const sunshineLandscape = SUNSHINE_LANDSCAPES[0];
  const moonlightLandscape = MOONLIGHT_LANDSCAPES[0];

  const toggleMoonlightMode = () => {
    const next = !isMoonlightMode;
    if (!isControlled) {
      setInternalIsMoonlightMode(next);
    }
    onModeChange?.(next);
  };

  const toggleSound = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    neuralAudio.setMuted(nextMuted);
    if (!nextMuted) {
      neuralAudio.playGentleChime();
    }
  };

  return (
    <>
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none">
      {/* PHOTOREALISTIC LANDSCAPE VIDEO LAYER (Sunshine & Moonlight layers crossfade smoothly).
          Each mode's own sun/moon and light already live in this footage —
          nothing is drawn on top of it, so there's exactly one sun and one
          moon on screen at a time. */}
      <div className="absolute inset-0 w-full h-full">
        {/* Day: Sunshine landscape */}
        <div
          className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ease-in-out ${
            isMoonlightMode ? 'opacity-0' : 'opacity-100'
          }`}
          aria-hidden={isMoonlightMode}
        >
          {/* object-cover + object-center: the framed scene sits dead-centre
              in the source artwork, so this keeps that centre point locked
              to the viewport centre — lining the dashboard card up between
              the two pillars at every screen size. */}
          <img
            src={sunshineLandscape.image}
            alt={sunshineLandscape.name}
            className="w-full h-full object-cover object-center"
            draggable={false}
            decoding="async"
            // @ts-expect-error fetchpriority is valid HTML but not yet in React's typings
            fetchpriority="high"
          />
          {/* Delicate edge vignette only (no color/tint shift on the artwork
              itself) — keeps the frame's corners a touch darker so
              foreground UI text stays readable without altering the
              landscape's own colors. */}
          <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(2,15,10,0.4)] pointer-events-none" />
        </div>

        {/* Night: Moonlight landscape */}
        <div
          className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ease-in-out ${
            isMoonlightMode ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden={!isMoonlightMode}
        >
          <img
            key={moonlightLandscape.id}
            src={moonlightLandscape.image}
            alt={moonlightLandscape.name}
            className="absolute inset-0 w-full h-full object-cover object-center"
            draggable={false}
            decoding="async"
          />
          {/* Twinkling starfield laid over the artwork too, confined to the
              upper sky so the foreground scene stays untouched. */}
          <TwinklingStarsOverlay />
          {/* Dark Sky Vignette only (no color/tint shift on the artwork itself) —
              keeps the frame's corners a touch darker so foreground UI text
              stays readable without altering the landscape's own colors. */}
          <div className="absolute inset-0 shadow-[inset_0_0_150px_rgba(0,0,0,0.5)] pointer-events-none" />
        </div>
      </div>

      {/* GENTLE MOUNTAIN BREEZE PARTICLES */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-10 animate-breeze">
        <div
          className={`absolute top-[35%] left-[22%] w-2 h-3 rounded-full blur-[0.5px] rotate-45 transform ${
            isMoonlightMode ? 'bg-cyan-300/35' : 'bg-emerald-400/40'
          }`}
        />
        <div
          className={`absolute top-[48%] right-[28%] w-2.5 h-1.5 rounded-full blur-[0.5px] -rotate-12 transform ${
            isMoonlightMode ? 'bg-sky-200/45' : 'bg-amber-300/50'
          }`}
        />
        <div
          className={`absolute top-[62%] left-[45%] w-1.5 h-2 rounded-full blur-[0.5px] rotate-65 transform ${
            isMoonlightMode ? 'bg-indigo-300/30' : 'bg-emerald-300/35'
          }`}
        />
      </div>
    </div>

    {/* Controls live OUTSIDE the fixed z-0 scenery layer. Inside it they were trapped in its stacking
        context and the page content (z-10) sat on top of them, swallowing every click. */}
    {/* DISCRETE CONTROLS: A SINGLE SMALL DYNAMIC TOGGLE (SUNSHINE <-> MOONLIGHT) + SOUND */}
      {showControls && (
        <div className="fixed bottom-4 left-4 z-40 pointer-events-auto flex items-center gap-2">
          {/* SMALL SLIDING DAY / NIGHT TOGGLE SWITCH */}
          <button
            type="button"
            role="switch"
            aria-checked={isMoonlightMode}
            id="landscape-day-night-toggle-btn"
            onClick={toggleMoonlightMode}
            className={`relative w-12 h-6 rounded-full border backdrop-blur-xl shadow-lg cursor-pointer overflow-hidden transition-all duration-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${
              isMoonlightMode
                ? 'bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-800 border-sky-400/40 shadow-sky-950/50'
                : 'bg-gradient-to-r from-sky-400 via-sky-300 to-amber-200 border-amber-300/60 shadow-amber-950/40'
            }`}
            title={isMoonlightMode ? 'Switch to Sunshine Landscape' : 'Switch to Night Moonlight Landscape'}
            aria-label="Toggle Sunshine or Night Moonlight"
          >
            {/* Track decoration: twinkling stars (night) */}
            <span
              className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
                isMoonlightMode ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <span className="absolute top-1.5 left-2 w-[3px] h-[3px] rounded-full bg-white animate-pulse" />
              <span className="absolute top-3.5 left-4 w-[2px] h-[2px] rounded-full bg-sky-200" />
              <span className="absolute top-2 left-6 w-[2px] h-[2px] rounded-full bg-white/80" />
            </span>
            {/* Track decoration: soft cloud (day) */}
            <span
              className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
                isMoonlightMode ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <span className="absolute bottom-1 right-2 w-3 h-1.5 rounded-full bg-white/70 blur-[0.5px]" />
              <span className="absolute bottom-2.5 right-4 w-2 h-1 rounded-full bg-white/60 blur-[0.5px]" />
            </span>

            {/* Sliding knob */}
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full flex items-center justify-center shadow-md transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isMoonlightMode
                  ? 'translate-x-6 bg-slate-100 shadow-sky-300/40'
                  : 'translate-x-0 bg-amber-300 shadow-amber-500/50'
              }`}
            >
              {isMoonlightMode ? (
                <Moon className="w-3 h-3 text-slate-700" />
              ) : (
                <Sun className="w-3 h-3 text-amber-600" />
              )}
            </span>
          </button>

          {/* Sound Toggle */}
          <button
            type="button"
            id="nature-sound-toggle-btn"
            onClick={toggleSound}
            className="p-2 rounded-2xl bg-slate-950/70 hover:bg-slate-900/85 backdrop-blur-xl border border-slate-700/60 text-slate-300 hover:text-white text-xs shadow-lg transition-all cursor-pointer"
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-slate-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
          </button>
        </div>
      )}
    </>
  );
};
