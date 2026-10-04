import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * The two lines a reseller pastes into their own site.
 *
 *   <div id="watches"></div>
 *   <script src="https://…/embed.js" data-shop="TOKEN" data-target="watches"></script>
 *
 * Everything else is this file's problem. It builds the frame, points it at
 * the chrome-free shop page, and keeps it the height of its contents by
 * listening for the message that page sends. No build step, no framework, no
 * package to install — which matters, because the reseller most likely to want
 * this is the one whose site is on a platform they cannot add a dependency to.
 *
 * Served rather than written into their page so the embedding never goes
 * stale: a fix here reaches every site that has pasted it, without anybody
 * being asked to paste it again.
 */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin

  const script = `(function () {
  'use strict';
  var current = document.currentScript;
  if (!current) return;

  var shop = current.getAttribute('data-shop');
  if (!shop) {
    console.error('[shop] the embed needs data-shop set to the shop key');
    return;
  }

  // Where the frame goes: a named element, or straight after the script tag,
  // which is what happens when somebody pastes it where they want it.
  var targetId = current.getAttribute('data-target');
  var mount = targetId ? document.getElementById(targetId) : null;
  if (!mount) {
    mount = document.createElement('div');
    current.parentNode.insertBefore(mount, current.nextSibling);
  }

  var frame = document.createElement('iframe');
  frame.src = ${JSON.stringify(origin)} + '/s/' + encodeURIComponent(shop) + '/embed';
  frame.title = current.getAttribute('data-title') || 'Available stock';
  frame.loading = 'lazy';
  frame.setAttribute('scrolling', 'no');
  frame.setAttribute('allowtransparency', 'true');
  frame.style.width = '100%';
  frame.style.border = '0';
  frame.style.display = 'block';
  frame.style.overflow = 'hidden';
  // Tall enough that the list is visibly there before the first height
  // message arrives, rather than a sliver that jumps.
  frame.style.height = (current.getAttribute('data-height') || '1200') + 'px';
  mount.appendChild(frame);

  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== 'one-street-shop:height') return;
    var height = parseInt(data.height, 10);
    if (!height || height < 80) return;
    frame.style.height = height + 'px';
  });
})();
`

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Anybody's site may load it; that is the point of it.
      'Access-Control-Allow-Origin': '*',
      // Short enough that a fix lands the same day, long enough that a busy
      // shop is not re-fetching it on every page view.
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  })
}
