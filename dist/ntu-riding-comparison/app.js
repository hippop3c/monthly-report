(() => {
  "use strict";

  const manifest = window.NTU_RIDING_MANIFEST;
  const trackingManifest = window.NTU_VEHICLE_TRACKING_MANIFEST || null;
  const COLORS = {"05":"#2563eb","09":"#16a34a","10":"#f97316"};
  const ORIGIN_COLOR = "#06b6d4";
  const DESTINATION_COLOR = "#e11d48";
  const RIDING_COLOR = "#f59e0b";
  const TRACE_COLOR = "#334155";
  const fmt = new Intl.NumberFormat("zh-TW", {maximumFractionDigits:1});
  const state = {mode:"route", layers:[], markers:[], loadToken:0};
  const $ = (id) => document.getElementById(id);
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/臺/g,"台").replace(/\s+/g,"").toLowerCase();
  const coordinate = (value) => value===null||value===undefined||value==="" ? Number.NaN : Number(value);
  const stationObjects = (rows) => rows.map((row,index) => ({
    index,
    code:String(row[0]),
    name:row[1],
    className:row[2],
    district:row[3],
    lat:coordinate(row[4]),
    lng:coordinate(row[5]),
    search:norm(`${row[0]} ${row[1]} ${row[2]} ${row[3]}`)
  }));
  const stations = stationObjects(manifest.stations);
  const trackingStations = stationObjects(trackingManifest?.stations||manifest.stations);
  const trackingFieldIndex = Object.fromEntries((trackingManifest?.fields||[]).map((field,index) => [field,index]));
  const trackingPeriods = (trackingManifest?.periods||[])
    .filter((row) => String(row.period||"").startsWith("2026-"))
    .sort((a,b) => String(a.period).localeCompare(String(b.period)));
  const periodMeta = Object.fromEntries(manifest.periods.map((row) => [row.period,row]));
  const trackingLoadPromises = new Map();
  window.NTU_RIDING_SHARDS = window.NTU_RIDING_SHARDS || {};
  window.NTU_VEHICLE_TRACKING_SHARDS = window.NTU_VEHICLE_TRACKING_SHARDS || {};

  const map = L.map("map", {preferCanvas:true, zoomControl:true}).setView([25.0183,121.5395],14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  map.createPane("routePane");
  map.getPane("routePane").style.zIndex="430";
  map.createPane("endpointPane");
  map.getPane("endpointPane").style.zIndex="460";
  map.getPane("endpointPane").style.pointerEvents="none";
  map.createPane("trackingPane");
  map.getPane("trackingPane").style.zIndex="475";
  map.createPane("searchPane");
  map.getPane("searchPane").style.zIndex="490";
  const renderer = L.canvas({padding:0.6,tolerance:7,pane:"routePane"});
  const trackingRenderer = L.canvas({padding:0.6,tolerance:7,pane:"trackingPane"});
  const searchRenderer = L.canvas({padding:0.3,pane:"searchPane"});

  const PRESETS = {
    all:[...Array(24).keys()],
    "6-24":[...Array(18).keys()].map((value) => value+6),
    "7-9":[7,8,9],
    "11-13":[11,12,13],
    "16-20":[16,17,18,19,20],
    "21-00":[21,22,23],
    clear:[]
  };

  $("hourOptions").innerHTML=manifest.hours.map((_hour,index) => {
    const clock=String(index).padStart(2,"0");
    return `<label><input type="checkbox" name="timeHour" value="${index}" checked><span>${clock}:00–${clock}:59</span></label>`;
  }).join("");
  $("trackingHourOptions").innerHTML=manifest.hours.map((_hour,index) => {
    const clock=String(index).padStart(2,"0");
    return `<label><input type="checkbox" name="trackingTimeHour" value="${index}" checked><span>${clock}:00–${clock}:59</span></label>`;
  }).join("");
  manifest.categories.forEach((category,index) => $("categorySelect").add(new Option(category, String(index))));

  function selectedValues(name){
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((node) => node.value);
  }

  function selectedHours(){
    return selectedValues("timeHour").map(Number).sort((a,b) => a-b);
  }

  function selectedTrackingHours(){
    return selectedValues("trackingTimeHour").map(Number).sort((a,b) => a-b);
  }

  function selectedTrackingDates(){
    return selectedValues("trackingDate").sort();
  }

  function compactHourLabel(hours){
    if(hours.length===24)return "全日（24時段）";
    if(!hours.length)return "未選時段";
    const ranges=[];
    let start=hours[0],end=hours[0];
    hours.slice(1).forEach((hour) => {
      if(hour===end+1){end=hour;}
      else{ranges.push([start,end]);start=hour;end=hour;}
    });
    ranges.push([start,end]);
    return ranges.map(([from,to]) => from===to
      ? `${String(from).padStart(2,"0")}:00–${String(to).padStart(2,"0")}:59`
      : `${String(from).padStart(2,"0")}:00–${String(to).padStart(2,"0")}:59`
    ).join("、");
  }

  function updateTimeSummary(){
    const hours=selectedHours();
    const label=compactHourLabel(hours);
    $("timeSummary").textContent=hours.length>8&&hours.length<24 ? `${hours.length}個時段` : label;
    $("timeSummary").title=label;
  }

  function setHours(hours){
    const chosen=new Set(hours);
    document.querySelectorAll('input[name="timeHour"]').forEach((node) => {node.checked=chosen.has(Number(node.value));});
    updateTimeSummary();
  }

  function updateTrackingTimeSummary(){
    const hours=selectedTrackingHours();
    const label=compactHourLabel(hours);
    $("trackingTimeSummary").textContent=hours.length>8&&hours.length<24 ? `${hours.length}個時段` : label;
    $("trackingTimeSummary").title=label;
  }

  function setTrackingHours(hours){
    const chosen=new Set(hours);
    document.querySelectorAll('input[name="trackingTimeHour"]').forEach((node) => {node.checked=chosen.has(Number(node.value));});
    updateTrackingTimeSummary();
  }

  function trackingDateLabel(days=selectedTrackingDates()){
    if(!days.length)return "未選日期";
    const period=trackingPeriod();
    const allDates=period?.dates||[];
    if(days.length===allDates.length)return `全部（${days.length}日）`;
    if(days.length===1)return days[0];
    return `${days.length}個日期`;
  }

  function updateTrackingDateSummary(){
    const days=selectedTrackingDates();
    $("trackingDateSummary").textContent=trackingDateLabel(days);
    $("trackingDateSummary").title=days.join("、")||"未選日期";
  }

  function setTrackingDates(days){
    const chosen=new Set(days);
    document.querySelectorAll('input[name="trackingDate"]').forEach((node) => {node.checked=chosen.has(node.value);});
    updateTrackingDateSummary();
  }

  function positionPickerMenu(pickerId,menuId,maximumWidth=590){
    const picker=$(pickerId);
    if(!picker?.open)return;
    const rect=picker.getBoundingClientRect();
    const menu=$(menuId);
    const width=Math.min(maximumWidth,window.innerWidth-24);
    menu.style.width=`${width}px`;
    menu.style.left=`${Math.max(12,Math.min(rect.left,window.innerWidth-width-12))}px`;
    menu.style.top=`${rect.bottom+6}px`;
  }

  function positionTimeMenu(){positionPickerMenu("timePicker","timeMenu",590);}
  function positionTrackingMenus(){
    positionPickerMenu("trackingDatePicker","trackingDateMenu",430);
    positionPickerMenu("trackingTimePicker","trackingTimeMenu",590);
  }

  function injectScript(src){
    return new Promise((resolve,reject) => {
      const script=document.createElement("script");
      script.src=src;
      script.onload=() => resolve();
      script.onerror=() => reject(new Error(`無法載入 ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensurePeriod(period){
    if(window.NTU_RIDING_SHARDS[period])return;
    await injectScript(`data/${manifest.shards[period]}?v=20261028-1`);
  }

  async function ensureTrackingDay(day){
    if(window.NTU_VEHICLE_TRACKING_SHARDS[day])return;
    const descriptor=trackingManifest?.days?.[day];
    if(!descriptor)throw new Error("所選日期沒有車號追蹤資料");
    if(!trackingLoadPromises.has(day)){
      const promise=injectScript(`data/tracking/${descriptor.file}?v=20261028-1`).finally(() => trackingLoadPromises.delete(day));
      trackingLoadPromises.set(day,promise);
    }
    await trackingLoadPromises.get(day);
  }

  function clearMap(){
    state.layers.forEach((layer) => map.removeLayer(layer));
    state.markers.forEach((layer) => map.removeLayer(layer));
    state.layers=[];
    state.markers=[];
  }

  function startLoading(label){
    $("loadingText").textContent=label;
    $("loading").classList.remove("hidden");
    $("mapMessage").classList.add("hidden");
  }

  function stopLoading(){
    $("loading").classList.add("hidden");
  }

  function showMapMessage(message){
    $("mapMessage").textContent=message;
    $("mapMessage").classList.remove("hidden");
  }

  function offsetPair(a,b,year){
    const dx=b.lng-a.lng,dy=b.lat-a.lat,length=Math.hypot(dx,dy)||1;
    const sign=year===2025?-1:1,amount=0.000018*sign;
    const ox=(-dy/length)*amount,oy=(dx/length)*amount;
    return [[a.lat+oy,a.lng+ox],[b.lat+oy,b.lng+ox]];
  }

  function currentTimeLabel(){
    return compactHourLabel(selectedHours());
  }

  function routeObject(period,raw,hours){
    const origin=stations[raw[0]],destination=stations[raw[1]],categoryIndex=raw[2],sampleDays=periodMeta[period].sample_days;
    const hourOffset=3+manifest.bands.length*4;
    const total=hours.reduce((sum,hour) => sum+Number(raw[hourOffset+hour]||0),0),average=total/sampleDays;
    return {period,year:Number(period.slice(0,4)),month:period.slice(5),origin,destination,categoryIndex,category:manifest.categories[categoryIndex],total,average,sampleDays};
  }

  function popupHtml(route){
    return `<div class="popup-title">${safe(route.origin.name)} → ${safe(route.destination.name)}</div><div class="popup-meta">${route.period}｜${safe(route.category)}｜${safe(currentTimeLabel())}</div><div class="popup-value">日均 ${fmt.format(route.average)} 次</div><div>所選時段總量 ${fmt.format(route.total)} 次｜樣本 ${route.sampleDays} 日</div>`;
  }

  function rowHtml(route,index){
    return `<tr data-index="${index}"><td><span class="period" style="color:${COLORS[route.month]}">${route.period}</span><span class="direction">${safe(route.category)}</span></td><td class="route-name">${safe(route.origin.name)}<br><small>→ ${safe(route.destination.name)}</small></td><td><b>${fmt.format(route.average)}</b></td></tr>`;
  }

  function renderEndpointMarkers(routes){
    const roles=new Map();
    routes.forEach((route) => {
      roles.set(route.origin.index,(roles.get(route.origin.index)||0)|1);
      roles.set(route.destination.index,(roles.get(route.destination.index)||0)|2);
    });
    roles.forEach((mask,index) => {
      const station=stations[index];
      if(!station||!Number.isFinite(station.lat)||!Number.isFinite(station.lng))return;
      const roleClass=mask===3?"both":mask===1?"origin":"destination";
      const marker=L.marker([station.lat,station.lng],{
        pane:"endpointPane",
        interactive:false,
        keyboard:false,
        icon:L.divIcon({className:"endpoint-icon",html:`<span class="endpoint-pin ${roleClass}"></span>`,iconSize:[16,16],iconAnchor:[8,8]})
      }).addTo(map);
      state.markers.push(marker);
    });
  }

  async function refreshRoutes(){
    if(state.mode!=="route")return;
    const token=++state.loadToken;
    startLoading("載入路線資料…");
    const years=selectedValues("year"),months=selectedValues("month"),hours=selectedHours();
    const periods=years.flatMap((year) => months.map((month) => `${year}-${month}`)).filter((key) => manifest.shards[key]);
    if(!periods.length){showRouteEmpty("請至少選擇一個年度與月份");return;}
    if(!hours.length){showRouteEmpty("請至少選擇一個時段");return;}
    try{
      await Promise.all(periods.map(ensurePeriod));
    }catch(error){
      if(token===state.loadToken)showRouteEmpty(error.message);
      return;
    }
    if(token!==state.loadToken||state.mode!=="route")return;
    const category=$("categorySelect").value;
    const query=norm($("stationSearch").value);
    const minimum=Number($("minAverage").value);
    const routes=[];
    periods.forEach((period) => window.NTU_RIDING_SHARDS[period].routes.forEach((raw) => {
      const route=routeObject(period,raw,hours);
      if(route.average<minimum)return;
      if(category!=="all"&&route.categoryIndex!==Number(category))return;
      if(query&&!route.origin.search.includes(query)&&!route.destination.search.includes(query))return;
      if(!Number.isFinite(route.origin.lat)||!Number.isFinite(route.destination.lat))return;
      routes.push(route);
    }));
    routes.sort((a,b) => b.average-a.average);
    clearMap();
    routes.forEach((route) => {
      const coords=offsetPair(route.origin,route.destination,route.year);
      const baseWeight=Math.max(1.2,Math.min(9,1+Math.sqrt(route.average)*0.9));
      const layer=L.polyline(coords,{renderer,color:COLORS[route.month],weight:baseWeight,opacity:.65,dashArray:route.year===2025?"10 7":null,lineCap:"round"}).addTo(map);
      layer.bindPopup(popupHtml(route));
      layer.on("mouseover",() => {layer.bringToFront();layer.setStyle({opacity:1,weight:Math.min(11,baseWeight+2)});});
      layer.on("mouseout",() => layer.setStyle({opacity:.65,weight:baseWeight}));
      route.layer=layer;
      state.layers.push(layer);
    });
    renderEndpointMarkers(routes);
    if(query){
      stations.filter((station) => station.search.includes(query)&&Number.isFinite(station.lat)).forEach((station) => {
        const marker=L.circleMarker([station.lat,station.lng],{renderer:searchRenderer,pane:"searchPane",radius:10,color:"#facc15",weight:4,fillOpacity:0}).addTo(map).bindTooltip(`${safe(station.name)} (${safe(station.code)})`);
        state.markers.push(marker);
      });
    }
    renderRouteSide(routes,periods);
    stopLoading();
  }

  function renderRouteSide(routes,periods){
    $("routeCount").textContent=fmt.format(routes.length);
    $("routeKpi").textContent=fmt.format(routes.length);
    $("averageKpi").textContent=fmt.format(routes.reduce((sum,row) => sum+row.average,0));
    $("sampleKpi").textContent=periods.map((period) => `${period}:${periodMeta[period].sample_days}`).join("｜");
    $("statusText").textContent=`${currentTimeLabel()}｜最低日均 ${Number($("minAverage").value).toFixed(1)} 次`;
    $("routeRows").innerHTML=routes.slice(0,80).map(rowHtml).join("")||'<tr><td colspan="3">沒有符合條件的路線</td></tr>';
    [...$("routeRows").querySelectorAll("tr[data-index]")].forEach((row) => row.addEventListener("click",() => {
      const route=routes[Number(row.dataset.index)];
      map.fitBounds(route.layer.getBounds(),{padding:[80,80],maxZoom:16});
      route.layer.openPopup();
    }));
  }

  function showRouteEmpty(message){
    clearMap();
    stopLoading();
    showMapMessage(message);
    $("routeRows").innerHTML="";
    $("routeCount").textContent="0";
    $("routeKpi").textContent="0";
    $("averageKpi").textContent="0";
    $("sampleKpi").textContent="—";
  }

  function minuteLabel(minute){
    if(!Number.isFinite(minute))return "—";
    const dayOffset=Math.floor(minute/1440);
    const normalized=((minute%1440)+1440)%1440;
    const hour=String(Math.floor(normalized/60)).padStart(2,"0");
    const mins=String(normalized%60).padStart(2,"0");
    return `${dayOffset>0?`翌日${dayOffset>1?dayOffset:""} `:""}${hour}:${mins}`;
  }

  function cutoffMinute(){
    const [hour,minute]=String($("trackingCutoff").value||"23:59").split(":").map(Number);
    return Math.max(0,Math.min(1439,(Number.isFinite(hour)?hour:23)*60+(Number.isFinite(minute)?minute:59)));
  }

  function trackingRecords(shard,cutoff,hourSet,day){
    const latest=new Map();
    const field=(raw,name,fallbackIndex) => raw[trackingFieldIndex[name]??fallbackIndex];
    const requiredNumber=(value) => Number(value);
    const optionalNumber=(value) => {
      if(value===null||value===undefined||value==="")return Number.NaN;
      const number=Number(value);
      return Number.isFinite(number)&&number>=0 ? number : Number.NaN;
    };
    const station=(value) => {
      const index=Number(value);
      return Number.isInteger(index)&&index>=0 ? trackingStations[index] : null;
    };
    shard.r.forEach((raw) => {
      const vehicleIndex=requiredNumber(field(raw,"vehicle_index",0));
      const bikeTypeIndex=requiredNumber(field(raw,"bike_type_index",1));
      const vehicle=String(shard.v[vehicleIndex]??"");
      const borrowMinute=requiredNumber(field(raw,"borrow_minute",2));
      if(!vehicle||!Number.isFinite(borrowMinute)||borrowMinute>cutoff)return;
      const borrowHour=Math.floor((((borrowMinute%1440)+1440)%1440)/60);
      if(hourSet&&!hourSet.has(borrowHour))return;
      const record={
        day,
        vehicle,
        bikeType:String(shard.t[bikeTypeIndex]??"未標示"),
        borrowMinute,
        returnMinute:requiredNumber(field(raw,"return_minute_from_borrow_day",3)),
        origin:station(field(raw,"origin_station_index",4)),
        seedDestination:station(field(raw,"destination_station_index",5)),
        reborrowMinute:optionalNumber(field(raw,"reborrow_minute_from_seed_day",6)),
        reborrowReturnMinute:optionalNumber(field(raw,"reborrow_return_minute_from_seed_day",7)),
        reborrowDestination:station(field(raw,"reborrow_destination_station_index",8))
      };
      if(!record.origin||!record.seedDestination)return;
      const prior=latest.get(vehicle);
      const returnSort=Number.isFinite(record.returnMinute)?record.returnMinute:-1;
      const priorReturnSort=Number.isFinite(prior?.returnMinute)?prior.returnMinute:-1;
      if(!prior||record.borrowMinute>prior.borrowMinute||(record.borrowMinute===prior.borrowMinute&&returnSort>priorReturnSort))latest.set(vehicle,record);
    });
    return [...latest.values()].map((record) => {
      const seedReturned=Number.isFinite(record.returnMinute)&&record.returnMinute>=record.borrowMinute&&record.returnMinute<=cutoff;
      const hasReborrow=seedReturned&&Number.isFinite(record.reborrowMinute)&&record.reborrowMinute>=record.returnMinute&&record.reborrowMinute<=cutoff;
      const reborrowReturned=hasReborrow&&Number.isFinite(record.reborrowReturnMinute)&&record.reborrowReturnMinute>=record.reborrowMinute&&record.reborrowReturnMinute<=cutoff&&record.reborrowDestination;
      return {
        ...record,
        seedReturned,
        reborrowed:Boolean(hasReborrow),
        reborrowReturned:Boolean(reborrowReturned),
        returned:Boolean(hasReborrow?reborrowReturned:seedReturned),
        destination:reborrowReturned?record.reborrowDestination:record.seedDestination,
        activityMinute:hasReborrow?record.reborrowMinute:record.borrowMinute
      };
    });
  }

  function trackingPopup(record,day=record.day){
    const seedLine=record.seedReturned
      ? `<div>→ ${minuteLabel(record.returnMinute)}　${safe(record.seedDestination.name)} (${safe(record.seedDestination.code)})</div>`
      : '<div class="riding-status">截至所選時間仍在騎乘，尚未還車</div>';
    const reborrowLine=record.reborrowed
      ? `<div>${minuteLabel(record.reborrowMinute)}　由同站再次借出</div>${record.reborrowReturned?`<div>→ ${minuteLabel(record.reborrowReturnMinute)}　${safe(record.reborrowDestination.name)} (${safe(record.reborrowDestination.code)})</div>`:'<div class="riding-status">再次借出後仍在騎乘</div>'}`
      : "";
    return `<div class="popup-title">車號 ${safe(record.vehicle)}</div><div class="popup-meta">${safe(day)}｜${safe(record.bikeType)}</div><div>${minuteLabel(record.borrowMinute)}　${safe(record.origin.name)}</div>${seedLine}${reborrowLine}`;
  }

  function trackingRowHtml(record,index){
    const destination=record.returned
      ? `${safe(record.destination.name)}<small> (${safe(record.destination.code)})</small>`
      : `<span class="riding-status">${record.reborrowed?"再次借出後騎乘中":"騎乘中"}</span>`;
    const endMinute=record.reborrowReturned?record.reborrowReturnMinute:(record.seedReturned?record.returnMinute:null);
    return `<tr data-index="${index}"><td><span class="vehicle-id">${safe(record.vehicle)}</span><span class="vehicle-meta">${safe(record.day)}｜${safe(record.bikeType)}<br>${minuteLabel(record.borrowMinute)}${Number.isFinite(endMinute)?`–${minuteLabel(endMinute)}`:" 起"}${record.reborrowed?"｜再次借出":""}</span></td><td class="route-name">${safe(record.origin.name)}<br><small>→ ${destination}</small></td></tr>`;
  }

  function trackingMarker(station,kind,size,popup){
    if(!station||!Number.isFinite(station.lat)||!Number.isFinite(station.lng))return null;
    const pixels=Math.max(14,Math.round(size));
    const marker=L.marker([station.lat,station.lng],{
      pane:"trackingPane",
      icon:L.divIcon({
        className:"tracking-marker-icon",
        html:`<span class="tracking-pin ${safe(kind)}" style="--marker-size:${pixels}px"></span>`,
        iconSize:[pixels,pixels],
        iconAnchor:[pixels/2,pixels/2]
      })
    }).addTo(map);
    if(popup)marker.bindPopup(popup);
    state.markers.push(marker);
    return marker;
  }

  function positiveAverage(values){
    const positive=values.map(Number).filter((value) => Number.isFinite(value)&&value>0);
    return {
      average:positive.length?positive.reduce((sum,value) => sum+value,0)/positive.length:0,
      effectiveDays:positive.length
    };
  }

  function addAggregateMarker(station,count,kind,label,vehicles,effectiveDays,totalDays){
    if(!station||!Number.isFinite(station.lat)||!Number.isFinite(station.lng))return null;
    const size=Math.max(14,Math.min(48,12+Math.sqrt(count)*3.2));
    const vehicleList=vehicles.slice(0,12).map(safe).join("、");
    const popup=`<div class="popup-title">${safe(station.name)}</div><div class="popup-meta">${safe(station.code)}｜${safe(label)}</div><div class="popup-value">非零日均 ${fmt.format(count)} 輛</div><div>有效 ${effectiveDays}/${totalDays} 日（0 不列入平均）</div>${vehicleList?`<div>${vehicleList}${vehicles.length>12?"…":""}</div>`:""}`;
    return trackingMarker(station,kind,size,popup);
  }

  function renderTrackingAggregate(records,days){
    const origins=new Map(),destinations=new Map(),reborrowed=new Map(),riding=new Map();
    const collect=(target,station,vehicle,day) => {
      const row=target.get(station.index)||{station,vehicles:new Set(),daily:new Map()};
      row.vehicles.add(vehicle);
      row.daily.set(day,(row.daily.get(day)||0)+1);
      target.set(station.index,row);
    };
    records.forEach((record) => {
      collect(origins,record.origin,record.vehicle,record.day);
      if(record.reborrowed)collect(reborrowed,record.seedDestination,record.vehicle,record.day);
      if(record.returned)collect(destinations,record.destination,record.vehicle,record.day);
      else if(!record.reborrowed)collect(riding,record.origin,record.vehicle,record.day);
    });
    const summaries=[];
    const draw=(target,kind,label) => target.forEach((row) => {
      const metric=positiveAverage(days.map((day) => row.daily.get(day)||0));
      const vehicles=[...row.vehicles];
      const marker=addAggregateMarker(row.station,metric.average,kind,label,vehicles,metric.effectiveDays,days.length);
      summaries.push({...row,kind,label,average:metric.average,effectiveDays:metric.effectiveDays,marker});
    });
    draw(origins,"origin","臺大借出站");
    draw(destinations,"destination","截至時間最後還車點");
    draw(reborrowed,"reborrowed","還車後再次借出");
    draw(riding,"riding","截至時間仍在騎乘");
    return summaries.sort((a,b) => b.average-a.average||a.station.name.localeCompare(b.station.name,"zh-Hant"));
  }

  function renderTrackingRoutes(records){
    records.forEach((record) => {
      let line=null,secondLine=null;
      const hasOrigin=Number.isFinite(record.origin.lat)&&Number.isFinite(record.origin.lng);
      const hasSeedDestination=Number.isFinite(record.seedDestination.lat)&&Number.isFinite(record.seedDestination.lng);
      const hasFinalDestination=record.reborrowReturned&&record.reborrowDestination&&Number.isFinite(record.reborrowDestination.lat)&&Number.isFinite(record.reborrowDestination.lng);
      if(record.seedReturned&&hasOrigin&&hasSeedDestination){
        line=L.polyline([[record.origin.lat,record.origin.lng],[record.seedDestination.lat,record.seedDestination.lng]],{renderer:trackingRenderer,pane:"trackingPane",color:TRACE_COLOR,weight:4,opacity:.76,lineCap:"round"}).addTo(map).bindPopup(trackingPopup(record));
        state.layers.push(line);
      }
      if(record.reborrowReturned&&hasSeedDestination&&hasFinalDestination){
        secondLine=L.polyline([[record.seedDestination.lat,record.seedDestination.lng],[record.reborrowDestination.lat,record.reborrowDestination.lng]],{renderer:trackingRenderer,pane:"trackingPane",color:RIDING_COLOR,weight:4,opacity:.82,dashArray:"9 7",lineCap:"round"}).addTo(map).bindPopup(trackingPopup(record));
        state.layers.push(secondLine);
      }
      let origin=null;
      if(hasOrigin){
        origin=trackingMarker(record.origin,record.seedReturned?"origin":"riding",16,trackingPopup(record));
      }
      if(record.seedReturned&&hasSeedDestination){
        trackingMarker(record.seedDestination,record.reborrowed?"reborrowed":"destination",16,trackingPopup(record));
      }
      if(record.reborrowReturned&&hasFinalDestination){
        trackingMarker(record.reborrowDestination,"destination",16,trackingPopup(record));
      }
      record.line=line;
      record.secondLine=secondLine;
      record.originMarker=origin;
    });
  }

  function trackingPoints(record){
    const points=[];
    if(Number.isFinite(record.origin.lat)&&Number.isFinite(record.origin.lng))points.push([record.origin.lat,record.origin.lng]);
    if(record.seedReturned&&Number.isFinite(record.seedDestination.lat)&&Number.isFinite(record.seedDestination.lng))points.push([record.seedDestination.lat,record.seedDestination.lng]);
    if(record.reborrowReturned&&record.reborrowDestination&&Number.isFinite(record.reborrowDestination.lat)&&Number.isFinite(record.reborrowDestination.lng))points.push([record.reborrowDestination.lat,record.reborrowDestination.lng]);
    return points;
  }

  function fitTracking(records){
    const points=records.flatMap(trackingPoints);
    if(points.length>1)map.fitBounds(L.latLngBounds(points),{padding:[45,45],maxZoom:15});
    else if(points.length===1)map.setView(points[0],15);
    else map.setView([25.0183,121.5395],14);
  }

  function trackingMetric(records,days,predicate=() => true){
    const counts=new Map(days.map((day) => [day,0]));
    records.forEach((record) => {
      if(predicate(record))counts.set(record.day,(counts.get(record.day)||0)+1);
    });
    return positiveAverage(days.map((day) => counts.get(day)||0));
  }

  function trackingAggregateRowHtml(row,index,totalDays){
    return `<tr data-index="${index}"><td><span class="vehicle-id">${safe(row.label)}</span><span class="vehicle-meta">有效 ${row.effectiveDays}/${totalDays} 日</span></td><td class="route-name">${safe(row.station.name)}<br><small>${safe(row.station.code)}</small><b class="tracking-average">非零日均 ${fmt.format(row.average)} 輛</b></td></tr>`;
  }

  async function refreshTracking(){
    if(state.mode!=="tracking")return;
    if(!trackingManifest||!trackingPeriods.length){showTrackingEmpty("目前沒有 2026 年車號追蹤資料");return;}
    const days=selectedTrackingDates();
    const hours=selectedTrackingHours();
    if(!days.length){showTrackingEmpty("請至少選擇一個日期");return;}
    if(!hours.length){showTrackingEmpty("請至少選擇一個時段");return;}
    const token=++state.loadToken;
    startLoading(`載入 ${days.length} 日車號追蹤資料…`);
    try{
      await Promise.all(days.map(ensureTrackingDay));
    }catch(error){
      if(token===state.loadToken)showTrackingEmpty(error.message);
      return;
    }
    if(token!==state.loadToken||state.mode!=="tracking")return;
    const cutoff=cutoffMinute();
    const hourSet=new Set(hours);
    const vehicleQuery=norm($("vehicleSearch").value);
    const stationQuery=norm($("trackingStationSearch").value);
    let records=days.flatMap((day) => trackingRecords(window.NTU_VEHICLE_TRACKING_SHARDS[day],cutoff,hourSet,day)).filter((record) => {
      if(vehicleQuery&&!norm(record.vehicle).includes(vehicleQuery))return false;
      if(stationQuery&&![record.origin,record.seedDestination,record.reborrowDestination].filter(Boolean).some((station) => station.search.includes(stationQuery)))return false;
      return true;
    });
    records.sort((a,b) => b.day.localeCompare(a.day)||b.activityMinute-a.activityMinute||a.vehicle.localeCompare(b.vehicle,"zh-Hant"));
    clearMap();
    let aggregateRows=[];
    if(vehicleQuery)renderTrackingRoutes(records);
    else aggregateRows=renderTrackingAggregate(records,days);
    fitTracking(records);
    renderTrackingSide(records,days,cutoff,Boolean(vehicleQuery),aggregateRows);
    stopLoading();
    if(!records.length)showMapMessage("沒有符合目前條件的臺大出發車輛");
  }

  function renderTrackingSide(records,days,cutoff,isVehicleSearch,aggregateRows){
    const vehicles=trackingMetric(records,days);
    const returned=trackingMetric(records,days,(record) => record.returned);
    const riding=trackingMetric(records,days,(record) => !record.returned);
    const reborrowed=trackingMetric(records,days,(record) => record.reborrowed);
    $("vehicleCount").textContent=fmt.format(vehicles.average);
    $("vehicleKpi").textContent=fmt.format(vehicles.average);
    $("returnedKpi").textContent=fmt.format(returned.average);
    $("ridingKpi").textContent=fmt.format(riding.average);
    const dateText=days.length===1?days[0]:`${days[0]}～${days.at(-1)}（選 ${days.length} 日）`;
    $("trackingStatusText").textContent=`${dateText}｜借出 ${compactHourLabel(selectedTrackingHours())}｜截至 ${minuteLabel(cutoff)}｜再次借出非零日均 ${fmt.format(reborrowed.average)} 輛`;
    $("trackingFirstHeader").textContent=isVehicleSearch?"日期／車號／時間":"狀態／有效日";
    $("trackingSecondHeader").textContent=isVehicleSearch?"臺大出發 → 最後還車":"站點／非零日均";
    $("trackingNote").textContent=isVehicleSearch
      ? "清單保留每個選定日期的實際行程；點選可定位臺大出發站與最後還車點。"
      : "站點數字為所選日期中有數值日期的平均；0 不列入分母。";
    const rows=isVehicleSearch?records:aggregateRows;
    $("trackingRows").innerHTML=(isVehicleSearch
      ? rows.slice(0,250).map(trackingRowHtml)
      : rows.slice(0,250).map((row,index) => trackingAggregateRowHtml(row,index,days.length))
    ).join("")||'<tr><td colspan="2">沒有符合條件的車輛</td></tr>';
    [...$("trackingRows").querySelectorAll("tr[data-index]")].forEach((row) => row.addEventListener("click",() => {
      if(!isVehicleSearch){
        const summary=aggregateRows[Number(row.dataset.index)];
        if(summary?.marker){map.setView([summary.station.lat,summary.station.lng],16);summary.marker.openPopup();}
        return;
      }
      const record=records[Number(row.dataset.index)];
      const points=trackingPoints(record);
      if(points.length>1){map.fitBounds(L.latLngBounds(points),{padding:[80,80],maxZoom:17});(record.secondLine||record.line)?.openPopup();}
      else if(record.originMarker){map.setView([record.origin.lat,record.origin.lng],16);record.originMarker.openPopup();}
    }));
  }

  function showTrackingEmpty(message){
    clearMap();
    stopLoading();
    showMapMessage(message);
    $("trackingRows").innerHTML="";
    $("vehicleCount").textContent="0";
    $("vehicleKpi").textContent="0";
    $("returnedKpi").textContent="0";
    $("ridingKpi").textContent="0";
    $("trackingStatusText").textContent=message;
  }

  function trackingPeriod(){
    return trackingPeriods.find((row) => row.period===$("trackingPeriod").value);
  }

  function updateTrackingDates(preferred){
    const period=trackingPeriod();
    const dates=period?.dates||[];
    const chosen=Array.isArray(preferred)?preferred.filter((day) => dates.includes(day)):dates;
    $("trackingDateOptions").innerHTML=dates.map((day) => `<label><input type="checkbox" name="trackingDate" value="${safe(day)}" ${chosen.includes(day)?"checked":""}><span>${safe(day)}</span></label>`).join("");
    document.querySelectorAll('input[name="trackingDate"]').forEach((node) => node.addEventListener("change",() => {updateTrackingDateSummary();debouncedTrackingRefresh();}));
    updateTrackingDateSummary();
  }

  function initializeTrackingControls(){
    if(!trackingManifest||!trackingPeriods.length){
      $("trackingModeButton").title="目前沒有 2026 年車號追蹤資料";
      return;
    }
    trackingPeriods.forEach((period) => {
      const label=`${period.period}（${period.sample_days}日）`;
      $("trackingPeriod").add(new Option(label,period.period));
    });
    const latest=trackingPeriods.at(-1);
    $("trackingPeriod").value=latest?.period||"";
    updateTrackingDates();
  }

  function setMode(mode){
    if(mode===state.mode&&mode!=="tracking")return;
    state.mode=mode;
    state.loadToken+=1;
    clearMap();
    stopLoading();
    $("mapMessage").classList.add("hidden");
    const tracking=mode==="tracking";
    $("routeModeButton").classList.toggle("active",!tracking);
    $("trackingModeButton").classList.toggle("active",tracking);
    $("routeModeButton").setAttribute("aria-selected",String(!tracking));
    $("trackingModeButton").setAttribute("aria-selected",String(tracking));
    $("routeControls").classList.toggle("hidden",tracking);
    $("trackingControls").classList.toggle("hidden",!tracking);
    $("routeSummaryPanel").classList.toggle("hidden",tracking);
    $("trackingSummaryPanel").classList.toggle("hidden",!tracking);
    $("routeLegend").classList.toggle("hidden",tracking);
    $("trackingLegend").classList.toggle("hidden",!tracking);
    setTimeout(() => map.invalidateSize(),0);
    if(tracking)refreshTracking();
    else refreshRoutes();
  }

  function debounce(fn,delay=180){
    let timer;
    return (...args) => {clearTimeout(timer);timer=setTimeout(() => fn(...args),delay);};
  }

  const debouncedRouteRefresh=debounce(refreshRoutes,100);
  const debouncedTrackingRefresh=debounce(refreshTracking,120);
  document.querySelectorAll('input[name="year"],input[name="month"],#categorySelect').forEach((node) => node.addEventListener("change",refreshRoutes));
  document.querySelectorAll('input[name="timeHour"]').forEach((node) => node.addEventListener("change",() => {updateTimeSummary();debouncedRouteRefresh();}));
  document.querySelectorAll("[data-hour-preset]").forEach((button) => button.addEventListener("click",() => {setHours(PRESETS[button.dataset.hourPreset]||[]);debouncedRouteRefresh();}));
  $("timePicker").addEventListener("toggle",positionTimeMenu);
  $("trackingDatePicker").addEventListener("toggle",positionTrackingMenus);
  $("trackingTimePicker").addEventListener("toggle",positionTrackingMenus);
  window.addEventListener("resize",() => {positionTimeMenu();positionTrackingMenus();});
  $("routeControls").addEventListener("scroll",positionTimeMenu);
  $("trackingControls").addEventListener("scroll",positionTrackingMenus);
  document.addEventListener("click",(event) => {
    ["timePicker","trackingDatePicker","trackingTimePicker"].forEach((id) => {
      const picker=$(id);
      if(picker.open&&!picker.contains(event.target))picker.open=false;
    });
  });
  $("minAverage").addEventListener("input",() => {$("minLabel").textContent=Number($("minAverage").value).toFixed(1);debouncedRouteRefresh();});
  $("stationSearch").addEventListener("input",debounce(refreshRoutes,240));
  $("resetButton").addEventListener("click",() => {
    document.querySelectorAll('input[name="year"]').forEach((node) => node.checked=true);
    document.querySelectorAll('input[name="month"]').forEach((node) => node.checked=node.value==="05");
    setHours(PRESETS.all);
    $("categorySelect").value="all";
    $("stationSearch").value="";
    $("minAverage").value="1";
    $("minLabel").textContent="1.0";
    $("timePicker").open=false;
    map.setView([25.0183,121.5395],14);
    refreshRoutes();
  });

  $("routeModeButton").addEventListener("click",() => setMode("route"));
  $("trackingModeButton").addEventListener("click",() => setMode("tracking"));
  $("trackingPeriod").addEventListener("change",() => {updateTrackingDates();refreshTracking();});
  document.querySelectorAll('input[name="trackingTimeHour"]').forEach((node) => node.addEventListener("change",() => {updateTrackingTimeSummary();debouncedTrackingRefresh();}));
  document.querySelectorAll("[data-tracking-hour-preset]").forEach((button) => button.addEventListener("click",() => {
    setTrackingHours(PRESETS[button.dataset.trackingHourPreset]||[]);
    debouncedTrackingRefresh();
  }));
  document.querySelectorAll("[data-tracking-date-preset]").forEach((button) => button.addEventListener("click",() => {
    const dates=trackingPeriod()?.dates||[];
    setTrackingDates(button.dataset.trackingDatePreset==="all"?dates:[]);
    debouncedTrackingRefresh();
  }));
  $("trackingCutoff").addEventListener("change",refreshTracking);
  $("vehicleSearch").addEventListener("input",debounce(refreshTracking,240));
  $("trackingStationSearch").addEventListener("input",debounce(refreshTracking,240));
  $("trackingResetButton").addEventListener("click",() => {
    if(trackingPeriods.length){
      const latest=trackingPeriods.at(-1);
      $("trackingPeriod").value=latest?.period||"";
      updateTrackingDates();
    }
    setTrackingHours(PRESETS.all);
    $("trackingCutoff").value="23:59";
    $("vehicleSearch").value="";
    $("trackingStationSearch").value="";
    $("trackingDatePicker").open=false;
    $("trackingTimePicker").open=false;
    map.setView([25.0183,121.5395],14);
    refreshTracking();
  });

  updateTimeSummary();
  updateTrackingTimeSummary();
  initializeTrackingControls();
  refreshRoutes();
})();
