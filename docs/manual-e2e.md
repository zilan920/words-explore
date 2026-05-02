# Manual E2E: Vocabulary Study Flow

## Purpose

Verify the main local browser flow after dictionary-backed recommendations:

- onboarding starts a new user session
- the 10-question assessment can be completed
- recommendation streaming fills the study queue
- study cards use dictionary data for part of speech, Chinese definition, and English example
- card actions advance the queue and trigger replenishment

## Prerequisites

1. Install dependencies with `pnpm install`.
2. Ensure `.env.local` contains the required LLM and storage environment variables.
3. Start the local app with `pnpm dev`.
4. Open `http://localhost:3000`.

## Test Steps

1. Clear `localStorage` and `sessionStorage`, then reload the page.
2. Confirm the onboarding screen renders `词汇探索`, learning goal buttons, and the `开始` button.
3. Click `开始`.
4. In the assessment, answer `我不认识` for all 10 words.
5. Click `下一题` after each answer, then click `提交 10/10` on the last question.
6. Wait for the study card to appear.
7. Confirm the first card contains:
   - a word heading
   - part of speech
   - difficulty text
   - a Chinese dictionary definition
   - an English example or dictionary example fallback
   - `会了`, `简单`, and `继续` action buttons
   - the queue progress indicator
8. Click `继续`.
9. Confirm the next card appears with a Chinese dictionary definition.
10. Check the browser console for errors and warnings.
11. Check server logs for missing ECDICT data errors.

## Expected Result

- Assessment completes successfully.
- The initial recommendation stream returns cards.
- `definitionZh` is Chinese dictionary content, not an English fallback.
- A card action advances to the next word.
- Browser console has no errors or warnings.
- Server logs do not include `[dictionary] ECDICT lookup failed`.

## Latest Local Run

Date: 2026-05-02

Browser target: `http://localhost:3000`

Result: Pass

Observed flow:

- New user: `vivid-summit-1lp6734`
- Initial queue: 3 words
- First visible card: `museum`
- First Chinese definition: `n. 博物馆`
- Second visible card after `继续`: `junior`
- Second Chinese definition: `n. 年少者, 地位较低者, 大学三年级学生; a. 年少的, 下级的, 后进的`
- Browser console: no errors or warnings
- Server ECDICT errors: none

Observed LLM latency from server logs:

- Initial 3-word recommendation stream:
  - first word: 1496 ms
  - LLM generation duration: 2097 ms
  - API stream request duration: 5017 ms
- 1-word replenishment after card action:
  - first accepted word: 2168 ms
  - LLM generation duration: 2435 ms
  - API stream request duration: 5740 ms
  - note: one duplicate candidate was rejected and retried
