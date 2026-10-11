'use client';

import { useId, useRef, useState } from 'react';
import { nextTabIndex } from '@/lib/tabs';

export interface TabItem {
  /** Stable key, also used in the DOM ids. */
  id: string;
  /** Already translated. */
  label: string;
  /** Server-rendered content, passed in as a ReactNode. */
  panel: React.ReactNode;
}

interface TabsProps {
  /** Already translated accessible name for the tablist. */
  label: string;
  /** At least one item. */
  items: TabItem[];
  /** Defaults to 0. */
  defaultIndex?: number;
}

/**
 * WAI-ARIA tabs: a roving-tabindex tablist that swaps server-rendered panels.
 * Moving focus selects the tab (automatic activation). Inactive panels stay in
 * the DOM (so every `aria-controls` resolves) but render no children and are
 * `hidden` — unmounting them stops a playing YouTube `<iframe>` and keeps the
 * video facade from fetching `i.ytimg.com` thumbnails while About is selected.
 * A single item renders its panel directly, with no tablist at all.
 */
export function Tabs({
  label,
  items,
  defaultIndex = 0,
}: TabsProps): React.ReactElement | null {
  const count = items.length;
  const clamp = (index: number): number =>
    Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  const [selected, setSelected] = useState(() => clamp(defaultIndex));
  const uid = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const first = items[0];
  if (count <= 1) return first === undefined ? null : <>{first.panel}</>;

  const active = clamp(selected);

  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        className="flex gap-6 border-b border-edge"
      >
        {items.map((item, index) => {
          const isSelected = index === active;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${uid}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                setSelected(index);
              }}
              onKeyDown={(event) => {
                // Leave modified key presses to the browser: Alt+Arrow is
                // back/forward, and Cmd/Ctrl/Shift+Home/End are text-editing
                // and page-navigation shortcuts.
                if (
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey
                ) {
                  return;
                }
                const next = nextTabIndex(active, event.key, count);
                if (next === null) return;
                event.preventDefault();
                setSelected(next);
                tabRefs.current[next]?.focus();
              }}
              className={`-mb-px border-b-2 px-0.5 pt-1 pb-2.5 text-sm font-medium transition-colors duration-[140ms] ease-[ease] motion-reduce:transition-none ${
                isSelected
                  ? 'border-accent text-ink'
                  : 'border-transparent text-muted hover:border-edge-strong hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item, index) => {
        const isSelected = index === active;
        return (
          <div
            key={item.id}
            role="tabpanel"
            id={`${uid}-panel-${item.id}`}
            aria-labelledby={`${uid}-tab-${item.id}`}
            tabIndex={0}
            hidden={!isSelected}
            className="rounded-control pt-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            {isSelected ? item.panel : null}
          </div>
        );
      })}
    </div>
  );
}
