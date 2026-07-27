export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('./sw.js', window.location.href);
    void navigator.serviceWorker.register(serviceWorkerUrl.href);
  });
}
