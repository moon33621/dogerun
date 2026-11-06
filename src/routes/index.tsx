import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MoonRunner } from "@/components/moon-runner";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [playing, setPlaying] = useState(false);
  if (playing) return <MoonRunner />;
  return (
    <main className="flex h-dvh flex-col bg-[#070b18] text-white">
      <img src="/og.jpg?v=37" alt="Doge Run cartoon share image" className="min-h-0 w-full flex-1 object-contain" />
      <button
        type="button"
        className="m-4 rounded-full bg-[#f5c451] px-5 py-3 text-sm font-bold text-[#070b18]"
        onClick={() => setPlaying(true)}
      >
        Play the game
      </button>
    </main>
  );
}
