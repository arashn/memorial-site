const SUPPORTED = new Set(["en", "fa"]);
const STORAGE_KEY = "preferred_locale";

function getPathLocale() {
  const first = window.location.pathname.split("/").filter(Boolean)[0];
  return SUPPORTED.has(first) ? first : null;
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
  const pathLocale = getPathLocale();
  if (pathLocale && SUPPORTED.has(pathLocale)) {
    localStorage.setItem(STORAGE_KEY, pathLocale);
  }

  if (!["/", "/index.html"].includes(window.location.pathname)) return;

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

  // Default locale when no explicit preference exists.
  localStorage.setItem(STORAGE_KEY, "fa");
  redirectToLocale("fa");
}

run();
