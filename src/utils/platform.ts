export function isWindowsPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /^win/i.test(navigator.platform) || /windows/i.test(navigator.userAgent)
  );
}
