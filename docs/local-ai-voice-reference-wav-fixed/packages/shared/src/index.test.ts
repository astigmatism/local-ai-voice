import { describe, expect, it } from 'vitest';
import { loadStateOrder } from './index.js';

describe('shared types', () => {
  it('keeps the expected worker state machine order', () => {
    expect(loadStateOrder).toEqual(['unloaded', 'loading', 'loaded', 'unloading', 'failed']);
  });
});
