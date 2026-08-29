import { createDouyinSearchAdapter } from './content/adapters/douyinSearchAdapter.js';
import { createDouyinSearchDom, createVideoCard, VIDEO_NUMERIC_ID, DOUYIN_SEARCH_URL } from './tests/adapters/fixtures/douyinDom.js';

const dom = createDouyinSearchDom({
  url: DOUYIN_SEARCH_URL,
  cards: [createVideoCard(VIDEO_NUMERIC_ID, '02:08 Test video title')]
});

const card = dom.querySelector('[id^="waterfall_item_"]');
console.log('card:', card);
console.log('card.id:', card.id);
console.log('card.getAttribute("id"):', card.getAttribute('id'));
console.log('card.textContent:', card.textContent);
console.log('titleEl:', card.querySelector('.search-result-card'));
console.log('titleEl text:', card.querySelector('.search-result-card')?.textContent);

const adapter = createDouyinSearchAdapter({
  now: () => 1234567890,
  sessionIdFactory: () => 'test-session-123'
});
const candidates = adapter.extractCandidates(dom);
console.log('candidates:', candidates.length, candidates);
