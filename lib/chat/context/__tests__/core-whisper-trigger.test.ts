import { shouldFireCoreWhisper } from '../core-whisper-trigger';
import type { ChatEvent, MessageEvent } from '@/lib/schemas/chat.types';

const ME = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-000000000003';

function userMsg(content = 'hi'): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'USER',
    content,
    attachments: [],
    createdAt: new Date().toISOString(),
  } as MessageEvent;
}

function mineMsg(content = 'reply'): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content,
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: ME,
  } as MessageEvent;
}

function otherMsg(content = 'reply'): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content,
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: OTHER,
  } as MessageEvent;
}

function emptyToolCallMsg(): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: '   ',
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: ME,
  } as MessageEvent;
}

function silentMsg(): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: 'silent',
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: ME,
    isSilentMessage: true,
  } as MessageEvent;
}

function privateWhisperTo(target: string, sender: 'commonplaceBook' | 'lantern' = 'commonplaceBook'): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: 'whisper',
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: null,
    systemSender: sender,
    systemKind: 'consolidated',
    targetParticipantIds: [target],
  } as MessageEvent;
}

function priorCoreWhisperFor(target: string): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: 'core',
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: null,
    systemSender: 'aurora',
    systemKind: 'core-whisper',
    targetParticipantIds: [target],
  } as MessageEvent;
}

function systemEvent(): ChatEvent {
  return {
    type: 'system',
    id: crypto.randomUUID(),
    systemEventType: 'SUMMARIZATION',
    description: 'rolling summary',
    createdAt: new Date().toISOString(),
  } as ChatEvent;
}

function librarianFold(target?: string): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: 'summary',
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: null,
    systemSender: 'librarian',
    systemKind: 'rolling-summary',
    targetParticipantIds: target ? [target] : null,
  } as MessageEvent;
}

function librarianAnnouncement(systemKind: string, target?: string): MessageEvent {
  return {
    type: 'message',
    id: crypto.randomUUID(),
    role: 'ASSISTANT',
    content: 'announcement',
    attachments: [],
    createdAt: new Date().toISOString(),
    participantId: null,
    systemSender: 'librarian',
    systemKind,
    targetParticipantIds: target ? [target] : null,
  } as MessageEvent;
}

const baseOptions = {
  respondingParticipantId: ME,
  isContinue: false,
  isNudge: false,
  interval: 12,
  silenceThreshold: 3,
  fireOnContextTransition: true,
};

describe('shouldFireCoreWhisper', () => {
  it('fires "first" on an empty history', () => {
    const r = shouldFireCoreWhisper({ ...baseOptions, events: [] });
    expect(r).toEqual({ fire: true, reason: 'first' });
  });

  it('fires "first" when only user messages and other participants have spoken', () => {
    const events: ChatEvent[] = [userMsg(), otherMsg(), userMsg()];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    // Three turns by others triggers silence too, but first wins.
    expect(r.fire).toBe(true);
    expect(r.reason).toBe('first');
  });

  it('does not fire on continue', () => {
    const events: ChatEvent[] = [userMsg(), mineMsg()];
    const r = shouldFireCoreWhisper({ ...baseOptions, events, isContinue: true });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('does not fire on nudge', () => {
    const events: ChatEvent[] = [userMsg(), mineMsg()];
    const r = shouldFireCoreWhisper({ ...baseOptions, events, isNudge: true });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('fires "first" (bootstrap) when the character has spoken but has never been offered a Core whisper', () => {
    // Chats that predate the feature — the character may have many turns
    // already, but they have never been offered their Core packet. The
    // bootstrap case fires on their next turn regardless of cadence.
    const events: ChatEvent[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(userMsg());
      events.push(mineMsg(`turn ${i}`));
    }
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: true, reason: 'first' });
  });

  it('fires "periodic" after interval own-turns since the LAST Core whisper for this character', () => {
    const events: ChatEvent[] = [
      userMsg(),
      mineMsg(),
      priorCoreWhisperFor(ME),
    ];
    for (let i = 0; i < 12; i++) {
      events.push(userMsg());
      events.push(mineMsg(`post-whisper ${i}`));
    }
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: true, reason: 'periodic' });
  });

  it('does not fire periodic at interval - 1 own-turns since the last whisper', () => {
    const events: ChatEvent[] = [
      userMsg(),
      mineMsg(),
      priorCoreWhisperFor(ME),
    ];
    for (let i = 0; i < 11; i++) {
      events.push(userMsg());
      events.push(mineMsg(`post-whisper ${i}`));
    }
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r.reason).not.toBe('periodic');
  });

  it('resets periodic counter after a Core whisper to this character', () => {
    const events: ChatEvent[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(userMsg());
      events.push(mineMsg());
    }
    events.push(priorCoreWhisperFor(ME));
    // Only a few own-turns after the whisper
    for (let i = 0; i < 3; i++) {
      events.push(userMsg());
      events.push(mineMsg());
    }
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('fires "silence" when silenceThreshold visible turns by others precede the new turn', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      otherMsg(),
      otherMsg(),
      userMsg(),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: true, reason: 'silence' });
  });

  it('does not count private whispers to OTHER toward silence', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      privateWhisperTo(OTHER),
      privateWhisperTo(OTHER),
      privateWhisperTo(OTHER),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('does not count Staff whispers toward silence even if untargeted', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      { ...privateWhisperTo(OTHER, 'lantern'), targetParticipantIds: null } as MessageEvent,
      { ...privateWhisperTo(OTHER, 'lantern'), targetParticipantIds: null } as MessageEvent,
      { ...privateWhisperTo(OTHER, 'lantern'), targetParticipantIds: null } as MessageEvent,
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('does not count empty / tool-only assistant turns toward cadence', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      emptyToolCallMsg(),
      userMsg(),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    // Only 1 own turn after the whisper (the empty one doesn't count), only 1
    // visible "other" turn, so no trigger fires.
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('does not count isSilentMessage toward cadence', () => {
    // No prior whisper, so this would normally fire 'first' anyway. The
    // assertion is about the silentMsg not flipping any internal counters
    // in a way that would surface a different reason.
    const events: ChatEvent[] = [userMsg(), silentMsg()];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: true, reason: 'first' });
  });

  it('system-typed events neither extend nor break the silence run', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      otherMsg(),
      systemEvent(),
      otherMsg(),
      systemEvent(),
      otherMsg(),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: true, reason: 'silence' });
  });

  it('boundary: interval=1 fires "periodic" on the very next turn after a prior whisper', () => {
    const events: ChatEvent[] = [
      userMsg(),
      mineMsg(),
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events, interval: 1 });
    expect(r).toEqual({ fire: true, reason: 'periodic' });
  });

  it('boundary: silence=1 fires after a single "other" visible turn', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      userMsg(),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events, silenceThreshold: 1 });
    expect(r).toEqual({ fire: true, reason: 'silence' });
  });

  it('multi-trigger composes to one fire (periodic wins over silence) after a prior whisper', () => {
    const events: ChatEvent[] = [
      userMsg(),
      mineMsg(),
      priorCoreWhisperFor(ME),
    ];
    for (let i = 0; i < 12; i++) {
      events.push(userMsg());
      events.push(mineMsg());
    }
    // Then 3 visible "other" turns, which would also trigger silence.
    events.push(otherMsg());
    events.push(otherMsg());
    events.push(otherMsg());
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r.fire).toBe(true);
    expect(r.reason).toBe('periodic');
  });

  it('fires "context-transition" when a Librarian rolling summary lands after the last Core whisper', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      otherMsg(),
      librarianFold(ME),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r.fire).toBe(true);
    // 1 "other" visible turn doesn't hit silence=3, periodic isn't met,
    // so context-transition is the reason that wins.
    expect(r.reason).toBe('context-transition');
  });

  it('does not fire context-transition when fireOnContextTransition is false', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      otherMsg(),
      librarianFold(ME),
    ];
    const r = shouldFireCoreWhisper({
      ...baseOptions,
      events,
      fireOnContextTransition: false,
    });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('does not fire context-transition when fold targets another character', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      otherMsg(),
      librarianFold(OTHER),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('Librarian "folder-created-by-character" announcements do NOT count as context transitions', () => {
    // Regression: an earlier substring check on 'fold' false-matched
    // 'folder-created-by-character' (a character filing a folder), which is
    // not a memory fold at all. Both characters were silently getting
    // context-transition fires after any vault folder creation.
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      librarianAnnouncement('folder-created-by-character'),
      userMsg(),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('Librarian per-character-summary still counts as a context transition', () => {
    const events: ChatEvent[] = [
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
      librarianAnnouncement('per-character-summary', ME),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r.fire).toBe(true);
    expect(r.reason).toBe('context-transition');
  });

  it('does not fire context-transition when fold predates the last Core whisper', () => {
    const events: ChatEvent[] = [
      userMsg(),
      mineMsg(),
      librarianFold(ME),
      priorCoreWhisperFor(ME),
      userMsg(),
      mineMsg(),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: false, reason: null });
  });

  it('"first" (bootstrap) wins over silence and context-transition when no prior whisper exists', () => {
    // Even when silence=3 turns and a real Librarian fold have happened,
    // the first thing that fires for a never-whispered character is 'first'.
    const events: ChatEvent[] = [
      userMsg(),
      mineMsg(),
      otherMsg(),
      otherMsg(),
      otherMsg(),
      librarianFold(ME),
    ];
    const r = shouldFireCoreWhisper({ ...baseOptions, events });
    expect(r).toEqual({ fire: true, reason: 'first' });
  });

  // Reference USER to avoid unused-import warning in strict TS.
  it('USER constant is defined', () => {
    expect(typeof USER).toBe('string');
  });
});
