export function getLocaleFromPath(pathname = window.location.pathname) {
  const first = pathname.split("/").filter(Boolean)[0];
  return first === "fa" ? "fa" : "en";
}

export async function loadMessages(locale) {
  const safe = locale === "fa" ? "fa" : "en";
  const res = await fetch(`/i18n/${safe}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error("i18n_load_failed");
  return res.json();
}
