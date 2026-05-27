import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('App', () => {
  it('renders the appliance title', () => {
    const html = renderToString(<App />);
    expect(html).toContain('GPU-first STT/TTS manager');
  });
});
