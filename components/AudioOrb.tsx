import React, { useEffect, useRef } from 'react';
import { ConnectionState } from '../types';

interface AudioOrbProps {
  state: ConnectionState;
  analyser: AnalyserNode | null;
}

const AudioOrb: React.FC<AudioOrbProps> = ({ state, analyser }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !analyser || state !== 'connected') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = 60; // Base radius

      // Calculate average frequency for pulsing effect
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const pulse = average * 0.5;

      // Draw Glow
      const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius + pulse + 40);
      gradient.addColorStop(0, 'rgba(124, 58, 237, 0.8)'); // Purple
      gradient.addColorStop(0.5, 'rgba(34, 211, 238, 0.4)'); // Cyan
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + pulse + 20, 0, 2 * Math.PI);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw Inner Circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius + (pulse * 0.2), 0, 2 * Math.PI);
      ctx.fillStyle = '#1e1b4b';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#22d3ee';
      ctx.stroke();
      ctx.fill();
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      if(ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [analyser, state]);

  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {state === 'disconnected' && (
        <div className="w-32 h-32 rounded-full border-4 border-gray-700 bg-gray-900 flex items-center justify-center shadow-lg">
          <span className="text-gray-500 font-display font-bold text-xl">OFFLINE</span>
        </div>
      )}
      {state === 'connecting' && (
        <div className="w-32 h-32 rounded-full border-4 border-wick-purple border-t-transparent animate-spin bg-gray-900 shadow-[0_0_20px_rgba(124,58,237,0.5)]">
        </div>
      )}
      {state === 'connected' && (
         <canvas ref={canvasRef} width={300} height={300} className="w-full h-full" />
      )}
    </div>
  );
};

export default AudioOrb;
