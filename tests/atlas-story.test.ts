import { describe, expect, it } from 'vitest';
import { ATLAS_STORY, ATLAS_STORY_CHAPTERS, getAtlasStoryChapter, selectAtlasHubDispatch } from '../shared/atlas/story';

describe('NIM Atlas living story', () => {
  it('binds every permanent district into one human arc with a final missing piece', () => {
    expect(ATLAS_STORY.title).toBe('The Thread That Binds');
    expect(ATLAS_STORY_CHAPTERS).toHaveLength(7);
    expect(ATLAS_STORY_CHAPTERS.map((chapter) => chapter.districtId)).toEqual([
      'genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city', 'beacon-core',
    ]);
    expect(ATLAS_STORY_CHAPTERS.at(-1)?.reveal).toMatch(/witness/i);
    expect(getAtlasStoryChapter('pay-harbor')?.lesson).toMatch(/control|approval|payment/i);
  });

  it('selects a stable daily hub dispatch and keeps reward language honest', () => {
    const first = selectAtlasHubDispatch(new Date('2026-09-09T08:00:00.000Z'));
    const repeated = selectAtlasHubDispatch(new Date('2026-09-09T19:00:00.000Z'));
    expect(repeated).toEqual(first);
    expect(first.title).toContain('Dispatch');
    expect(first.chapterId).toBeTruthy();
    expect(first.rewardCopy).toMatch(/server|verified/i);
  });

  it('keeps every story voice line explicitly English and playable in short beats', () => {
    for (const chapter of ATLAS_STORY_CHAPTERS) {
      expect(chapter.voice.arrival.locale).toBe('en-US');
      expect(chapter.voice.arrival.text.length).toBeLessThan(220);
      expect(chapter.voice.completion.text.length).toBeLessThan(220);
    }
  });
});
