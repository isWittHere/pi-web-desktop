export async function copyText(text: string): Promise<void> {
  try {
    if (await window.piDesktop?.writeClipboardText(text)) return;
  } catch {
    // Fall through to browser clipboard APIs outside the packaged app.
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for browsers that expose but deny the Clipboard API.
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!copied) {
    throw new Error("Clipboard write failed");
  }
}
