import { useEffect, useRef } from 'react';

export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      r: Math.random() * 7 + 4,
      d: Math.random() * 3 + 1,
      color: ['#c9a227', '#d1483f', '#2f9159', '#3a72b8', '#dfa62b'][Math.floor(Math.random() * 5)],
      tilt: Math.random() * 10 - 5,
      tiltSpeed: Math.random() * 0.1 + 0.05,
      angle: 0,
    }));

    let frame: number;
    function draw() {
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      pieces.forEach((p) => {
        p.angle += p.tiltSpeed;
        p.tilt = Math.sin(p.angle) * 12;
        p.y += p.d;
        if (p.y > canvas!.height) { p.y = -10; p.x = Math.random() * canvas!.width; }
        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
        ctx.stroke();
      });
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-40"
    />
  );
}