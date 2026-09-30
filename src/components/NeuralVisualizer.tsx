import React, { useEffect, useRef } from 'react';

interface NeuralVisualizerProps {
  isThinking: boolean;
  currentCategoryIndex: number;
  questionNumber: number;
  totalQuestions: number;
  customBgUrl?: string;
}

export const NeuralVisualizer: React.FC<NeuralVisualizerProps> = ({
  isThinking,
  customBgUrl,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameId = useRef<number | null>(null);

  // Main Ambient Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;

    const handleResize = () => {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const render = () => {
      time += 0.015;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // 1. Deep Space Cybernetic Grid on the floor/perspective
      ctx.save();
      const gridY = h * 0.70;
      const gridHeight = h * 0.30;
      const grad = ctx.createLinearGradient(0, gridY, 0, h);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0)');
      grad.addColorStop(1, 'rgba(15, 23, 42, 0.45)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, gridY, w, gridHeight);

      // Subtle perspective grid lines
      ctx.strokeStyle = isThinking ? 'rgba(56, 189, 248, 0.12)' : 'rgba(56, 189, 248, 0.05)';
      ctx.lineWidth = 1;
      const vpX = w * 0.5;
      const vpY = gridY - 120;

      for (let x = 0; x <= w; x += 80) {
        ctx.beginPath();
        ctx.moveTo(vpX, vpY);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      for (let y = gridY; y < h; y += 26) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();

      // 2. Gentle ambient horizontal frequency waveforms
      ctx.save();
      const waveY = h * 0.48;
      const waveSpeed = isThinking ? 2.8 : 1.2;
      const waveAmp = isThinking ? 18 : 10;

      [
        { color: 'rgba(6, 182, 212, 0.2)', offset: 0, freq: 0.005, lineW: 1.5 },
        { color: 'rgba(168, 85, 247, 0.15)', offset: 1.5, freq: 0.008, lineW: 1 },
      ].forEach((wave) => {
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = wave.lineW;
        ctx.beginPath();
        for (let x = 0; x < w; x += 10) {
          const envelope = Math.sin((x / w) * Math.PI);
          const y = waveY + Math.sin(x * wave.freq + time * waveSpeed + wave.offset) * waveAmp * envelope;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.restore();

      animFrameId.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [isThinking]);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none">
      {/* Background Layer: Custom Image or Dynamic Cyber-Atmosphere */}
      {customBgUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-1000 opacity-50 filter saturate-125"
          style={{ backgroundImage: `url(${customBgUrl})` }}
        />
      ) : (
        <div className="absolute inset-0 bg-radial-[at_75%_40%] from-[#131138]/40 via-[#060b1b]/80 to-[#02050e] transition-colors duration-1000" />
      )}

      {/* Cybernetic Ambient Light Flares */}
      <div className="absolute top-[15%] right-[10%] w-[450px] h-[450px] rounded-full bg-cyan-500/8 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[20%] right-[15%] w-[400px] h-[400px] rounded-full bg-rose-500/8 blur-3xl pointer-events-none" />
      <div className="absolute top-[35%] left-[5%] w-[500px] h-[500px] rounded-full bg-indigo-600/5 blur-3xl pointer-events-none" />

      {/* Real-time HTML5 Ambient Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
};
