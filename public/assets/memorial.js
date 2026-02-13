const list = document.getElementById("memorial-list");

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
  item.textContent = "Memorial list is temporarily unavailable.";
  list.appendChild(item);
}
