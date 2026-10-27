import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { metricDescriptions, type MetricKey } from './metricDescriptions';

interface MetricHelpProps {
  metric: MetricKey;
  children: ReactNode;
  variant?: 'panel' | 'overview';
}

/** Render explanations outside scrolling panels so they remain readable at the viewport edges. */
export function MetricHelp({ metric, children, variant = 'panel' }: MetricHelpProps) {
  const description: { label: string; meaning: string; calculation?: string; note?: string } = metricDescriptions[metric];
  const id = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => { clearCloseTimer(); setOpen(true); };
  const hide = () => { clearCloseTimer(); pinned.current = false; setOpen(false); setPosition(null); };
  const scheduleClose = () => {
    clearCloseTimer();
    if (!pinned.current && !focused.current) closeTimer.current = setTimeout(hide, 120);
  };

  useEffect(() => () => clearCloseTimer(), []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!anchorRef.current || !tooltipRef.current) return;
      const anchor = anchorRef.current.getBoundingClientRect();
      const box = tooltipRef.current.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = window.innerHeight;
      const left = Math.max(12, Math.min(anchor.left, width - box.width - 12));
      const below = anchor.bottom + 8;
      const above = anchor.top - box.height - 8;
      const desiredTop = below + box.height > height - 12 && above >= 12 ? above : below;
      const top = Math.max(12, Math.min(desiredTop, height - box.height - 12));
      setPosition({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, metric]);

  useEffect(() => {
    if (!open) return;
    // Only one metric explanation should be visible, including between the overview and side panel.
    window.dispatchEvent(new Event('flowforge:metric-help-open'));
    const onOtherMetric = () => hide();
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    const onOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!anchorRef.current?.contains(event.target) && !tooltipRef.current?.contains(event.target)) hide();
    };
    window.addEventListener('flowforge:metric-help-open', onOtherMetric);
    document.addEventListener('keydown', onEscape);
    document.addEventListener('pointerdown', onOutsidePress);
    return () => {
      window.removeEventListener('flowforge:metric-help-open', onOtherMetric);
      document.removeEventListener('keydown', onEscape);
      document.removeEventListener('pointerdown', onOutsidePress);
    };
  }, [open]);

  return (
    <div
      className={variant === 'overview' ? 'overview-metric' : 'metric-row'}
      ref={anchorRef}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') show(); }}
      onPointerLeave={scheduleClose}
      onFocusCapture={() => { focused.current = true; show(); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focused.current = false;
          hide();
        }
      }}
    >
      <span className="metric-label">
        <button
          className="metric-help-trigger"
          type="button"
          aria-label={`${description.label}说明`}
          aria-describedby={open ? id : undefined}
          aria-expanded={open}
          onClick={() => {
            if (pinned.current) hide();
            else { pinned.current = true; show(); }
          }}
        >
          {description.label}<span className="metric-help-icon" aria-hidden="true">?</span>
        </button>
      </span>
      {children}
      {open && createPortal(
        <div
          id={id}
          role="tooltip"
          className="metric-tooltip"
          ref={tooltipRef}
          style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
          onPointerEnter={clearCloseTimer}
          onPointerLeave={scheduleClose}
        >
          <strong>{description.label}</strong>
          <p>{description.meaning}</p>
          {description.calculation && <p className="metric-tooltip-formula">{description.calculation}</p>}
          {description.note && <p className="metric-tooltip-note">{description.note}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
