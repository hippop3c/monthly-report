(() => {
  "use strict";
  const manifest = window.NTU_RIDING_MANIFEST;
  const COLORS = {"05":"#2563eb","09":"#16a34a","10":"#f97316"};
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
  const renderer = L.canvas({padding:0.6,tolerance:7});

  manifest.bands.forEach((band,index) => $("bandSelect").add(new Option(band, `b${index}`)));
  manifest.hours.forEach((hour,index) => {
    const clock = String(hour).replace(/時$/, "");
    $("bandSelect").add(new Option(`${clock}:00–${clock}:59`, `h${index}`));
  });
  manifest.categories.forEach((category,index) => $("categorySelect").add(new Option(category, String(index))));
  $("bandSelect").value = "b0";

  function selectedValues(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(node => node.value);}
  function injectScript(src){return new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=src;script.onload=()=>resolve();script.onerror=()=>reject(new Error(`無法載入 ${src}`));document.head.appendChild(script);});}
  async function ensurePeriod(period){if(window.NTU_RIDING_SHARDS[period])return;await injectScript(`data/${manifest.shards[period]}?v=20261027-1`);}
  function clearMap(){state.layers.forEach(layer=>map.removeLayer(layer));state.markers.forEach(layer=>map.removeLayer(layer));state.layers=[];state.markers=[];}
  function offsetPair(a,b,year){
    const dx=b.lng-a.lng,dy=b.lat-a.lat,length=Math.hypot(dx,dy)||1;
    const sign=year===2025?-1:1,amount=0.000018*sign;
    const ox=(-dy/length)*amount,oy=(dx/length)*amount;
    return [[a.lat+oy,a.lng+ox],[b.lat+oy,b.lng+ox]];
  }
  function currentTimeLabel(){const option=$("bandSelect").selectedOptions[0];return option?option.textContent:"全日";}
  function routeObject(period,raw,timeValue){
    const origin=stations[raw[0]],destination=stations[raw[1]],categoryIndex=raw[2],sampleDays=periodMeta[period].sample_days;
    let total=0,activeDays=null,average=0,activeAverage=null;
    if(timeValue.startsWith("b")){const base=3+Number(timeValue.slice(1))*4;total=raw[base];activeDays=raw[base+1];average=raw[base+2];activeAverage=raw[base+3];}
    else{const hour=Number(timeValue.slice(1));total=raw[3+manifest.bands.length*4+hour];average=total/sampleDays;}
    return {period,year:Number(period.slice(0,4)),month:period.slice(5),origin,destination,categoryIndex,category:manifest.categories[categoryIndex],total,activeDays,average,activeAverage,sampleDays};
  }
  function popupHtml(route){return `<div class="popup-title">${safe(route.origin.name)} → ${safe(route.destination.name)}</div><div class="popup-meta">${route.period}｜${safe(route.category)}｜${safe(currentTimeLabel())}</div><div class="popup-value">日均 ${fmt.format(route.average)} 次</div><div>期間總量 ${fmt.format(route.total)} 次｜樣本 ${route.sampleDays} 日${route.activeDays==null?"":`｜有騎乘 ${route.activeDays} 日`}</div>`;}
  function rowHtml(route,index){return `<tr data-index="${index}"><td><span class="period" style="color:${COLORS[route.month]}">${route.period}</span><span class="direction">${safe(route.category)}</span></td><td class="route-name">${safe(route.origin.name)}<br><small>→ ${safe(route.destination.name)}</small></td><td><b>${fmt.format(route.average)}</b></td></tr>`;}
  async function refresh(){
    const token=++state.loadToken;$("loading").classList.remove("hidden");$("mapMessage").classList.add("hidden");
    const years=selectedValues("year"),months=selectedValues("month");
    const periods=years.flatMap(year=>months.map(month=>`${year}-${month}`)).filter(key=>manifest.shards[key]);
    if(!periods.length){clearMap();showEmpty("請至少選擇一個年度與月份");return;}
    try{await Promise.all(periods.map(ensurePeriod));}catch(error){if(token===state.loadToken)showEmpty(error.message);return;}
    if(token!==state.loadToken)return;
    const timeValue=$("bandSelect").value,category=$("categorySelect").value,query=norm($("stationSearch").value),minimum=Number($("minAverage").value);
    const routes=[];
    periods.forEach(period=>window.NTU_RIDING_SHARDS[period].routes.forEach(raw=>{
      const route=routeObject(period,raw,timeValue);
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
      layer.bindPopup(popupHtml(route));layer.on("mouseover",()=>layer.setStyle({opacity:1,weight:Math.min(11,layer.options.weight+2)}));layer.on("mouseout",()=>layer.setStyle({opacity:.65,weight:Math.max(1.2,Math.min(9,1+Math.sqrt(route.average)*0.9))}));
      route.layer=layer;state.layers.push(layer);
    });
    if(query){
      const matched=stations.filter(station=>station.search.includes(query)&&Number.isFinite(station.lat));
      matched.forEach(station=>{const marker=L.circleMarker([station.lat,station.lng],{radius:8,color:"#fff",weight:2,fillColor:"#17385f",fillOpacity:.95}).addTo(map).bindTooltip(`${safe(station.name)} (${safe(station.code)})`);state.markers.push(marker);});
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
  document.querySelectorAll('input[name="year"],input[name="month"],#bandSelect,#categorySelect').forEach(node=>node.addEventListener("change",refresh));
  $("minAverage").addEventListener("input",()=>{$("minLabel").textContent=Number($("minAverage").value).toFixed(1);debouncedRefresh();});
  $("stationSearch").addEventListener("input",debounce(refresh,240));
  const debouncedRefresh=debounce(refresh,100);
  $("resetButton").addEventListener("click",()=>{document.querySelectorAll('input[name="year"]').forEach(node=>node.checked=true);document.querySelectorAll('input[name="month"]').forEach(node=>node.checked=node.value==="05");$("bandSelect").value="b0";$("categorySelect").value="all";$("stationSearch").value="";$("minAverage").value="1";$("minLabel").textContent="1.0";map.setView([25.0183,121.5395],14);refresh();});
  refresh();
})();
