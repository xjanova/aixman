"use client";

export function AmbientBackground() {
  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {/* Deep navy base */}
      <div className="absolute inset-0 bg-[#060A14]" />

      {/* Large blue orb — top left */}
      <div
        className="absolute -top-[20%] -left-[10%] w-[600px] h-[600px] rounded-full animate-drift animate-breathe"
        style={{
          background:
            "radial-gradient(circle, rgba(59,130,246,0.35) 0%, rgba(59,130,246,0) 70%)",
        }}
      />

      {/* Purple orb — center right */}
      <div
        className="absolute top-[20%] -right-[5%] w-[500px] h-[500px] rounded-full animate-drift-reverse animate-breathe"
        style={{
          background:
            "radial-gradient(circle, rgba(139,92,246,0.3) 0%, rgba(139,92,246,0) 70%)",
          animationDelay: "3s",
        }}
      />

      {/* Cyan orb — bottom center */}
      <div
        className="absolute -bottom-[10%] left-[30%] w-[450px] h-[450px] rounded-full animate-drift-slow animate-breathe-soft"
        style={{
          background:
            "radial-gradient(circle, rgba(6,182,212,0.25) 0%, rgba(6,182,212,0) 70%)",
          animationDelay: "6s",
        }}
      />

      {/* Small blue accent — mid left */}
      <div
        className="absolute top-[55%] left-[10%] w-[300px] h-[300px] rounded-full animate-drift-reverse animate-breathe-soft"
        style={{
          background:
            "radial-gradient(circle, rgba(59,130,246,0.2) 0%, rgba(59,130,246,0) 70%)",
          animationDelay: "10s",
        }}
      />

      {/* Small purple accent — top right */}
      <div
        className="absolute top-[5%] right-[20%] w-[250px] h-[250px] rounded-full animate-drift animate-breathe"
        style={{
          background:
            "radial-gradient(circle, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0) 70%)",
          animationDelay: "14s",
        }}
      />

      {/* Very subtle noise/grain overlay for depth */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />
    </div>
  );
}
