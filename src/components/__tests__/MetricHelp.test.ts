// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricHelp } from '../MetricHelp';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function pointer(target: Element, type: string, pointerType = 'mouse', relatedTarget: EventTarget | null = null) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  act(() => target.dispatchEvent(event));
}
function trigger(index = 0) { return host.querySelectorAll<HTMLButtonElement>('button')[index]; }
function tooltip() { return document.querySelector<HTMLElement>('[role="tooltip"]'); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement('section', null,
    createElement(MetricHelp, { metric: 'waitAverage', children: createElement('span', { 'data-value': '' }, '12.5 s') }),
    createElement(MetricHelp, { metric: 'systemCompletionRate', children: createElement('span', null, '80%') }),
  )));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('metric explanations', () => {
  it('opens from the numeric value and keeps the portal readable while the pointer enters it; Escape dismisses it', () => {
    pointer(host.querySelector('[data-value]')!, 'pointerover');
    const explanation = tooltip()!;
    expect(explanation).not.toBeNull();
    expect(explanation.parentElement).toBe(document.body);
    expect(trigger().getAttribute('aria-describedby')).toBe(explanation.id);
    expect(explanation.style.visibility).toBe('visible');

    pointer(host.querySelector('.metric-row')!, 'pointerout', 'mouse', explanation);
    pointer(explanation, 'pointerover');
    act(() => vi.advanceTimersByTime(150));
    expect(tooltip()).toBe(explanation);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(tooltip()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().hasAttribute('aria-describedby')).toBe(false);
  });

  it('supports keyboard focus and only associates the currently focused metric with an explanation', () => {
    act(() => trigger().focus());
    const firstId = tooltip()!.id;
    expect(trigger().getAttribute('aria-describedby')).toBe(firstId);

    act(() => trigger(1).focus());
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    expect(tooltip()!.id).not.toBe(firstId);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger(1).getAttribute('aria-describedby')).toBe(tooltip()!.id);

    act(() => trigger(1).blur());
    expect(tooltip()).toBeNull();
  });

  it('pins on click across pointer leave, then closes on a second click or an outside press', () => {
    act(() => trigger().click());
    pointer(host.querySelector('.metric-row')!, 'pointerout');
    act(() => vi.advanceTimersByTime(500));
    expect(tooltip()).not.toBeNull();

    act(() => trigger().click());
    expect(tooltip()).toBeNull();
    act(() => trigger().click());
    pointer(document.body, 'pointerdown');
    expect(tooltip()).toBeNull();
  });

  it('does not open a hover explanation for touch, but tapping the label opens it and another metric replaces it', () => {
    pointer(trigger(), 'pointerover', 'touch');
    expect(tooltip()).toBeNull();
    act(() => trigger().click());
    const firstId = tooltip()!.id;

    act(() => trigger(1).click());
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    expect(tooltip()!.id).not.toBe(firstId);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger(1).getAttribute('aria-expanded')).toBe('true');
  });
});
