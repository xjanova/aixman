// Animated fiber threads canvas — "castle of thoughts and dreams"
// Bezier curves flowing between invisible attractors, reacting to cursor.

const FiberThreads = ({ density = 70, speed = 1, hueShift = 0, interactive = true, opacity = 0.55 }) => {
  const canvasRef = React.useRef(null);
  const mouseRef = React.useRef({ x: -9999, y: -9999, active: false });
  const threadsRef = React.useRef([]);

  // Palette anchors — green / blue / purple
  const palettes = React.useMemo(() => {
    const base = [
      [160, 85, 55], // teal-green
      [180, 80, 60], // cyan
      [210, 90, 65], // azure blue
      [250, 75, 68], // indigo
      [275, 70, 65], // violet
      [295, 65, 68], // magenta-purple
    ];
    return base.map(([h, s, l]) => [(h + hueShift) % 360, s, l]);
  }, [hueShift]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    let raf;
    let visible = true;
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawn();
    };

    const spawn = () => {
      const threads = [];
      const n = Math.floor(density);
      for (let i = 0; i < n; i++) {
        const pIdx = Math.floor(Math.random() * palettes.length);
        const [hh, ss, ll] = palettes[pIdx];
        threads.push({
          // origin along left/top edge mostly
          x0: Math.random() * w,
          y0: Math.random() * h,
          // four control points for a flowing bezier
          cx1: Math.random() * w,
          cy1: Math.random() * h,
          cx2: Math.random() * w,
          cy2: Math.random() * h,
          // end
          x1: Math.random() * w,
          y1: Math.random() * h,
          // motion frequencies
          f1: 0.0004 + Math.random() * 0.0008,
          f2: 0.0003 + Math.random() * 0.0007,
          f3: 0.0002 + Math.random() * 0.0006,
          phase: Math.random() * Math.PI * 2,
          thick: 0.3 + Math.random() * 1.4,
          hue: hh,
          sat: ss,
          lit: ll,
          alpha: 0.25 + Math.random() * 0.55,
          drift: Math.random() * 1000,
        });
      }
      threadsRef.current = threads;
    };

    const onMouse = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
      mouseRef.current.active = true;
    };
    const onLeave = () => { mouseRef.current.active = false; };

    resize();
    window.addEventListener('resize', resize);
    if (interactive) {
      window.addEventListener('mousemove', onMouse, { passive: true });
      window.addEventListener('mouseleave', onLeave);
    }

    // IntersectionObserver — pause when off-screen
    const io = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
    }, { threshold: 0 });
    io.observe(canvas);

    let t0 = performance.now();
    let lastFrame = 0;
    const frameMs = 1000 / 30; // cap at 30fps for ambient animation
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      if (now - lastFrame < frameMs) return;
      lastFrame = now;
      const t = (now - t0) * speed;
      // motion-blur: translucent black overlay
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(3, 6, 18, 0.08)';
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const mActive = mouseRef.current.active;

      for (const th of threadsRef.current) {
        // animated control points — large lazy drifts
        const a = Math.sin(t * th.f1 + th.phase);
        const b = Math.cos(t * th.f2 + th.phase * 1.3);
        const c = Math.sin(t * th.f3 + th.phase * 0.7);
        const d = Math.cos(t * th.f1 + th.phase * 2.1);

        let x0 = th.x0 + a * 120;
        let y0 = th.y0 + b * 120;
        let cx1 = th.cx1 + c * 200;
        let cy1 = th.cy1 + d * 200;
        let cx2 = th.cx2 + b * 200;
        let cy2 = th.cy2 + a * 200;
        let x1 = th.x1 + d * 120;
        let y1 = th.y1 + c * 120;

        // cursor attraction — warp midpoints toward mouse
        if (mActive && interactive) {
          const dx = mx - (cx1 + cx2) / 2;
          const dy = my - (cy1 + cy2) / 2;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          const pull = Math.max(0, 180 - dist) / 180; // 0..1
          cx1 += dx * pull * 0.35;
          cy1 += dy * pull * 0.35;
          cx2 += dx * pull * 0.25;
          cy2 += dy * pull * 0.25;
        }

        // gradient stroke
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        const h1 = th.hue;
        const h2 = (th.hue + 40) % 360;
        g.addColorStop(0, `hsla(${h1}, ${th.sat}%, ${th.lit}%, 0)`);
        g.addColorStop(0.15, `hsla(${h1}, ${th.sat}%, ${th.lit}%, ${th.alpha * opacity})`);
        g.addColorStop(0.5, `hsla(${(h1 + 20) % 360}, ${th.sat}%, ${th.lit + 5}%, ${th.alpha * opacity * 1.1})`);
        g.addColorStop(0.85, `hsla(${h2}, ${th.sat}%, ${th.lit}%, ${th.alpha * opacity})`);
        g.addColorStop(1, `hsla(${h2}, ${th.sat}%, ${th.lit}%, 0)`);

        ctx.strokeStyle = g;
        ctx.lineWidth = th.thick;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        ctx.stroke();

      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, [density, speed, palettes, interactive, opacity]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
};

// Static SVG fiber pattern for compact areas (cards, avatars)
const FiberGlyph = ({ seed = 0, size = 80, hue = 200 }) => {
  const paths = React.useMemo(() => {
    const rand = (min, max) => min + ((Math.sin(seed * 9.3 + min * 0.7) + 1) / 2) * (max - min);
    const arr = [];
    for (let i = 0; i < 6; i++) {
      const x0 = rand(2, size - 2);
      const y0 = rand(2, size - 2);
      const x1 = rand(2, size - 2);
      const y1 = rand(2, size - 2);
      const cx = rand(0, size);
      const cy = rand(0, size);
      arr.push({ d: `M${x0} ${y0} Q${cx} ${cy} ${x1} ${y1}`, h: hue + i * 15 });
    }
    return arr;
  }, [seed, size, hue]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={`hsla(${p.h}, 80%, 65%, 0.7)`} strokeWidth="0.8" fill="none" />
      ))}
    </svg>
  );
};

Object.assign(window, { FiberThreads, FiberGlyph });
