import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-full bg-gold text-bg ${className}`}>
      <svg viewBox="0 0 24 24" width="20" height="20" className="size-5" aria-hidden="true">
        <path fill="currentColor" d="M16.5 3.2a8.8 8.8 0 1 0 4.2 12.6 7 7 0 1 1-4.2-12.6Z" />
      </svg>
    </span>
  );
}

export function SocialLinks() {
  return (
    <div className="flex items-center gap-1">
      <a
        className="group inline-flex size-11 items-center justify-center rounded-full text-muted transition duration-200 hover:bg-surface hover:text-gold"
        href="https://x.com/DogeRunToken"
        target="_blank"
        rel="noreferrer"
        aria-label="Doge Run on X"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" className="size-5 transition duration-200 group-hover:scale-110" aria-hidden="true">
          <path
            fill="currentColor"
            d="M14.7 3h3.1l-6.8 7.8L19 21h-5.2l-4.1-5.4L5.2 21H2.1l7.3-8.3L2 3h5.3l3.7 4.9L14.7 3Zm-1.1 16.2h1.7L7.5 4.7H5.7l7.9 14.5Z"
          />
        </svg>
      </a>
      <a
        className="group inline-flex size-11 items-center justify-center rounded-full text-muted transition duration-200 hover:bg-surface hover:text-gold"
        href="https://t.me/+XE2O45G2j6hmZTQx"
        target="_blank"
        rel="noreferrer"
        aria-label="Tg community"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" className="size-5 transition duration-200 group-hover:scale-110" aria-hidden="true">
          <path
            fill="currentColor"
            d="M20.7 4.3 3.4 11c-1.2.5-1.2 1.1-.2 1.4l4.4 1.4 1.7 5.3c.2.6.1.8.7.8.4 0 .6-.2.8-.4l2.5-2.4 4.8 3.6c.9.5 1.5.2 1.7-.8l2.6-12.4c.3-1.2-.5-1.8-1.7-1.2ZM8.8 13.6l8.7-5.5c.4-.3.8-.1.5.2l-7.5 6.8-.3 3.2-1.4-4.7Z"
          />
        </svg>
      </a>
    </div>
  );
}

export function SiteFrame({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <main className="theme-sky flex min-h-dvh flex-col text-fg">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="group flex min-w-0 items-center gap-3">
          <BrandMark className="transition duration-200 group-hover:scale-105" />
          <span className="truncate font-display text-lg font-extrabold tracking-tight text-gold sm:text-xl">To The Moon</span>
        </Link>
        <Link to="/" className="theme-btn-ghost inline-flex items-center px-4 text-sm">
          Play
        </Link>
      </header>
      <div className="grid flex-1 place-items-center px-4 py-6">
        <section className="theme-card w-full max-w-md">
          <p className="text-xs font-semibold tracking-widest text-gold uppercase">{kicker}</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold text-fg">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{lede}</p>
          <div className="mt-5">{children}</div>
        </section>
      </div>
      <footer className="mt-auto flex items-center justify-between border-t border-line px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <p className="text-xs text-muted">$DRUN · BNB Chain</p>
        <SocialLinks />
      </footer>
    </main>
  );
}
