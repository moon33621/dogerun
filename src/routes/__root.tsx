import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Doge Run";

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg text-fg">
      <div className="text-center">
        <p className="font-display text-4xl font-extrabold text-gold">404</p>
        <p className="mt-2 text-muted">Page not found</p>
        <a href="/" className="mt-4 inline-block rounded-full bg-gold px-4 py-2 text-sm font-bold text-bg">
          Back to the run
        </a>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: "A golden doge in a space suit runs a coin road to the moon." },
      { name: "theme-color", content: "#070b18" },
      { property: "og:title", content: APP_NAME },
      { property: "og:description", content: "A golden doge in a space suit runs a coin road to the moon." },
      { property: "og:type", content: "x:game" },
      { property: "og:url", content: "https://dogerunlotis.xyz/" },
      { property: "og:image", content: "https://dogerunlotis.xyz/og.jpg?v=4" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: APP_NAME },
      { name: "twitter:description", content: "A golden doge in a space suit runs a coin road to the moon." },
      { name: "twitter:image", content: "https://dogerunlotis.xyz/og.jpg?v=4" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Syne:wght@700;800&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  notFoundComponent: NotFound,
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
