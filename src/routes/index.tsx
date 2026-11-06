import { createFileRoute } from "@tanstack/react-router";
import { MoonRunner } from "@/components/moon-runner";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <MoonRunner />;
}
