const state = {
  payload: null,
  date: "",
  city: "全部",
  area: "全部",
  search: "",
  sort: "count-desc",
};

const elements = {
  updatedDate: document.querySelector("#updatedDate"),
  dateFilter: document.querySelector("#dateFilter"),
  previousDate: document.querySelector("#previousDate"),
  nextDate: document.querySelector("#nextDate"),
  cityButtons: [...document.querySelectorAll("[data-city]")],
  areaFilter: document.querySelector("#areaFilter"),
  searchInput: document.querySelector("#searchInput"),
  sortFilter: document.querySelector("#sortFilter"),
  resetButton: document.querySelector("#resetButton"),
  stationCount: document.querySelector("#stationCount"),
  bindingTotal: document.querySelector("#bindingTotal"),
  longestStreak: document.querySelector("#longestStreak"),
  areaCount: document.querySelector("#areaCount"),
  resultSummary: document.querySelector("#resultSummary"),
  resultBody: document.querySelector("#resultBody"),
  emptyState: document.querySelector("#emptyState"),
  rowTemplate: document.querySelector("#rowTemplate"),
};

const numberFormat = new Intl.NumberFormat("zh-TW");

function formatDate(value, withYear = true) {
  const [year, month, day] = value.split("-");
  return withYear ? `${year}/${month}/${day}` : `${Number(month)}/${Number(day)}`;
}

function countClass(value) {
  if (value >= 10) return "count-badge--high";
  if (value >= 5) return "count-badge--medium";
  return "count-badge--low";
}

function alertsForDate() {
  return state.payload.alerts.filter((item) => item.date === state.date);
}

function updateAreaOptions() {
  const dateRows = alertsForDate().filter(
    (item) => state.city === "全部" || item.city === state.city,
  );
  const areas = [...new Set(dateRows.map((item) => item.area))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant"),
  );
  const previous = state.area;
  elements.areaFilter.innerHTML = '<option value="全部">全部責任區</option>';
  areas.forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    elements.areaFilter.append(option);
  });
  state.area = areas.includes(previous) ? previous : "全部";
  elements.areaFilter.value = state.area;
}

function filteredRows() {
  const term = state.search.trim().toLocaleLowerCase("zh-Hant");
  const rows = alertsForDate().filter((item) => {
    const matchesCity = state.city === "全部" || item.city === state.city;
    const matchesArea = state.area === "全部" || item.area === state.area;
    const matchesSearch =
      !term ||
      item.stationName.toLocaleLowerCase("zh-Hant").includes(term) ||
      item.stationCode.toLocaleLowerCase("zh-Hant").includes(term);
    return matchesCity && matchesArea && matchesSearch;
  });

  const sorters = {
    "count-desc": (a, b) =>
      b.idleBindingCount - a.idleBindingCount ||
      b.streakDays - a.streakDays ||
      a.stationName.localeCompare(b.stationName, "zh-Hant"),
    "streak-desc": (a, b) =>
      b.streakDays - a.streakDays ||
      b.idleBindingCount - a.idleBindingCount ||
      a.stationName.localeCompare(b.stationName, "zh-Hant"),
    "area-asc": (a, b) =>
      a.area.localeCompare(b.area, "zh-Hant") ||
      b.idleBindingCount - a.idleBindingCount,
    "station-asc": (a, b) => a.stationName.localeCompare(b.stationName, "zh-Hant"),
  };
  return rows.sort(sorters[state.sort]);
}

function buildHistory(history) {
  const wrapper = document.createDocumentFragment();
  history.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "history-day";
    const value = document.createElement("span");
    value.className = "history-day__value";
    if (entry.value > 0) value.classList.add("is-positive");
    if (index >= history.length - 2 && entry.value > 0) value.classList.add("is-alert");
    value.textContent = entry.value ?? "—";
    value.title = `${formatDate(entry.date)}：${entry.value ?? "無資料"} 輛`;
    const date = document.createElement("span");
    date.className = "history-day__date";
    date.textContent = formatDate(entry.date, false);
    item.append(value, date);
    wrapper.append(item);
  });
  return wrapper;
}

function renderRows(rows) {
  elements.resultBody.replaceChildren();
  rows.forEach((item) => {
    const fragment = elements.rowTemplate.content.cloneNode(true);
    const cityBadge = fragment.querySelector(".city-badge");
    cityBadge.textContent = item.city === "台北市" ? "台北" : "新北";
    if (item.city === "新北市") cityBadge.classList.add("city-badge--new-taipei");
    fragment.querySelector(".area-name").textContent = item.area;
    fragment.querySelector(".station-name").textContent = item.stationName;
    fragment.querySelector(".station-code").textContent = item.stationCode;

    const count = fragment.querySelector(".count-badge");
    count.textContent = numberFormat.format(item.idleBindingCount);
    count.classList.add(countClass(item.idleBindingCount));
    count.title = `2.0：${item.idleBinding20} 輛；2.0E：${item.idleBinding20e} 輛`;

    fragment.querySelector(".streak-days").textContent = `${item.streakDays} 天`;
    fragment.querySelector(".streak-start").textContent = `自 ${formatDate(item.streakStart, false)}`;
    fragment.querySelector(".history-strip").append(buildHistory(item.history));
    elements.resultBody.append(fragment);
  });
}

function renderMetrics(rows) {
  const total = rows.reduce((sum, item) => sum + item.idleBindingCount, 0);
  const longest = rows.reduce((max, item) => Math.max(max, item.streakDays), 0);
  const areas = new Set(rows.map((item) => `${item.city}-${item.area}`));
  elements.stationCount.textContent = numberFormat.format(rows.length);
  elements.bindingTotal.textContent = numberFormat.format(total);
  elements.longestStreak.textContent = numberFormat.format(longest);
  elements.areaCount.textContent = numberFormat.format(areas.size);
}

function updateDateButtons() {
  const index = state.payload.dates.indexOf(state.date);
  elements.previousDate.disabled = index <= 0;
  elements.nextDate.disabled = index >= state.payload.dates.length - 1;
}

function render() {
  const rows = filteredRows();
  renderMetrics(rows);
  renderRows(rows);
  elements.resultSummary.textContent = `${formatDate(state.date)}｜顯示 ${numberFormat.format(rows.length)} 個場站`;
  elements.emptyState.hidden = rows.length !== 0;
  elements.resultBody.closest(".table-wrap").hidden = rows.length === 0;
  updateDateButtons();
}

function setDate(nextDate) {
  state.date = nextDate;
  elements.dateFilter.value = nextDate;
  updateAreaOptions();
  render();
}

function changeDate(offset) {
  const index = state.payload.dates.indexOf(state.date);
  const nextIndex = Math.min(Math.max(index + offset, 0), state.payload.dates.length - 1);
  setDate(state.payload.dates[nextIndex]);
}

function wireInteractions() {
  elements.dateFilter.addEventListener("change", (event) => setDate(event.target.value));
  elements.previousDate.addEventListener("click", () => changeDate(-1));
  elements.nextDate.addEventListener("click", () => changeDate(1));
  elements.cityButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.city = button.dataset.city;
      elements.cityButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      updateAreaOptions();
      render();
    });
  });
  elements.areaFilter.addEventListener("change", (event) => {
    state.area = event.target.value;
    render();
  });
  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });
  elements.sortFilter.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
  elements.resetButton.addEventListener("click", () => {
    state.city = "全部";
    state.area = "全部";
    state.search = "";
    state.sort = "count-desc";
    elements.searchInput.value = "";
    elements.sortFilter.value = state.sort;
    elements.cityButtons.forEach((button) =>
      button.classList.toggle("is-active", button.dataset.city === "全部"),
    );
    updateAreaOptions();
    render();
  });
}

async function initialize() {
  const response = await fetch("./data/alerts.json");
  if (!response.ok) throw new Error(`資料讀取失敗：${response.status}`);
  state.payload = await response.json();
  state.date = state.payload.dates.at(-1);
  elements.updatedDate.textContent = formatDate(state.payload.meta.sourceEnd);
  [...state.payload.dates].reverse().forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    option.textContent = formatDate(date);
    elements.dateFilter.append(option);
  });
  elements.dateFilter.value = state.date;
  updateAreaOptions();
  wireInteractions();
  render();
}

initialize().catch((error) => {
  console.error(error);
  elements.resultSummary.textContent = "資料載入失敗";
  elements.emptyState.hidden = false;
  elements.emptyState.querySelector("h3").textContent = "無法載入監控資料";
  elements.emptyState.querySelector("p").textContent = error.message;
});
