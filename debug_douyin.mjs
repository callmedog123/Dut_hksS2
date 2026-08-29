import { createDouyinSearchAdapter } from './content/adapters/douyinSearchAdapter.js';
import { createDouyinSearchDom, createVideoCard, VIDEO_NUMERIC_ID, DOUYIN_SEARCH_URL } from './tests/adapters/fixtures/douyinDom.js';

const dom = createDouyinSearchDom({
  url: DOUYIN_SEARCH_URL,
  cards: [createVideoCard(VIDEO_NUMERIC_ID, '02:08 Test video title')]
});
console.log('dom.location.href:', dom.location.href);
console.log('dom.baseURI:', dom.baseURI);
console.log('cards:', dom.querySelectorAll('[id^="waterfall_item_"]').length);

const adapter = createDouyinSearchAdapter({
  now: () => 1234567890,
  sessionIdFactory: () => 'test-session-123'
});
const candidates = adapter.extractCandidates(dom);
console.log('candidates:', candidates.length, candidates);
