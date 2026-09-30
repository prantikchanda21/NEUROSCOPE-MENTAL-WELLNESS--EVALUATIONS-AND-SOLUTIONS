import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface SpiralVortexEffectProps {
  duration?: number; // duration in ms
  variant?: 'card' | 'fullscreen';
  className?: string;
  onComplete?: () => void;
}

// Generate SVG path for a golden logarithmic spiral: r = a * e^(b * theta)
function generateSpiralPath(
  cx: number,
  cy: number,
  a: number,
  b: number,
  maxTheta: number,
  step = 0.05,
  rotationOffset = 0
): string {
  let path = '';
  let isFirst = true;

  for (let theta = 0; theta <= maxTheta; theta += step) {
    const r = a * Math.exp(b * theta);
    const angle = theta + rotationOffset;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);

    if (isFirst) {
      path += `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      isFirst = false;
    } else {
      path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
  }

  return path;
}

export const SpiralVortexEffect: React.FC<SpiralVortexEffectProps> = ({
  duration = 1200,
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
  const size = variant === 'fullscreen' ? 1000 : 600;
  const cx = size / 2;
  const cy = size / 2;

  // 3 Intertwined Fibonacci / Logarithmic Spiral Arms
  const arm1 = generateSpiralPath(cx, cy, 3, 0.17, 3.8 * Math.PI, 0.04, 0);
  const arm2 = generateSpiralPath(cx, cy, 3, 0.17, 3.8 * Math.PI, 0.04, (2 * Math.PI) / 3);
  const arm3 = generateSpiralPath(cx, cy, 3, 0.17, 3.8 * Math.PI, 0.04, (4 * Math.PI) / 3);

  // Spiral Sparkle Particles along the vortex
  const particles = [
    { angle: 0.8, r: 40, size: 4, color: '#fef08a' },
    { angle: 1.5, r: 80, size: 5, color: '#38bdf8' },
    { angle: 2.3, r: 130, size: 6, color: '#34d399' },
    { angle: 3.1, r: 180, size: 5, color: '#fbbf24' },
    { angle: 4.0, r: 230, size: 4, color: '#67e8f9' },
    { angle: 4.8, r: 280, size: 5, color: '#fde047' },
    { angle: 5.5, r: 330, size: 3, color: '#a7f3d0' },
    { angle: 6.2, r: 380, size: 4, color: '#38bdf8' },
    { angle: 7.0, r: 430, size: 5, color: '#f59e0b' },
  ];

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeOut' } }}
          className={`absolute inset-0 pointer-events-none z-30 flex items-center justify-center overflow-hidden ${className}`}
        >
          {/* Luminous Central Radial Core Bloom */}
          <motion.div
            initial={{ scale: 0.1, opacity: 0 }}
            animate={{
              scale: [0.1, 1.4, 2.2],
              opacity: [0, 0.85, 0],
            }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            className="absolute w-72 h-72 rounded-full bg-radial from-amber-300/40 via-cyan-400/25 to-transparent blur-2xl"
          />

          {/* SVG Spiral Vortex */}
          <motion.svg
            viewBox={`0 0 ${size} ${size}`}
            initial={{ scale: 0.2, rotate: -240, opacity: 0.2 }}
            animate={{
              scale: [0.2, 1.1, 1.6],
              rotate: [-240, -40, 60],
              opacity: [0.2, 1, 0],
            }}
            transition={{
              duration: 1.15,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="w-full h-full max-w-[900px] max-h-[900px] mix-blend-screen drop-shadow-[0_0_20px_rgba(56,189,248,0.6)]"
          >
            <defs>
              <linearGradient id="spiralGradGold" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="30%" stopColor="#fef08a" stopOpacity="0.9" />
                <stop offset="70%" stopColor="#f59e0b" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#d97706" stopOpacity="0" />
              </linearGradient>

              <linearGradient id="spiralGradCyan" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="30%" stopColor="#67e8f9" stopOpacity="0.9" />
                <stop offset="70%" stopColor="#06b6d4" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
              </linearGradient>

              <linearGradient id="spiralGradEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="30%" stopColor="#a7f3d0" stopOpacity="0.9" />
                <stop offset="70%" stopColor="#10b981" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#047857" stopOpacity="0" />
              </linearGradient>

              <filter id="spiralGlow">
                <feGaussianBlur stdDeviation="3.5" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Arm 1: Golden Spiral */}
            <path
              d={arm1}
              fill="none"
              stroke="url(#spiralGradGold)"
              strokeWidth="4"
              strokeLinecap="round"
              filter="url(#spiralGlow)"
              className="opacity-90"
            />

            {/* Arm 2: Neon Cyan Spiral */}
            <path
              d={arm2}
              fill="none"
              stroke="url(#spiralGradCyan)"
              strokeWidth="4"
              strokeLinecap="round"
              filter="url(#spiralGlow)"
              className="opacity-85"
            />

            {/* Arm 3: Emerald Green Spiral */}
            <path
              d={arm3}
              fill="none"
              stroke="url(#spiralGradEmerald)"
              strokeWidth="3.5"
              strokeLinecap="round"
              filter="url(#spiralGlow)"
              className="opacity-80"
            />

            {/* Outer Fibonacci Dust Particles */}
            {particles.map((p, idx) => {
              const px = cx + p.r * Math.cos(p.angle);
              const py = cy + p.r * Math.sin(p.angle);
              return (
                <circle
                  key={idx}
                  cx={px}
                  cy={py}
                  r={p.size}
                  fill={p.color}
                  filter="url(#spiralGlow)"
                  className="animate-pulse"
                />
              );
            })}
          </motion.svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
