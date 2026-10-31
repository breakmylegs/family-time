// A bottom sheet on Radix Dialog: focus trap, Escape, tap outside, focus back to what opened it.
import * as Dialog from '@radix-ui/react-dialog';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { pinInPlace } from './motion';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: ReactNode;
  /** What opened it, to get focus back. Safari does not focus a tapped button, so it is passed in. */
  returnFocus?: HTMLElement | null;
  /** Why the last try failed. Shown inside the sheet, where VoiceOver can hear it. */
  error?: string | undefined;
  /** After Cancel, set apart: for an action like Remove that should be hard to hit by mistake. */
  footer?: ReactNode;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, sub, returnFocus, error, footer, children }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) returnTo.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }, [open, returnFocus]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        pinInPlace(content.current);
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          ref={content}
          className="sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            heading.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (returnTo.current?.isConnected) returnTo.current.focus({ preventScroll: true });
          }}
        >
          <div className="grab" aria-hidden="true" />
          <Dialog.Title className="sh-title" ref={heading} tabIndex={-1}>
            {title}
          </Dialog.Title>
          {sub ? <p className="sh-sub">{sub}</p> : null}
          {children}
          {error ? (
            <p className="sh-error" role="alert">
              {error}
            </p>
          ) : null}
          {/* A way out that needs no reach to the top of the screen, and that VoiceOver can find. */}
          <Dialog.Close className="btn btn-quiet sheet-cancel">Cancel</Dialog.Close>
          {footer}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
