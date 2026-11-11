(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    stationTotal: $("stationTotal"), restrictionTotal: $("restrictionTotal"), geometryTotal: $("geometryTotal"),
    search: $("searchInput"), city: $("cityFilter"), district: $("districtFilter"), route: $("routeFilter"),
    weight: $("weightFilter"), time: $("timeFilter"), hour: $("hourFilter"), hourField: $("hourField"),
    showStations: $("showStations"), showRestrictions: $("showRestrictions"), showPermitted: $("showPermitted"),
    reset: $("resetFilters"), list: $("restrictionList"), summary: $("resultSummary"), loadMore: $("loadMore"),
    fit: $("fitResults"), loading: $("loadingState"), locate: $("locateButton"),
    sidebar: $("sidebar"), mobileButton: $("mobilePanelButton"), backdrop: $("mobileBackdrop"),
  };

  for (let hour = 0; hour < 24; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour);
    option.textContent = `${String(hour).padStart(2, "0")}:00`;
    if (hour === new Date().getHours()) option.selected = true;
    ui.hour.appendChild(option);
  }

  const map = L.map("map", { preferCanvas: true, zoomControl: true, minZoom: 9 }).setView([25.065, 121.535], 11);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  const canvasRenderer = L.canvas({ padding: 0.35, tolerance: 5 });
  const stationLayer = L.markerClusterGroup ? L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 90,
    chunkDelay: 35,
    maxClusterRadius: 58,
    disableClusteringAtZoom: 17,
    removeOutsideVisibleBounds: true,
    animate: false,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
  }).addTo(map) : L.layerGroup().addTo(map);
  const officialRouteLayer = L.layerGroup().addTo(map);
  const taipeiZoneLayer = L.layerGroup().addTo(map);
  const approximateLayer = L.layerGroup().addTo(map);
  const focusLayer = L.layerGroup().addTo(map);

  const state = {
    stations: [],
    records: [],
    kmlFeatures: [],
    zoneFeatures: [],
    metadata: {},
    visibleRecords: [],
    visibleGeometryFeatures: [],
    geometryLayerById: new Map(),
    recordMarkerById: new Map(),
    pageSize: 60,
    shown: 60,
    stationSignature: "",
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const normalize = (value) => String(value ?? "").toLowerCase().replace(/臺/g, "台").replace(/[\s，,。．、()（）~～—–\-]/g, "");

  function isOfficial(status) {
    return status === "official" || status === "official_match";
  }

  function geoLabel(status) {
    if (isOfficial(status)) return "官方幾何";
    if (status === "schematic") return "公告邊界示意";
    if (status === "approximate_station_match") return "道路約略定位";
    if (status === "district_centroid") return "行政區約略定位";
    return "僅文字資料";
  }

  function activeAt(intervals, allDay, hour) {
    if (allDay) return true;
    if (!Array.isArray(intervals) || intervals.length === 0) return false;
    const minute = Number(hour) * 60 + 30;
    return intervals.some((interval) => {
      const m = String(interval).match(/(\d{2}):(\d{2})\D+(\d{2}):(\d{2})/);
      if (!m) return false;
      const start = Number(m[1]) * 60 + Number(m[2]);
      const end = Number(m[3]) * 60 + Number(m[4]);
      if (end === 1440) return minute >= start;
      return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
    });
  }

  function matchesTime(item) {
    const mode = ui.time.value;
    if (mode === "all") return true;
    if (mode === "all_day") return Boolean(item.all_day);
    if (mode === "timed") return !item.all_day;
    return activeAt(item.time_intervals, item.all_day, Number(ui.hour.value));
  }

  function weightsOf(item) {
    return (item.weight_tons || []).map(String);
  }

  function matchesWeight(item) {
    const selected = ui.weight.value;
    const weights = weightsOf(item);
    if (selected === "all") return true;
    if (selected === "unspecified") return weights.length === 0;
    return weights.includes(selected);
  }

  function textOfRecord(record) {
    return normalize([record.city, record.district, record.road, record.vehicle_original, record.time, record.raw].join(" "));
  }

  function textOfFeature(feature) {
    const p = feature.properties || {};
    return normalize([p.city, p.district, p.name, p.description, p.folder].join(" "));
  }

  function commonMatch(item, text, routeKind) {
    const city = ui.city.value;
    const district = ui.district.value;
    const query = normalize(ui.search.value);
    if (city !== "all" && item.city !== city) return false;
    if (district !== "all" && item.district !== district && !text.includes(normalize(district.replace("區", "")))) return false;
    if (query && !text.includes(query)) return false;
    if (ui.route.value !== "all" && routeKind !== ui.route.value) return false;
    if (!matchesWeight(item)) return false;
    if (!matchesTime(item)) return false;
    return true;
  }

  function recordMatches(record) {
    return commonMatch(record, textOfRecord(record), record.route_kind || "restricted_route");
  }

  function featureMatches(feature) {
    const p = feature.properties || {};
    if (!commonMatch(p, textOfFeature(feature), p.route_kind)) return false;
    if (p.route_kind === "permitted") return ui.showPermitted.checked;
    return ui.showRestrictions.checked;
  }

  function stationMatches(feature) {
    const p = feature.properties;
    if (ui.city.value !== "all" && p.city !== ui.city.value) return false;
    if (ui.district.value !== "all" && p.district !== ui.district.value) return false;
    const query = normalize(ui.search.value);
    if (query && !normalize([p.name, p.code, p.city, p.district, p.address].join(" ")).includes(query)) return false;
    return true;
  }

  function routeStyle(feature) {
    const kind = feature.properties.route_kind;
    if (kind === "permitted") return { color: "#1473e6", weight: 3.2, opacity: 0.8, fillColor: "#1473e6", fillOpacity: 0.08 };
    if (kind === "restricted_area") return { color: "#db3d83", weight: 2.2, opacity: 0.9, fillColor: "#e54f91", fillOpacity: 0.18 };
    return { color: "#e8424a", weight: 3.6, opacity: 0.86, fillColor: "#e8424a", fillOpacity: 0.12 };
  }

  function popupStation(p) {
    const status = Number(p.status) === 1 ? "營運中" : `狀態 ${escapeHtml(p.status)}`;
    return `<h3 class="popup-title">${escapeHtml(p.name)}</h3>
      <div class="popup-sub">${escapeHtml(p.code)} · ${escapeHtml(p.city)} ${escapeHtml(p.district)}</div>
      <div class="popup-row"><b>地址</b><span>${escapeHtml(p.address)}</span></div>
      <div class="popup-row"><b>總柱數</b><span>${escapeHtml(p.capacity)} 柱</span></div>
      <div class="popup-row"><b>狀態</b><span>${status}</span></div>
      <div class="popup-row"><b>更新</b><span>${escapeHtml(p.updated_at)}</span></div>`;
  }

  function popupFeature(p) {
    const warning = p.geometry_status === "schematic" ? "區域面依公告邊界道路繪製，僅為示意。" : "本圖層為主管機關發布之官方地圖幾何。";
    return `<h3 class="popup-title">${escapeHtml(p.name)}</h3>
      <div class="popup-sub">${escapeHtml(p.city)} ${escapeHtml(p.district || "")} · ${p.route_kind === "permitted" ? "可行駛路線" : p.route_kind === "restricted_area" ? "禁行區域" : "禁行路線"}</div>
      ${p.description ? `<div class="popup-row"><b>規定</b><span>${escapeHtml(p.description)}</span></div>` : ""}
      ${p.time_intervals?.length ? `<div class="popup-row"><b>時段</b><span>${escapeHtml(p.time_intervals.join("、"))}</span></div>` : ""}
      <div class="popup-warning">${escapeHtml(warning)}實際仍以現場標誌為準。</div>
      <a class="popup-link" href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">查看官方來源 ↗</a>`;
  }

  function popupRecord(r) {
    const approximate = !isOfficial(r.geometry_status);
    return `<h3 class="popup-title">${escapeHtml(r.road)}</h3>
      <div class="popup-sub">${escapeHtml(r.city)} ${escapeHtml(r.district)}</div>
      <div class="popup-row"><b>車種／噸位</b><span>${escapeHtml(r.vehicle_original || r.vehicle)}</span></div>
      <div class="popup-row"><b>禁行時段</b><span>${escapeHtml(r.time || "依原文")}</span></div>
      <div class="popup-warning">${approximate ? `${escapeHtml(geoLabel(r.geometry_status))}，圖釘不代表法定起訖。` : "已連結官方幾何。"}實際仍以現場標誌為準。</div>
      <a class="popup-link" href="${escapeHtml(r.source_url)}" target="_blank" rel="noopener">查看官方清單 ↗</a>`;
  }

  function renderStations() {
    const signature = [ui.showStations.checked, ui.city.value, ui.district.value, normalize(ui.search.value)].join("|");
    if (signature === state.stationSignature) return;
    state.stationSignature = signature;
    stationLayer.clearLayers();
    if (!ui.showStations.checked) return;
    const features = state.stations.filter(stationMatches);
    const markers = [];
    for (const feature of features) {
      const [lng, lat] = feature.geometry.coordinates;
      const p = feature.properties;
      const color = p.city === "臺北市" ? "#08aebf" : "#516fe8";
      markers.push(L.circleMarker([lat, lng], {
        renderer: canvasRenderer, radius: 3.3, weight: 1, color: "#fff", fillColor: color, fillOpacity: 0.88,
      }).bindPopup(() => popupStation(p)));
    }
    if (stationLayer.addLayers) stationLayer.addLayers(markers);
    else markers.forEach((marker) => marker.addTo(stationLayer));
  }

  function addGeoJsonFeature(feature, targetLayer, styleFn) {
    let createdLayer = null;
    L.geoJSON(feature, {
      style: styleFn,
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        renderer: canvasRenderer, radius: 5, weight: 1.5,
        color: styleFn(f).color, fillColor: styleFn(f).color, fillOpacity: .8,
      }),
      onEachFeature: (f, layer) => {
        createdLayer = layer;
        layer.bindPopup(popupFeature(f.properties));
        layer.on("mouseover", () => { if (layer.setStyle) layer.setStyle({ weight: (styleFn(f).weight || 2) + 1.5, opacity: 1 }); });
        layer.on("mouseout", () => { if (layer.setStyle) layer.setStyle(styleFn(f)); });
      },
    }).eachLayer((layer) => targetLayer.addLayer(layer));
    return createdLayer;
  }

  function renderGeometry() {
    officialRouteLayer.clearLayers();
    taipeiZoneLayer.clearLayers();
    state.geometryLayerById.clear();
    state.visibleGeometryFeatures = [];

    for (const feature of state.kmlFeatures) {
      if (!featureMatches(feature)) continue;
      const layer = addGeoJsonFeature(feature, officialRouteLayer, routeStyle);
      if (layer) state.geometryLayerById.set(feature.properties.id, layer);
      state.visibleGeometryFeatures.push(feature);
    }
    for (const feature of state.zoneFeatures) {
      if (!featureMatches(feature)) continue;
      const layer = addGeoJsonFeature(feature, taipeiZoneLayer, () => ({ ...routeStyle(feature), dashArray: "7 5" }));
      if (layer) state.geometryLayerById.set(feature.properties.id, layer);
      state.visibleGeometryFeatures.push(feature);
    }
  }

  function renderApproximateMarkers() {
    approximateLayer.clearLayers();
    state.recordMarkerById.clear();
    if (!ui.showRestrictions.checked || ui.route.value === "permitted" || ui.route.value === "restricted_area") return;
    for (const record of state.visibleRecords) {
      if (record.geometry_status === "official_match" || record.lat == null || record.lng == null) continue;
      const marker = L.circleMarker([record.lat, record.lng], {
        renderer: canvasRenderer, radius: 5.2, weight: 1.5, color: "#fff", fillColor: "#f59e0b", fillOpacity: .9,
      }).bindPopup(popupRecord(record)).addTo(approximateLayer);
      state.recordMarkerById.set(record.id, marker);
    }
  }

  function itemForFeature(feature) {
    const p = feature.properties;
    return {
      id: p.id, city: p.city, district: p.district || "", road: p.name,
      vehicle_original: p.route_kind === "permitted" ? "主管機關標示可行駛路線" : p.description,
      time: p.time_intervals?.join("、") || (p.all_day ? "全日" : "請見官方規定"),
      geometry_status: p.geometry_status, source_url: p.source_url, geometry_feature_id: p.id,
      _feature: true,
    };
  }

  function cardHtml(item) {
    const official = isOfficial(item.geometry_status);
    return `<article class="restriction-card" role="button" tabindex="0" data-item-id="${escapeHtml(item.id)}" data-feature="${item._feature ? "1" : "0"}">
      <div class="card-top">
        <span class="city-badge ${item.city === "新北市" ? "ntp" : ""}">${escapeHtml(item.city.replace("市", ""))}</span>
        <h3>${escapeHtml(item.road)}</h3>
      </div>
      <p>${escapeHtml(item.district)}${item.vehicle_original ? ` · ${escapeHtml(item.vehicle_original)}` : ""}</p>
      <p class="time">${escapeHtml(item.time || "依官方原文")}</p>
      <div class="card-meta">
        <span class="geo-badge ${official ? "official" : ""}">${escapeHtml(geoLabel(item.geometry_status))}</span>
        <a class="card-source" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener" data-source-link>官方來源 ↗</a>
      </div>
    </article>`;
  }

  function listItems() {
    const kind = ui.route.value;
    if (kind === "permitted" || kind === "restricted_area") {
      return state.visibleGeometryFeatures.filter((f) => f.properties.route_kind === kind).map(itemForFeature);
    }
    return state.visibleRecords;
  }

  function renderList() {
    const items = listItems();
    const shown = items.slice(0, state.shown);
    ui.list.innerHTML = shown.map(cardHtml).join("") || `<div class="notice-card"><div class="notice-icon">i</div><div><strong>沒有符合的資料</strong><p>請調整縣市、行政區、時段或關鍵字。</p></div></div>`;
    const label = ui.route.value === "permitted" ? "可行駛路線" : ui.route.value === "restricted_area" ? "禁行區域" : "限制路段";
    ui.summary.textContent = `符合 ${items.length.toLocaleString()} 筆${label}；圖上另顯示 ${state.stations.filter(stationMatches).length.toLocaleString()} 個場站`;
    ui.loadMore.classList.toggle("is-hidden", items.length <= state.shown);

    ui.list.querySelectorAll(".restriction-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("[data-source-link]")) return;
        focusItem(card.dataset.itemId, card.dataset.feature === "1");
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        focusItem(card.dataset.itemId, card.dataset.feature === "1");
      });
    });
  }

  function focusLayerOnMap(layer) {
    if (!layer) return false;
    if (layer.getBounds) {
      const bounds = layer.getBounds();
      if (bounds?.isValid()) map.fitBounds(bounds.pad(.25), { maxZoom: 17 });
    } else if (layer.getLatLng) {
      map.flyTo(layer.getLatLng(), 16, { duration: .7 });
    }
    setTimeout(() => layer.openPopup?.(), 450);
    return true;
  }

  function focusItem(id, isFeature) {
    closeMobilePanel();
    if (isFeature && focusLayerOnMap(state.geometryLayerById.get(id))) return;
    const record = state.records.find((r) => r.id === id);
    if (!record) return;
    if (record.geometry_feature_id && focusLayerOnMap(state.geometryLayerById.get(record.geometry_feature_id))) return;
    const marker = state.recordMarkerById.get(id);
    if (focusLayerOnMap(marker)) return;
    if (record.lat != null && record.lng != null) {
      map.flyTo([record.lat, record.lng], 15, { duration: .7 });
      focusLayer.clearLayers();
      L.circleMarker([record.lat, record.lng], { radius: 9, weight: 3, color: "#f59e0b", fillColor: "#fff", fillOpacity: .85 })
        .bindPopup(popupRecord(record)).addTo(focusLayer).openPopup();
    }
  }

  function refreshDistricts() {
    const current = ui.district.value;
    const city = ui.city.value;
    const values = new Set();
    state.records.forEach((r) => { if (city === "all" || r.city === city) values.add(r.district); });
    state.stations.forEach((s) => { if (city === "all" || s.properties.city === city) values.add(s.properties.district); });
    ui.district.innerHTML = `<option value="all">全部行政區</option>${[...values].filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-Hant")).map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}`;
    ui.district.value = values.has(current) ? current : "all";
  }

  function applyFilters({ resetShown = true } = {}) {
    if (resetShown) state.shown = state.pageSize;
    ui.hourField.classList.toggle("is-hidden", ui.time.value !== "hour");
    state.visibleRecords = state.records.filter(recordMatches);
    renderGeometry();
    renderApproximateMarkers();
    renderStations();
    renderList();
  }

  function fitVisible() {
    const bounds = L.latLngBounds();
    let count = 0;
    for (const feature of state.visibleGeometryFeatures) {
      const layer = state.geometryLayerById.get(feature.properties.id);
      if (layer?.getBounds && layer.getBounds().isValid()) { bounds.extend(layer.getBounds()); count += 1; }
      else if (layer?.getLatLng) { bounds.extend(layer.getLatLng()); count += 1; }
    }
    for (const marker of state.recordMarkerById.values()) { bounds.extend(marker.getLatLng()); count += 1; }
    if (count && bounds.isValid()) map.fitBounds(bounds.pad(.08), { maxZoom: 14 });
  }

  function resetFilters() {
    ui.search.value = "";
    ui.city.value = "all";
    refreshDistricts();
    ui.district.value = "all";
    ui.route.value = "all";
    ui.weight.value = "all";
    ui.time.value = "all";
    ui.showStations.checked = true;
    ui.showRestrictions.checked = true;
    ui.showPermitted.checked = false;
    state.stationSignature = "";
    applyFilters();
    map.fitBounds([[24.78, 121.27], [25.31, 122.02]], { padding: [20, 20] });
  }

  function openMobilePanel() {
    ui.sidebar.classList.add("is-open");
    ui.backdrop.classList.add("is-open");
    ui.mobileButton.setAttribute("aria-expanded", "true");
  }
  function closeMobilePanel() {
    ui.sidebar.classList.remove("is-open");
    ui.backdrop.classList.remove("is-open");
    ui.mobileButton.setAttribute("aria-expanded", "false");
  }

  function debounce(fn, wait = 180) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  }

  async function loadData() {
    try {
      const [stations, restrictions, routes, zones] = await Promise.all([
        fetch("data/stations.geojson").then((r) => r.json()),
        fetch("data/restrictions.json").then((r) => r.json()),
        fetch("data/newtaipei-routes.geojson").then((r) => r.json()),
        fetch("data/taipei-zones.geojson").then((r) => r.json()),
      ]);
      state.stations = stations.features;
      state.records = restrictions.records;
      state.metadata = restrictions.metadata;
      state.kmlFeatures = routes.features;
      state.zoneFeatures = zones.features;

      ui.stationTotal.textContent = state.stations.length.toLocaleString();
      ui.restrictionTotal.textContent = state.records.length.toLocaleString();
      ui.geometryTotal.textContent = state.kmlFeatures.length.toLocaleString();
      refreshDistricts();
      applyFilters();
      map.fitBounds([[24.78, 121.27], [25.31, 122.02]], { padding: [12, 12] });
      ui.loading.classList.add("is-done");
    } catch (error) {
      console.error(error);
      ui.loading.innerHTML = `<strong>資料載入失敗</strong><span>請重新整理頁面，或稍後再試。</span>`;
    }
  }

  ui.city.addEventListener("change", () => { refreshDistricts(); applyFilters(); });
  [ui.district, ui.route, ui.weight, ui.time, ui.hour, ui.showStations, ui.showRestrictions, ui.showPermitted].forEach((element) => element.addEventListener("change", () => applyFilters()));
  ui.search.addEventListener("input", debounce(() => applyFilters()));
  ui.reset.addEventListener("click", resetFilters);
  ui.fit.addEventListener("click", fitVisible);
  ui.loadMore.addEventListener("click", () => { state.shown += state.pageSize; renderList(); });
  ui.mobileButton.addEventListener("click", () => ui.sidebar.classList.contains("is-open") ? closeMobilePanel() : openMobilePanel());
  ui.backdrop.addEventListener("click", closeMobilePanel);
  ui.locate.addEventListener("click", () => map.locate({ setView: true, maxZoom: 16 }));
  map.on("locationfound", (event) => {
    focusLayer.clearLayers();
    L.circleMarker(event.latlng, { radius: 7, color: "#1677c8", fillColor: "#fff", fillOpacity: 1, weight: 3 })
      .bindPopup("目前位置").addTo(focusLayer).openPopup();
  });
  map.on("locationerror", () => alert("無法取得目前位置，請確認瀏覽器定位權限。"));

  loadData();
})();
