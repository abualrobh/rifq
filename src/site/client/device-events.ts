// Kit v38: the home cards, the mySaved row, recently read, the Saved screen and Settings read the
// device again whenever what they show may be out of date:
// - storage: another RIFQ tab changed the saves (RQ-008 AC24, as before);
// - pageshow with persisted: the page came back from the browser's back-forward cache (Safari keeps
//   whole pages there; a reading position saved meanwhile on another page was not seen);
// - visibilitychange to visible: the tab is shown again.
// Nothing is sent anywhere; only this device's storage is read. Returns the function that stops it.
export function onDeviceChange(read: () => void): () => void {
  const onShow = (e: PageTransitionEvent) => { if (e.persisted) read(); };
  const onVis = () => { if (document.visibilityState === 'visible') read(); };
  window.addEventListener('storage', read);
  window.addEventListener('pageshow', onShow);
  document.addEventListener('visibilitychange', onVis);
  return () => {
    window.removeEventListener('storage', read);
    window.removeEventListener('pageshow', onShow);
    document.removeEventListener('visibilitychange', onVis);
  };
}
