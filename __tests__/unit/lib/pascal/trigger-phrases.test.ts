/**
 * Trigger phrases — the scanner's contract: case-insensitive substrings, one
 * hit per tool, order of appearance, a per-message cap that reports what it
 * dropped, and Carina query lines subtracted.
 */

import {
  scanTriggerPhrases,
  triggersContainedIn,
  MAX_TRIGGER_RUNS_PER_MESSAGE,
} from '@/lib/pascal/trigger-phrases';

const tool = (name: string, triggers?: string[]) => ({ name, triggers });

describe('scanTriggerPhrases', () => {
  it('folds case on both sides', () => {
    const { hits } = scanTriggerPhrases('She cried ABRACADABRA!', [tool('spell', ['AbraCadabra'])]);
    expect(hits).toEqual([{ tool: 'spell', phrase: 'AbraCadabra', index: 10 }]);
  });

  it('matches substrings, not words', () => {
    const { hits } = scanTriggerPhrases('warm by the fireplace', [tool('blaze', ['fire'])]);
    expect(hits.map((h) => h.tool)).toEqual(['blaze']);
  });

  it('fires a tool once however many of its phrases appear, with the earliest phrase', () => {
    const { hits } = scanTriggerPhrases('open sesame, then abracadabra', [
      tool('door', ['abracadabra', 'open sesame']),
    ]);
    expect(hits).toEqual([{ tool: 'door', phrase: 'open sesame', index: 0 }]);
  });

  it('orders hits by where they appear, not by roster order', () => {
    const { hits } = scanTriggerPhrases('I draw my sword and consult the oracle', [
      tool('oracle', ['consult the oracle']),
      tool('initiative', ['draw my sword']),
    ]);
    expect(hits.map((h) => h.tool)).toEqual(['initiative', 'oracle']);
  });

  it('fires both tools when one phrase is a substring of the other', () => {
    const { hits } = scanTriggerPhrases('the firestorm', [tool('a', ['fire']), tool('b', ['firestorm'])]);
    expect(hits.map((h) => h.tool).sort()).toEqual(['a', 'b']);
  });

  it('caps fired tools per message and returns the rest as dropped', () => {
    const tools = Array.from({ length: MAX_TRIGGER_RUNS_PER_MESSAGE + 1 }, (_, i) => tool(`t${i}`, [`word${i}`]));
    const text = tools.map((_, i) => `word${i}`).join(' ');
    const { hits, dropped } = scanTriggerPhrases(text, tools);
    expect(hits).toHaveLength(MAX_TRIGGER_RUNS_PER_MESSAGE);
    expect(dropped.map((h) => h.tool)).toEqual([`t${MAX_TRIGGER_RUNS_PER_MESSAGE}`]);
  });

  it('never scans a Carina query line, public or whisper', () => {
    const tools = [tool('spell', ['abracadabra'])];
    expect(scanTriggerPhrases('@Alice: abracadabra', tools).hits).toEqual([]);
    expect(scanTriggerPhrases('@Alice? “abracadabra”', tools).hits).toEqual([]);
  });

  it('still scans the spoken lines around a Carina query', () => {
    const tools = [tool('spell', ['abracadabra'])];
    const { hits } = scanTriggerPhrases('Hold on.\n@Alice: what is a spell?\nAbracadabra!', tools);
    expect(hits.map((h) => h.tool)).toEqual(['spell']);
  });

  it('returns nothing for empty content or tools without triggers', () => {
    expect(scanTriggerPhrases('', [tool('spell', ['abracadabra'])])).toEqual({ hits: [], dropped: [] });
    expect(scanTriggerPhrases('abracadabra', [tool('plain')])).toEqual({ hits: [], dropped: [] });
  });
});

describe('triggersContainedIn', () => {
  it('names the phrases a text would echo, as written', () => {
    expect(triggersContainedIn('The word ABRACADABRA rings out.', ['Abracadabra', 'open sesame'])).toEqual([
      'Abracadabra',
    ]);
    expect(triggersContainedIn('nothing here', ['abracadabra'])).toEqual([]);
    expect(triggersContainedIn('abracadabra', undefined)).toEqual([]);
  });
});
