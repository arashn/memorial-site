import { getLocaleFromPath, loadMessages } from "/assets/i18n.js";

const list = document.getElementById("memorial-list");
const locale = getLocaleFromPath();
let messages = {
  memorial_unavailable: "Memorial list is temporarily unavailable."
};

try {
  messages = { ...messages, ...(await loadMessages(locale)) };
} catch {
  // Keep default English strings when locale file is unavailable.
}

try {
  const res = await fetch("/memorial/names.json", { cache: "no-store" });
  if (!res.ok) throw new Error("memorial_fetch_failed");
  const names = await res.json();

  for (const entry of names) {
    const item = document.createElement("li");
    const date = entry.date ? ` (${entry.date})` : "";
    const location = entry.location ? `, ${entry.location}` : "";
    item.textContent = `${entry.name}${date}${location}`;
    list.appendChild(item);
  }
} catch {
  const item = document.createElement("li");
  item.textContent = messages.memorial_unavailable;
  list.appendChild(item);
}
