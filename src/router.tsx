import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { previewPathRewrite } from "@/lib/preview-path-prefix";
import { routeTree } from "./routeTree.gen";

function DefaultNotFound() {
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

export function getRouter() {
  return createRouter({
    routeTree,
    rewrite: previewPathRewrite(),
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: DefaultNotFound,
  });
}
