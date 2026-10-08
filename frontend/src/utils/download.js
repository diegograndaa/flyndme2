// Descarga de un texto como archivo. El BOM hace que Excel abra el CSV como
// UTF-8 (sin él, «Málaga» o «Zúrich» salen rotos); el enlace se añade al DOM
// (Firefox) y la URL se revoca después, no en el mismo tick (Safari/Firefox
// pueden cancelar la descarga si se revoca antes de que empiece).
export function downloadText(filename, text, {
  mime = "text/csv;charset=utf-8",
  bom = true,
  doc = typeof document === "undefined" ? undefined : document,
  urlApi = typeof URL === "undefined" ? undefined : URL,
  later = (fn) => setTimeout(fn, 1000),
} = {}) {
  if (!doc || !urlApi?.createObjectURL) return false;
  const blob = new Blob([bom ? "\uFEFF" : "", text], { type: mime });
  const url = urlApi.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  doc.body.appendChild(a);
  a.click();
  a.remove();
  later(() => urlApi.revokeObjectURL(url));
  return true;
}
