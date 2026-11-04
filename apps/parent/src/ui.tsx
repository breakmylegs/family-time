import type { ReactNode } from 'react';

/** The teal band at the top of every screen, as in the mock. Pads itself clear of the notch. */
export function Shell({ title, line, children }: { title: string; line?: ReactNode; children?: ReactNode }) {
  return (
    <header className="bg-shell text-shell-ink" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}>
      <div className="px-5 pb-5">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        {line ? <p className="mt-1.5 text-[17px] leading-snug text-shell-ink-2 text-pretty">{line}</p> : null}
        {children}
      </div>
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-ground" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
      {children}
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-4">
      <h2 className="mx-1 mb-2 mt-7 text-[21px] font-bold tracking-[-0.015em]">{title}</h2>
      {children}
    </section>
  );
}

export function Group({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[18px] bg-surface">{children}</div>;
}

/** An error or notice in words. role=alert so a screen reader hears it when it appears. */
export function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  if (!children) return null;
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`mx-1 mt-3 text-[15px] leading-snug ${tone === 'error' ? 'text-paused' : 'text-ink-2'}`}>
      {children}
    </p>
  );
}

export const roleName: Record<string, string> = { owner: 'Owner', parent: 'Parent', carer: 'Carer', child: 'Child' };
