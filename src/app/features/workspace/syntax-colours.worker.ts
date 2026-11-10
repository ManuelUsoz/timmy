/// <reference lib="webworker" />
import type { ColourRequest, ColourResponse } from './syntax-highlighter';
import { colourRanges } from './syntax-colours';

/**
 * The worker that colours source off the main thread. It is a file of the build, never a blob: the CSP
 * (`script-src 'self'`) blocks blob workers. A text it cannot colour comes back with no ranges and stays plain.
 */
addEventListener('message', (event: MessageEvent<ColourRequest>) => {
  const { id, content, hljsId } = event.data;
  const answer = (response: ColourResponse) => postMessage(response);
  void colourRanges(content, hljsId).then(
    (ranges) => answer({ id, ranges }),
    () => answer({ id, ranges: [] }),
  );
});
