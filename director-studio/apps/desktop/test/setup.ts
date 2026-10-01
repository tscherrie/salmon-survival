import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setLanguage } from '../src/renderer/i18n.ts';

/**
 * Test-Setup (jsdom): jest-dom-Matcher, Polyfills (ResizeObserver, matchMedia, MediaRecorder,
 * getUserMedia, requestAnimationFrame) und Mocks für Remotion-Player und Render-Paket.
 */

// Remotion-Player: in jsdom nicht lauffähig → schlanker Ersatz mit PlayerRef-Methoden
vi.mock('@remotion/player', async () => {
  const React = await import('react');
  const Player = React.forwardRef(function PlayerMock(_props: Record<string, unknown>, ref: React.Ref<unknown>) {
    React.useImperativeHandle(ref, () => ({
      seekTo: () => undefined,
      play: () => undefined,
      pause: () => undefined,
      toggle: () => undefined,
      isPlaying: () => false,
      getCurrentFrame: () => 0,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    return React.createElement('div', { 'data-testid': 'remotion-player' });
  });
  return { Player };
});

// Render-Paket: wird parallel entwickelt; UI-Tests nutzen die eigenen React-Renderer
vi.mock('@studio/render/browser', () => ({
  TimelineComposition: () => null,
  deckToHtml: undefined,
  canvasToSvg: undefined,
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, writable: true, configurable: true });
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

/** MediaRecorder-Attrappe: liefert beim Stoppen einen kleinen Blob. */
export class MediaRecorderStub extends EventTarget {
  static instances: MediaRecorderStub[] = [];
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';
  constructor(public stream: unknown) {
    super();
    MediaRecorderStub.instances.push(this);
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const data = new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType });
    const dataEvent = new Event('dataavailable') as Event & { data: Blob };
    Object.defineProperty(dataEvent, 'data', { value: data });
    this.dispatchEvent(dataEvent);
    this.dispatchEvent(new Event('stop'));
  }
  static isTypeSupported(): boolean {
    return true;
  }
}

Object.defineProperty(globalThis, 'MediaRecorder', { value: MediaRecorderStub, writable: true, configurable: true });

export const fakeStream = { getTracks: () => [{ stop: () => undefined }] };

if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream) },
  });
}

afterEach(() => {
  cleanup();
  setLanguage('de');
  MediaRecorderStub.instances = [];
  try {
    localStorage.clear();
  } catch {
    // ignorieren
  }
});
