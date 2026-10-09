'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GameImage } from '@/lib/api';
import { sameOriginPath } from '@/lib/image-url';

interface GameGalleryProps {
  title: string;
  images: GameImage[];
}

export function GameGallery({
  title,
  images,
}: GameGalleryProps): React.ReactElement | null {
  const t = useTranslations('gameDetail.gallery');
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const uid = useId();
  const headingId = `${uid}-heading`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const safe = images
    .map((image) => ({
      full: sameOriginPath(image.url),
      thumb: sameOriginPath(image.thumbUrl) ?? sameOriginPath(image.url),
    }))
    .filter(
      (image): image is { full: string; thumb: string } =>
        image.full !== null && image.thumb !== null,
    );

  // Escape closes; ArrowLeft/ArrowRight navigate. Focus handling is kept in a
  // separate effect so that navigating does not re-focus the background opener.
  useEffect(() => {
    if (openIndex === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpenIndex(null);
      else if (event.key === 'ArrowLeft') {
        if (safe.length === 0) return;
        setOpenIndex((i) =>
          i === null ? null : (i - 1 + safe.length) % safe.length,
        );
      } else if (event.key === 'ArrowRight') {
        if (safe.length === 0) return;
        setOpenIndex((i) => (i === null ? null : (i + 1) % safe.length));
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openIndex, safe.length]);

  // Focus the close button when the dialog opens (Safari does not focus a
  // button on click, so the opener is captured at click time instead). The
  // cleanup runs only when isOpen goes true -> false, i.e. on close/unmount,
  // restoring focus to the captured opener.
  const isOpen = openIndex !== null;
  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener !== null && document.contains(opener)) opener.focus();
    };
  }, [isOpen]);

  if (safe.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {t('heading')}
      </h2>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {safe.map((image, index) => (
          <li key={`${String(index)}-${image.full}`}>
            <button
              type="button"
              onClick={(event) => {
                openerRef.current = event.currentTarget;
                setOpenIndex(index);
              }}
              aria-label={t('open', { index: index + 1 })}
              className="block w-full overflow-hidden rounded-control border border-edge bg-surface transition-colors duration-[140ms] ease-[ease] hover:border-accent-soft focus-visible:outline-2 motion-reduce:transition-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- same-origin API thumbnail behind SessionGuard */}
              <img
                src={image.thumb}
                alt={t('imageAlt', { title, index: index + 1 })}
                loading="lazy"
                decoding="async"
                className="aspect-video w-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>

      {typeof document !== 'undefined' && openIndex !== null
        ? createPortal(
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('imageAlt', { title, index: openIndex + 1 })}
              tabIndex={-1}
              className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 outline-none"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpenIndex(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                const node = dialogRef.current;
                if (node === null) return;
                const focusables = Array.from(
                  node.querySelectorAll<HTMLElement>('button:not([disabled])'),
                );
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (first === undefined || last === undefined) return;
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
            >
              {/* The image is capped to leave a gutter at both edges, so the
                  edge controls land on the backdrop, never on the artwork. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- full locally cached image, same origin */}
              <img
                src={safe[openIndex]?.full}
                alt={t('imageAlt', { title, index: openIndex + 1 })}
                className="max-h-[85vh] max-w-[calc(100vw-8rem)] rounded-card border border-edge object-contain"
              />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => {
                  setOpenIndex(null);
                }}
                aria-label={t('close')}
                className={`${CONTROL} top-3 right-3`}
              >
                <CloseIcon />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenIndex((i) =>
                    i === null ? null : (i - 1 + safe.length) % safe.length,
                  );
                }}
                aria-label={t('previous')}
                className={`${CONTROL} top-1/2 left-3 -translate-y-1/2`}
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenIndex((i) =>
                    i === null ? null : (i + 1) % safe.length,
                  );
                }}
                aria-label={t('next')}
                className={`${CONTROL} top-1/2 right-3 -translate-y-1/2`}
              >
                <ChevronRightIcon />
              </button>
              <p
                aria-live="polite"
                className="absolute bottom-3 left-3 rounded-full border border-edge bg-surface/70 px-2.5 py-0.5 text-xs tabular-nums text-muted backdrop-blur-sm"
              >
                {openIndex + 1} / {safe.length}
              </p>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

// Icon-only lightbox controls: 44px round buttons, quiet at rest and clear on
// hover/focus. Translucent so they read over any artwork without covering it
// (they sit in the image's edge gutter, not on the image itself).
const CONTROL =
  'absolute grid h-11 w-11 place-items-center rounded-full border border-edge bg-surface/70 text-ink backdrop-blur-sm transition-colors duration-[140ms] ease-[ease] hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none';

function ChevronLeftIcon(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CloseIcon(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
