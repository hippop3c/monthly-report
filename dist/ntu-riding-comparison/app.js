(() => {
  "use strict";
  const manifest = window.NTU_RIDING_MANIFEST;
  const COLORS = {"05":"#2563eb","09":"#16a34a","10":"#f97316"};
  const ORIGIN_COLOR = "#06b6d4";
  const DESTINATION_COLOR = "#e11d48";
  const fmt = new Intl.NumberFormat("zh-TW", {maximumFractionDigits:1});
  const state = {layers:[], markers:[], loadToken:0, selectedRoute:null};
  const $ = (id) => document.getElementById(id);
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/臺/g,"台").replace(/\s+/g,"").toLowerCase();
  const stations = manifest.stations.map((row,index) => ({index,code:row[0],name:row[1],className:row[2],district:row[3],lat:Number(row[4]),lng:Number(row[5]),search:norm(`${row[0]} ${row[1]} ${row[2]} ${row[3]}`)}));
  const periodMeta = Object.fromEntries(manifest.periods.map(row => [row.period,row]));
  window.NTU_RIDING_SHARDS = window.NTU_RIDING_SHARDS || {};
  const map = L.map("map", {preferCanvas:true, zoomControl:true}).setView([25.0183,121.5395],14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  map.createPane("routePane");map.getPane("routePane").style.zIndex="430";
  map.createPane("endpointPane");map.getPane("endpointPane").style.zIndex="460";map.getPane("endpointPane").style.pointerEvents="none";
  map.createPane("searchPane");map.getPane("searchPane").style.zIndex="480";
  const renderer = L.canvas({padding:0.6,tolerance:7,pane:"routePane"});
  const searchRenderer = L.canvas({padding:0.3,pane:"searchPane"});

  const PRESETS = {
    all:[...Array(24).keys()],
    "6-24":[...Array(18).keys()].map(value=>value+6),
    "7-9":[7,8,9],
    "11-13":[11,12,13],
    "16-20":[16,17,18,19,20],
    "21-00":[21,22,23],
    clear:[]
  };
  $("hourOptions").innerHTML=manifest.hours.map((hour,index)=>{
    const clock=String(index).padStart(2,"0");
    return `<label><input type="checkbox" name="timeHour" value="${index}" checked><span>${clock}:00–${clock}:59</span></label>`;
  }).join("");
  manifest.categories.forEach((category,index) => $("categorySelect").add(new Option(category, String(index))));

  function selectedValues(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(node => node.value);}
  function selectedHours(){return selectedValues("timeHour").map(Number).sort((a,b)=>a-b);}
  function compactHourLabel(hours){
    if(hours.length===24)return "全日（24時段）";
    if(!hours.length)return "未選時段";
    const ranges=[];let start=hours[0],end=hours[0];
    hours.slice(1).forEach(hour=>{if(hour===end+1){end=hour;}else{ranges.push([start,end]);start=hour;end=hour;}});ranges.push([start,end]);
    return ranges.map(([from,to])=>from===to?`${String(from).padStart(2,"0")}:00–${String(to).padStart(2,"0")}:59`:`${String(from).padStart(2,"0")}:00–${String(to).padStart(2,"0")}:59`).join("、");
  }
  function updateTimeSummary(){const hours=selectedHours();const label=compactHourLabel(hours);$("timeSummary").textContent=hours.length>8&&hours.length<24?`${hours.length}個時段` : label;$("timeSummary").title=label;}
  function setHours(hours){const chosen=new Set(hours);document.querySelectorAll('input[name="timeHour"]').forEach(node=>{node.checked=chosen.has(Number(node.value));});updateTimeSummary();}
  function positionTimeMenu(){if(!$("timePicker").open)return;const rect=$("timePicker").getBoundingClientRect(),menu=$("timeMenu");const width=Math.min(590,window.innerWidth-24);menu.style.width=`${width}px`;menu.style.left=`${Math.max(12,Math.min(rect.left,window.innerWidth-width-12))}px`;menu.style.top=`${rect.bottom+6}px`;}
  function injectScript(src){return new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=src;script.onload=()=>resolve();script.onerror=()=>reject(new Error(`無法載入 ${src}`));document.head.appendChild(script);});}
  async function ensurePeriod(period){if(window.NTU_RIDING_SHARDS[period])return;await injectScript(`data/${manifest.shards[period]}?v=20261027-2`);}
  function clearMap(){state.layers.forEach(layer=>map.removeLayer(layer));state.markers.forEach(layer=>map.removeLayer(layer));state.layers=[];state.markers=[];}
  function offsetPair(a,b,year){
    const dx=b.lng-a.lng,dy=b.lat-a.lat,length=Math.hypot(dx,dy)||1;
    const sign=year===2025?-1:1,amount=0.000018*sign;
    const ox=(-dy/length)*amount,oy=(dx/length)*amount;
    return [[a.lat+oy,a.lng+ox],[b.lat+oy,b.lng+ox]];
  }
  function currentTimeLabel(){return compactHourLabel(selectedHours());}
  function routeObject(period,raw,hours){
    const origin=stations[raw[0]],destination=stations[raw[1]],categoryIndex=raw[2],sampleDays=periodMeta[period].sample_days;
    const hourOffset=3+manifest.bands.length*4;
    const total=hours.reduce((sum,hour)=>sum+Number(raw[hourOffset+hour]||0),0),average=total/sampleDays;
    return {period,year:Number(period.slice(0,4)),month:period.slice(5),origin,destination,categoryIndex,category:manifest.categories[categoryIndex],total,average,sampleDays};
  }
  function popupHtml(route){return `<div class="popup-title">${safe(route.origin.name)} → ${safe(route.destination.name)}</div><div class="popup-meta">${route.period}｜${safe(route.category)}｜${safe(currentTimeLabel())}</div><div class="popup-value">日均 ${fmt.format(route.average)} 次</div><div>所選時段總量 ${fmt.format(route.total)} 次｜樣本 ${route.sampleDays} 日</div>`;}
  function rowHtml(route,index){return `<tr data-index="${index}"><td><span class="period" style="color:${COLORS[route.month]}">${route.period}</span><span class="direction">${safe(route.category)}</span></td><td class="route-name">${safe(route.origin.name)}<br><small>→ ${safe(route.destination.name)}</small></td><td><b>${fmt.format(route.average)}</b></td></tr>`;}
  function renderEndpointMarkers(routes){
    const roles=new Map();
    routes.forEach(route=>{roles.set(route.origin.index,(roles.get(route.origin.index)||0)|1);roles.set(route.destination.index,(roles.get(route.destination.index)||0)|2);});
    roles.forEach((mask,index)=>{const station=stations[index];if(!station||!Number.isFinite(station.lat)||!Number.isFinite(station.lng))return;const roleClass=mask===3?"both":mask===1?"origin":"destination";const marker=L.marker([station.lat,station.lng],{pane:"endpointPane",interactive:false,keyboard:false,icon:L.divIcon({className:"endpoint-icon",html:`<span class="endpoint-pin ${roleClass}"></span>`,iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map);state.markers.push(marker);});
  }
  async function refresh(){
    const token=++state.loadToken;$("loading").classList.remove("hidden");$("mapMessage").classList.add("hidden");
    const years=selectedValues("year"),months=selectedValues("month"),hours=selectedHours();
    const periods=years.flatMap(year=>months.map(month=>`${year}-${month}`)).filter(key=>manifest.shards[key]);
    if(!periods.length){clearMap();showEmpty("請至少選擇一個年度與月份");return;}
    if(!hours.length){clearMap();showEmpty("請至少選擇一個時段");return;}
    try{await Promise.all(periods.map(ensurePeriod));}catch(error){if(token===state.loadToken)showEmpty(error.message);return;}
    if(token!==state.loadToken)return;
    const category=$("categorySelect").value,query=norm($("stationSearch").value),minimum=Number($("minAverage").value);
    const routes=[];
    periods.forEach(period=>window.NTU_RIDING_SHARDS[period].routes.forEach(raw=>{
      const route=routeObject(period,raw,hours);
      if(route.average<minimum)return;
      if(category!=="all"&&route.categoryIndex!==Number(category))return;
      if(query&&!route.origin.search.includes(query)&&!route.destination.search.includes(query))return;
      if(!Number.isFinite(route.origin.lat)||!Number.isFinite(route.destination.lat))return;
      routes.push(route);
    }));
    routes.sort((a,b)=>b.average-a.average);
    clearMap();
    routes.forEach(route=>{
      const coords=offsetPair(route.origin,route.destination,route.year);
      const layer=L.polyline(coords,{renderer,color:COLORS[route.month],weight:Math.max(1.2,Math.min(9,1+Math.sqrt(route.average)*0.9)),opacity:.65,dashArray:route.year===2025?"10 7":null,lineCap:"round"}).addTo(map);
      layer.bindPopup(popupHtml(route));layer.on("mouseover",()=>{layer.bringToFront();layer.setStyle({opacity:1,weight:Math.min(11,layer.options.weight+2)});});layer.on("mouseout",()=>layer.setStyle({opacity:.65,weight:Math.max(1.2,Math.min(9,1+Math.sqrt(route.average)*0.9))}));
      route.layer=layer;state.layers.push(layer);
    });
    renderEndpointMarkers(routes);
    if(query){
      const matched=stations.filter(station=>station.search.includes(query)&&Number.isFinite(station.lat));
      matched.forEach(station=>{const marker=L.circleMarker([station.lat,station.lng],{renderer:searchRenderer,pane:"searchPane",radius:10,color:"#facc15",weight:4,fillOpacity:0}).addTo(map).bindTooltip(`${safe(station.name)} (${safe(station.code)})`);state.markers.push(marker);});
    }
    renderSide(routes,periods);
    $("loading").classList.add("hidden");
  }
  function renderSide(routes,periods){
    $("routeCount").textContent=fmt.format(routes.length);$("routeKpi").textContent=fmt.format(routes.length);$("averageKpi").textContent=fmt.format(routes.reduce((sum,row)=>sum+row.average,0));
    $("sampleKpi").textContent=periods.map(period=>`${period}:${periodMeta[period].sample_days}`).join("｜");
    $("statusText").textContent=`${currentTimeLabel()}｜最低日均 ${Number($("minAverage").value).toFixed(1)} 次`;
    $("routeRows").innerHTML=routes.slice(0,80).map(rowHtml).join("")||'<tr><td colspan="3">沒有符合條件的路線</td></tr>';
    [...$("routeRows").querySelectorAll("tr[data-index]")].forEach(row=>row.addEventListener("click",()=>{const route=routes[Number(row.dataset.index)];map.fitBounds(route.layer.getBounds(),{padding:[80,80],maxZoom:16});route.layer.openPopup();}));
  }
  function showEmpty(message){clearMap();$("loading").classList.add("hidden");$("mapMessage").textContent=message;$("mapMessage").classList.remove("hidden");$("routeRows").innerHTML="";$("routeCount").textContent="0";$("routeKpi").textContent="0";$("averageKpi").textContent="0";$("sampleKpi").textContent="—";}
  function debounce(fn,delay=180){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);};}
  const debouncedRefresh=debounce(refresh,100);
  document.querySelectorAll('input[name="year"],input[name="month"],#categorySelect').forEach(node=>node.addEventListener("change",refresh));
  document.querySelectorAll('input[name="timeHour"]').forEach(node=>node.addEventListener("change",()=>{updateTimeSummary();debouncedRefresh();}));
  document.querySelectorAll("[data-hour-preset]").forEach(button=>button.addEventListener("click",()=>{setHours(PRESETS[button.dataset.hourPreset]||[]);debouncedRefresh();}));
  $("timePicker").addEventListener("toggle",positionTimeMenu);window.addEventListener("resize",positionTimeMenu);document.querySelector(".controls").addEventListener("scroll",positionTimeMenu);
  document.addEventListener("click",event=>{if($("timePicker").open&&!$("timePicker").contains(event.target))$("timePicker").open=false;});
  $("minAverage").addEventListener("input",()=>{$("minLabel").textContent=Number($("minAverage").value).toFixed(1);debouncedRefresh();});
  $("stationSearch").addEventListener("input",debounce(refresh,240));
  $("resetButton").addEventListener("click",()=>{document.querySelectorAll('input[name="year"]').forEach(node=>node.checked=true);document.querySelectorAll('input[name="month"]').forEach(node=>node.checked=node.value==="05");setHours(PRESETS.all);$("categorySelect").value="all";$("stationSearch").value="";$("minAverage").value="1";$("minLabel").textContent="1.0";$("timePicker").open=false;map.setView([25.0183,121.5395],14);refresh();});
  updateTimeSummary();
  refresh();
})();
