// Detecting and applying a new deploy from inside the POS.
//
// The tills run Chrome in fullscreen "app" mode on a touchscreen: no address
// bar, no refresh button, no keyboard. Staff therefore have no way to reload
// after a deploy, and the only workaround has been restarting the whole PC.
// These helpers let the app notice a new build and reload itself on a tap.
//
// Detection compares the hashed entry bundle the page is *running* against the
// one the server is *serving* right now. Vite content-hashes that filename, so
// a differing name means a new build is live. No backend endpoint is needed.

/** The entry bundle this page actually loaded, e.g. "/assets/index-B1BPZVnA.js". */
function runningAssetUrl(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  if (!script) {
    return null;
  }
  // Compare paths, not full URLs: the served HTML carries a root-relative src.
  try {
    return new URL(script.src, window.location.origin).pathname;
  } catch {
    return null;
  }
}

/** The entry bundle the server is serving now, or null if it can't be read. */
async function deployedAssetUrl(): Promise<string | null> {
  // Bypass both the HTTP cache and the service worker so this reflects the
  // deployed build rather than whatever this window started with.
  const response = await fetch(`/index.html?_=${Date.now()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    return null;
  }
  const html = await response.text();
  const match = html.match(/<script[^>]+src="([^"]+\.js)"/);
  return match ? match[1] : null;
}

/**
 * Whether a newer build is live. Returns false on any network or parse failure
 * so an offline till never nags staff about an update it cannot verify.
 */
export async function isUpdateAvailable(): Promise<boolean> {
  const running = runningAssetUrl();
  if (!running) {
    return false;
  }
  try {
    const deployed = await deployedAssetUrl();
    return deployed !== null && deployed !== running;
  } catch {
    return false;
  }
}

/**
 * Drop caches that could serve stale files, then reload into the new build.
 *
 * Navigation is already network-first in the service worker and assets are
 * content-hashed, so a plain reload would normally suffice; clearing first
 * makes this robust even if that caching strategy changes later.
 */
export async function reloadIntoLatestBuild(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // A blocked cache API must not stop the reload.
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
  } catch {
    // Same: best effort only.
  }
  window.location.reload();
}
