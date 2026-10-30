import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleTelegramWebhook } = await import("@/lib/telegram.server");
        return handleTelegramWebhook(request);
      },
    },
  },
});
