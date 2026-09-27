import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface HelixWaveEffectProps {
  duration?: number;
  variant?: 'card' | 'fullscreen';
  className?: string;
  onComplete?: () => void;
}

export const HelixWaveEffect: React.FC<HelixWaveEffectProps> = ({
  duration = 1100,
  variant = 'card',
  className = '',
  onComplete,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onComplete?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  // Dimensions
  const width = variant === 'fullscreen' ? 1000 : 640;
  const height = variant === 'fullscreen' ? 320 : 200;
  const numPairs = variant === 'fullscreen' ? 24 : 16;

  // Generate double helix base pairs
  const basePairs = Array.from({ length: numPairs }).map((_, i) => {
    const progress = i / (numPairs - 1);
    const x = 30 + progress * (width - 60);
    const phase = progress * Math.PI * 4; // 2 complete twists
    const yOffset = Math.sin(phase) * (height * 0.35);
    const zDepth = Math.cos(phase); // for pseudo-3D opacity/scale
    const y1 = height / 2 + yOffset;
    const y2 = height / 2 - yOffset;

    return {
      x,
      y1,
      y2,
      zDepth,
      progress,
    };
  });

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: 'easeOut' } }}
          className={`absolute inset-0 pointer-events-none z-30 flex items-center justify-center overflow-hidden ${className}`}
        >
          {/* Luminous Central Helix Glow */}
          <motion.div
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{
              scale: [0.2, 1.2, 1.8],
              opacity: [0, 0.8, 0],
            }}
            transition={{ duration: 1.0, ease: 'easeOut' }}
            className="absolute w-96 h-48 rounded-full bg-radial from-cyan-400/35 via-emerald-400/20 to-transparent blur-2xl"
          />

          {/* SVG Double Helix Strand Overlay */}
          <motion.svg
            viewBox={`0 0 ${width} ${height}`}
            initial={{ scaleX: 0.1, scaleY: 0.4, opacity: 0.3, rotate: -8 }}
            animate={{
              scaleX: [0.1, 1.05, 1.15],
              scaleY: [0.4, 1, 1.05],
              opacity: [0.3, 1, 0],
              rotate: [-8, 0, 4],
            }}
            transition={{
              duration: 1.05,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="w-full h-full max-w-[1100px] max-h-[380px] mix-blend-screen drop-shadow-[0_0_16px_rgba(6,182,212,0.65)]"
          >
            <defs>
              <linearGradient id="helixGradCyan" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.2" />
                <stop offset="30%" stopColor="#22d3ee" stopOpacity="0.95" />
                <stop offset="70%" stopColor="#a7f3d0" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#34d399" stopOpacity="0.2" />
              </linearGradient>

              <linearGradient id="helixGradGold" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
                <stop offset="35%" stopColor="#fde047" stopOpacity="0.95" />
                <stop offset="65%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.2" />
              </linearGradient>

              <filter id="helixGlow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Connecting Base Pair Hydrogen Bonds / Rungs */}
            {basePairs.map((p, idx) => {
              const alpha = Math.max(0.2, (p.zDepth + 1) / 2);
              return (
                <line
                  key={`rung-${idx}`}
                  x1={p.x}
                  y1={p.y1}
                  x2={p.x}
                  y2={p.y2}
                  stroke="url(#helixGradCyan)"
                  strokeWidth={1.5 + alpha * 1.5}
                  strokeDasharray="2 3"
                  opacity={alpha * 0.75}
                />
              );
            })}

            {/* Helix Strand 1 Nodes (Top Strand Wave) */}
            {basePairs.map((p, idx) => {
              const radius = 2.5 + ((p.zDepth + 1) / 2) * 3.5;
              const alpha = 0.35 + ((p.zDepth + 1) / 2) * 0.65;
              return (
                <circle
                  key={`node1-${idx}`}
                  cx={p.x}
                  cy={p.y1}
                  r={radius}
                  fill="url(#helixGradCyan)"
                  filter="url(#helixGlow)"
                  opacity={alpha}
                />
              );
            })}

            {/* Helix Strand 2 Nodes (Bottom Strand Wave) */}
            {basePairs.map((p, idx) => {
              const radius = 2.5 + ((1 - p.zDepth) / 2) * 3.5;
              const alpha = 0.35 + ((1 - p.zDepth) / 2) * 0.65;
              return (
                <circle
                  key={`node2-${idx}`}
                  cx={p.x}
                  cy={p.y2}
                  r={radius}
                  fill="url(#helixGradGold)"
                  filter="url(#helixGlow)"
                  opacity={alpha}
                />
              );
            })}
          </motion.svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
