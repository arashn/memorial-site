const SUPPORTED = new Set(["en", "fa"]);
const STORAGE_KEY = "preferred_locale";

function getPathLocale() {
  const first = window.location.pathname.split("/").filter(Boolean)[0];
  return SUPPORTED.has(first) ? first : null;
}

function detectLocale() {
  const langs = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en"];

  for (const lang of langs) {
    const lower = String(lang || "").toLowerCase();
    if (lower.startsWith("fa")) return "fa";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}

function targetPath(locale) {
  return `/${locale}/submit.html`;
}

function redirectToLocale(locale) {
  if (!SUPPORTED.has(locale)) return;
  window.location.replace(targetPath(locale));
}

function initManualPreferenceCapture() {
  const links = document.querySelectorAll("[data-set-locale]");
  for (const link of links) {
    link.addEventListener("click", () => {
      const locale = link.getAttribute("data-set-locale");
      if (locale && SUPPORTED.has(locale)) {
        localStorage.setItem(STORAGE_KEY, locale);
      }
    });
  }
}

function run() {
  if (!["/", "/index.html"].includes(window.location.pathname)) {
    return;
  }

  initManualPreferenceCapture();

  const params = new URLSearchParams(window.location.search);
  const manualMode = params.get("manual") === "1";

  const requestedLocale = params.get("lang");
  if (requestedLocale && SUPPORTED.has(requestedLocale)) {
    localStorage.setItem(STORAGE_KEY, requestedLocale);
    if (!manualMode) {
      redirectToLocale(requestedLocale);
    }
    return;
  }

  if (manualMode) return;

  const storedLocale = localStorage.getItem(STORAGE_KEY);
  if (storedLocale && SUPPORTED.has(storedLocale)) {
    redirectToLocale(storedLocale);
    return;
  }

  const pathLocale = getPathLocale();
  if (pathLocale && SUPPORTED.has(pathLocale)) {
    localStorage.setItem(STORAGE_KEY, pathLocale);
    return;
  }

  const locale = detectLocale();
  localStorage.setItem(STORAGE_KEY, locale);
  redirectToLocale(locale);
}

run();
