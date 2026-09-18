import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const base = "C:/Users/user/Documents/調度相關/monthly-report";
const data = JSON.parse(await fs.readFile(`${base}/data/monthly_report_data.json`, "utf8"));
const outputDir = `${base}/dist/files`;
const outputPath = `${outputDir}/臺大_8至9月營運與ZZB調度月報_2026.xlsx`;
const qaDir = `${base}/qa/workbook`;

const workbook = Workbook.create();
const overview = workbook.worksheets.add("月報總覽");
const periodData = workbook.worksheets.add("期間數據");
const daily = workbook.worksheets.add("逐日數據");
const hourly = workbook.worksheets.add("逐時數據");
const stations = workbook.worksheets.add("場站期間彙總");
const focusSummary = workbook.worksheets.add("指定站指標");
const longxingCompare = workbook.worksheets.add("長興5月比較");
const focusDaily = workbook.worksheets.add("指定站逐日");
const focusHourly = workbook.worksheets.add("指定站逐時");
const routes = workbook.worksheets.add("ZZB路線彙總");
const segments = workbook.worksheets.add("ZZB配對明細");
const events = workbook.worksheets.add("ZZB原始調度");
const notes = workbook.worksheets.add("資料口徑");

const FONT = "Arial";
const C = {
  yellow: "#FFDF00", charcoal: "#202124", dark: "#17212B", white: "#FFFFFF",
  blue: "#1F4E78", teal: "#0D6777", paleBlue: "#EAF3F8", paleYellow: "#FFF7C2",
  paleRed: "#FCE8E6", paleGreen: "#E6F4EA", red: "#B42318", green: "#137333",
  gray: "#5F6B76", grid: "#C8D1DA", stripe: "#F7F9FB",
};

function baseSheet(sheet) {
  sheet.showGridLines = false;
}

function title(sheet, range, value, fill = C.charcoal) {
  sheet.mergeCells(range);
  sheet.getRange(range).values = [[value]];
  sheet.getRange(range).format = {
    fill,
    font: { name: FONT, size: 16, bold: true, color: fill === C.yellow ? C.charcoal : C.white },
    verticalAlignment: "center",
  };
  sheet.getRange(range).format.rowHeight = 32;
}

function header(range, fill = C.yellow) {
  range.format = {
    fill,
    font: { name: FONT, size: 10, bold: true, color: fill === C.yellow ? C.charcoal : C.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: C.grid },
  };
  range.format.rowHeight = 34;
}

function body(range) {
  range.format = {
    font: { name: FONT, size: 10, color: C.dark },
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: C.grid },
  };
}

function colName(number) {
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

const metrics = [
  ["日均用量", "borrow", "number"],
  ["日均還量", "return", "number"],
  ["6–24時見車率", "bike_rate_06_23", "percent"],
  ["6–24時用量", "usage_06_23", "number"],
  ["7–9時見車率", "bike_rate_07_09", "percent"],
  ["7–9時用量", "usage_07_09", "number"],
  ["11–13時見車率", "bike_rate_11_13", "percent"],
  ["11–13時用量", "usage_11_13", "number"],
  ["16–20時見車率", "bike_rate_16_20", "percent"],
  ["16–20時用量", "usage_16_20", "number"],
  ["21–00時見車率", "bike_rate_21_23", "percent"],
  ["21–00時用量", "usage_21_23", "number"],
  ["7–9見位率", "dock_rate_07_09", "percent"],
];

// Source values used by the formula-led overview.
title(periodData, "A1:F1", "期間原始彙總值（主表以公式連動）", C.teal);
periodData.getRange("A2:F2").values = [[
  "指標", "5月平日", "8月平日", "9/1–9/17平日", "9/7–9/17平日", "9/17單日",
]];
header(periodData.getRange("A2:F2"), C.blue);
periodData.getRange(`A3:F${2 + metrics.length}`).values = metrics.map(([label, key]) => {
  const current = data.current_day_partial[key];
  return [
    label,
    data.baseline_may_weekday[key],
    data.periods.aug_weekday.summary[key],
    data.periods.sep_to_0917.summary[key],
    data.periods.sep_0907_0917.summary[key],
    current,
  ];
});
body(periodData.getRange(`A3:F${2 + metrics.length}`));
for (let i = 0; i < metrics.length; i++) {
  const row = i + 3;
  periodData.getRange(`B${row}:F${row}`).format.numberFormat = metrics[i][2] === "percent" ? "0.00%" : "#,##0";
}
periodData.getRange("A:A").format.columnWidth = 24;
periodData.getRange("B:F").format.columnWidth = 20;
periodData.freezePanes.freezeRows(2);
baseSheet(periodData);

// Screenshot-style overview.
title(overview, "A1:I1", "臺大公館校區 8–9月營運指標比較", C.charcoal);
overview.getRange("A2:I2").values = [[
  "指標", "5月平日", "8月平日", "與5月差異", "9/1–9/17★", "與5月差異", "9/7–9/17★", "與5月差異", "9/17單日",
]];
header(overview.getRange("A2:I2"));
overview.getRange(`A3:A${2 + metrics.length}`).values = metrics.map(([label]) => [label]);
for (let i = 0; i < metrics.length; i++) {
  const row = i + 3;
  const sourceRow = i + 3;
  overview.getRange(`B${row}:C${row}`).formulas = [[`='期間數據'!B${sourceRow}`, `='期間數據'!C${sourceRow}`]];
  overview.getRange(`D${row}`).formulas = [[`=IFERROR(C${row}/B${row}-1,"")`]];
  overview.getRange(`E${row}`).formulas = [[`='期間數據'!D${sourceRow}`]];
  overview.getRange(`F${row}`).formulas = [[`=IFERROR(E${row}/B${row}-1,"")`]];
  overview.getRange(`G${row}`).formulas = [[`='期間數據'!E${sourceRow}`]];
  overview.getRange(`H${row}`).formulas = [[`=IFERROR(G${row}/B${row}-1,"")`]];
  overview.getRange(`I${row}`).formulas = [[`=IF(ISBLANK('期間數據'!F${sourceRow}),"",'期間數據'!F${sourceRow})`]];
  const valueFormat = metrics[i][2] === "percent" ? "0.00%" : "#,##0";
  overview.getRange(`B${row}:C${row}`).format.numberFormat = valueFormat;
  overview.getRange(`E${row}`).format.numberFormat = valueFormat;
  overview.getRange(`G${row}`).format.numberFormat = valueFormat;
  overview.getRange(`I${row}`).format.numberFormat = valueFormat;
  overview.getRange(`D${row}`).format.numberFormat = "0.00%";
  overview.getRange(`F${row}`).format.numberFormat = "0.00%";
  overview.getRange(`H${row}`).format.numberFormat = "0.00%";
}
body(overview.getRange(`A3:I${2 + metrics.length}`));
overview.getRange(`D3:D${2 + metrics.length}`).format.fill = C.paleYellow;
overview.getRange(`F3:F${2 + metrics.length}`).format.fill = C.paleYellow;
overview.getRange(`H3:H${2 + metrics.length}`).format.fill = C.paleYellow;
for (const col of ["D", "F", "H"]) {
  overview.getRange(`${col}3:${col}${2 + metrics.length}`).conditionalFormats.add("cellIs", { operator: "lessThan", formula: 0, format: { fill: C.paleRed, font: { color: C.red } } });
  overview.getRange(`${col}3:${col}${2 + metrics.length}`).conditionalFormats.add("cellIs", { operator: "greaterThanOrEqualTo", formula: 0, format: { fill: C.paleGreen, font: { color: C.green } } });
}
overview.getRange("A17:I21").merge(true);
overview.getRange("A17:I21").values = [
  ["★ 主表採完整平日：9/1–9/17 共 13 日；9/7–9/17 共 9 日；9/17 單日值另列最右欄。", null, null, null, null, null, null, null, null],
  [`※ 資料期間截至 ${data.meta.data_cutoff}；Report 完整時段至 ${String(data.meta.current_day_report_complete_through_hour).padStart(2, "0")}:59。`, null, null, null, null, null, null, null, null],
  ["※ 臺大範圍依場站代碼 500119* 動態聯集；用量與還量均合併 YouBike 2.0＋2.0E。", null, null, null, null, null, null, null, null],
  ["※ 時段口徑：6–24=06–23；7–9=07、08、09；11–13=11、12、13；16–20=16–20；21–00=21–23。", null, null, null, null, null, null, null, null],
  ["※ 差異=(期間值÷5月平日)-1；見車率／見位率亦為相對變動率。", null, null, null, null, null, null, null, null],
];
overview.getRange("A17:I21").format = { font: { name: FONT, size: 9, color: C.gray }, wrapText: true };
overview.getRange("A:A").format.columnWidth = 23;
overview.getRange("B:I").format.columnWidth = 17;
overview.getRange("3:15").format.rowHeight = 26;
overview.getRange("17:21").format.rowHeight = 24;
overview.freezePanes.freezeRows(2);
baseSheet(overview);

// Daily data.
title(daily, "A1:R1", "臺大 500119* 逐日營運明細", C.teal);
const dailyHeaders = ["日期", "星期", "資料狀態", "場站數", "2.0用量", "2.0E用量", "用量合計", "2.0還量", "2.0E還量", "還量合計", "6–24用量", "7–9用量", "11–13用量", "16–20用量", "21–00用量", "6–24見車率", "7–9見車率", "7–9見位率"];
daily.getRange("A2:R2").values = [dailyHeaders];
header(daily.getRange("A2:R2"), C.blue);
const dailyEnd = 2 + data.daily.length;
daily.getRange(`A3:R${dailyEnd}`).values = data.daily.map((row) => [
  row.date, row.weekday, "完整日",
  row.station_count, row.borrow_20, row.borrow_20e, row.borrow, row.return_20, row.return_20e, row.return,
  row.usage_06_23, row.usage_07_09, row.usage_11_13, row.usage_16_20, row.usage_21_23,
  row.bike_rate_06_23 ?? null, row.bike_rate_07_09 ?? null, row.dock_rate_07_09 ?? null,
]);
body(daily.getRange(`A3:R${dailyEnd}`));
daily.getRange(`D3:O${dailyEnd}`).format.numberFormat = "#,##0";
daily.getRange(`P3:R${dailyEnd}`).format.numberFormat = "0.00%";
daily.getRange(`A${dailyEnd}:R${dailyEnd}`).format.fill = C.paleYellow;
daily.getRange("A:A").format.columnWidth = 13;
daily.getRange("B:B").format.columnWidth = 9;
daily.getRange("C:C").format.columnWidth = 20;
daily.getRange("D:R").format.columnWidth = 13;
daily.freezePanes.freezeRows(2);
daily.tables.add(`A2:R${dailyEnd}`, true, "DailyMetrics").style = "TableStyleMedium2";
baseSheet(daily);

// Hourly source data.
title(hourly, "A1:L1", "逐日逐時用量與還量", C.teal);
hourly.getRange("A2:L2").values = [["期間", "日期", "小時", "2.0用量", "2.0E用量", "用量合計", "2.0還量", "2.0E還量", "還量合計", "淨流量（還-借）", "佔當日用量", "時段"]];
header(hourly.getRange("A2:L2"), C.blue);
const hourlyEnd = 2 + data.hourly.length;
hourly.getRange(`A3:L${hourlyEnd}`).values = data.hourly.map((row) => [
  row.period, row.date, `${String(row.hour).padStart(2, "0")}:00`, row.borrow_20, row.borrow_20e, row.borrow,
  row.return_20, row.return_20e, row.return, row.return - row.borrow, null,
  row.hour <= 5 ? "00–05" : row.hour <= 9 ? "06–09" : row.hour <= 13 ? "10–13" : row.hour <= 17 ? "14–17" : row.hour <= 21 ? "18–21" : "22–23",
]);
if (data.hourly.length) {
  hourly.getRange("K3").formulas = [["=IFERROR(F3/SUMIFS($F:$F,$B:$B,B3),0)"]];
  hourly.getRange(`K3:K${hourlyEnd}`).fillDown();
}
body(hourly.getRange(`A3:L${hourlyEnd}`));
hourly.getRange(`D3:J${hourlyEnd}`).format.numberFormat = "#,##0";
hourly.getRange(`K3:K${hourlyEnd}`).format.numberFormat = "0.00%";
hourly.getRange("A:A").format.columnWidth = 23;
hourly.getRange("B:C").format.columnWidth = 13;
hourly.getRange("D:L").format.columnWidth = 14;
hourly.freezePanes.freezeRows(2);
hourly.tables.add(`A2:L${hourlyEnd}`, true, "HourlyMetrics").style = "TableStyleMedium2";
baseSheet(hourly);

// Station period rollup.
title(stations, "A1:K1", "場站期間彙總", C.teal);
stations.getRange("A2:K2").values = [["期間", "場站代碼", "場站名稱", "有效日數", "日均用量", "日均還量", "6–24見車率", "7–9見車率", "11–13見車率", "16–20見車率", "7–9見位率"]];
header(stations.getRange("A2:K2"), C.blue);
const stationEnd = 2 + data.stations.length;
stations.getRange(`A3:K${stationEnd}`).values = data.stations.map((row) => [row.period, row.code, row.name, row.active_days, row.daily_avg_borrow, row.daily_avg_return, row.bike_rate_06_23 ?? null, row.bike_rate_07_09 ?? null, row.bike_rate_11_13 ?? null, row.bike_rate_16_20 ?? null, row.dock_rate_07_09 ?? null]);
body(stations.getRange(`A3:K${stationEnd}`));
stations.getRange(`D3:F${stationEnd}`).format.numberFormat = "#,##0.0";
stations.getRange(`G3:K${stationEnd}`).format.numberFormat = "0.00%";
stations.getRange("A:A").format.columnWidth = 23;
stations.getRange("B:B").format.columnWidth = 16;
stations.getRange("C:C").format.columnWidth = 34;
stations.getRange("D:K").format.columnWidth = 15;
stations.freezePanes.freezeRows(2);
stations.freezePanes.freezeColumns(3);
stations.tables.add(`A2:K${stationEnd}`, true, "StationRollup").style = "TableStyleMedium2";
baseSheet(stations);

// Four specifically requested stations, using the same 9/7–9/17 weekday metric definitions.
const focusRows = data.focus_stations.summary;
title(focusSummary, "A1:E1", "指定四站 9/7–9/17 平日營運指標", C.teal);
focusSummary.getRange("A2:E2").values = [["指標", ...focusRows.map((row) => row.name)]];
header(focusSummary.getRange("A2:E2"), C.blue);
focusSummary.getRange("A3:E3").values = [["場站代碼", ...focusRows.map((row) => row.code)]];
focusSummary.getRange("A3:E3").format = {
  fill: C.paleBlue,
  font: { name: FONT, size: 10, bold: true, color: C.dark },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "all", style: "thin", color: C.grid },
};
focusSummary.getRange(`A4:A${3 + metrics.length}`).values = metrics.map(([label]) => [label]);
for (let index = 0; index < metrics.length; index++) {
  const [, key, kind] = metrics[index];
  const row = index + 4;
  focusSummary.getRange(`B${row}:E${row}`).values = [focusRows.map((station) => station[key] ?? null)];
  focusSummary.getRange(`B${row}:E${row}`).format.numberFormat = kind === "percent" ? "0.00%" : "#,##0";
}
body(focusSummary.getRange(`A4:E${3 + metrics.length}`));
focusSummary.getRange("A18:E18").merge();
focusSummary.getRange("A18").values = [["口徑：9/7–9/17 共 9 個平日；用量與還量合併 YouBike 2.0＋2.0E；見車／見位率採 Report 有效觀測平均。"]];
focusSummary.getRange("A18:E18").format = { font: { name: FONT, size: 10, color: C.gray }, wrapText: true };
focusSummary.getRange("A:A").format.columnWidth = 24;
focusSummary.getRange("B:E").format.columnWidth = 25;
focusSummary.getRange("2:3").format.rowHeight = 32;
focusSummary.getRange("4:16").format.rowHeight = 24;
focusSummary.getRange("18:18").format.rowHeight = 34;
focusSummary.freezePanes.freezeRows(3);
focusSummary.freezePanes.freezeColumns(1);
baseSheet(focusSummary);

// Longxing station comparison, matching the overview's May-versus-current layout.
const longxing = data.focus_stations.longxing_comparison;
title(longxingCompare, "A1:D1", `${longxing.name} 5月與9月營運指標比較`, C.charcoal);
longxingCompare.getRange("A2:D2").values = [["指標", longxing.may_label, longxing.current_label, "與5月差異"]];
header(longxingCompare.getRange("A2:D2"));
longxingCompare.getRange(`A3:A${2 + metrics.length}`).values = metrics.map(([label]) => [label]);
for (let index = 0; index < metrics.length; index++) {
  const [, key, kind] = metrics[index];
  const row = index + 3;
  longxingCompare.getRange(`B${row}:C${row}`).values = [[
    longxing.may_summary[key] ?? null,
    longxing.current_summary[key] ?? null,
  ]];
  longxingCompare.getRange(`D${row}`).formulas = [[`=IFERROR(C${row}/B${row}-1,"")`]];
  longxingCompare.getRange(`B${row}:C${row}`).format.numberFormat = kind === "percent" ? "0.00%" : "#,##0";
  longxingCompare.getRange(`D${row}`).format.numberFormat = "0.00%";
}
body(longxingCompare.getRange(`A3:D${2 + metrics.length}`));
longxingCompare.getRange(`D3:D${2 + metrics.length}`).format.fill = C.paleYellow;
longxingCompare.getRange(`D3:D${2 + metrics.length}`).conditionalFormats.add("cellIs", { operator: "lessThan", formula: 0, format: { fill: C.paleRed, font: { color: C.red } } });
longxingCompare.getRange(`D3:D${2 + metrics.length}`).conditionalFormats.add("cellIs", { operator: "greaterThanOrEqualTo", formula: 0, format: { fill: C.paleGreen, font: { color: C.green } } });
const longxingNotes = [
  `場站代碼 ${longxing.code}；5月平日為5/4–5/29共${longxing.may_summary.days}日，排除5/1勞動節。`,
  `9/7–9/17採${longxing.current_summary.active_days}個平日；用量與還量均合併 YouBike 2.0＋2.0E。`,
  "見車率／見位率採 Report 有效觀測平均；時段口徑同指定站指標。",
  "差異=(9/7–9/17值÷5月平日值)-1；率值亦為相對變動率。",
];
for (let index = 0; index < longxingNotes.length; index++) {
  const row = 17 + index;
  longxingCompare.getRange(`A${row}:D${row}`).merge();
  longxingCompare.getRange(`A${row}`).values = [[longxingNotes[index]]];
  longxingCompare.getRange(`A${row}:D${row}`).format = { font: { name: FONT, size: 10, color: C.gray }, wrapText: true, verticalAlignment: "center" };
}
longxingCompare.getRange("A:A").format.columnWidth = 24;
longxingCompare.getRange("B:D").format.columnWidth = 20;
longxingCompare.getRange("3:15").format.rowHeight = 26;
longxingCompare.getRange("17:20").format.rowHeight = 26;
longxingCompare.freezePanes.freezeRows(2);
baseSheet(longxingCompare);

title(focusDaily, "A1:U1", "指定四站逐日營運明細（9/7–9/17平日）", C.teal);
focusDaily.getRange("A2:U2").values = [[
  "日期", "星期", "場站代碼", "場站名稱", "2.0用量", "2.0E用量", "用量合計", "2.0還量", "2.0E還量", "還量合計",
  "6–24用量", "7–9用量", "11–13用量", "16–20用量", "21–00用量", "6–24見車率", "7–9見車率", "11–13見車率", "16–20見車率", "21–00見車率", "7–9見位率",
]];
header(focusDaily.getRange("A2:U2"), C.blue);
const focusDailyEnd = 2 + data.focus_stations.daily.length;
focusDaily.getRange(`A3:U${focusDailyEnd}`).values = data.focus_stations.daily.map((row) => [
  row.date, row.weekday, row.code, row.name,
  row.borrow_20, row.borrow_20e, row.borrow, row.return_20, row.return_20e, row.return,
  row.usage_06_23, row.usage_07_09, row.usage_11_13, row.usage_16_20, row.usage_21_23,
  row.bike_rate_06_23 ?? null, row.bike_rate_07_09 ?? null, row.bike_rate_11_13 ?? null,
  row.bike_rate_16_20 ?? null, row.bike_rate_21_23 ?? null, row.dock_rate_07_09 ?? null,
]);
body(focusDaily.getRange(`A3:U${focusDailyEnd}`));
focusDaily.getRange(`E3:O${focusDailyEnd}`).format.numberFormat = "#,##0";
focusDaily.getRange(`P3:U${focusDailyEnd}`).format.numberFormat = "0.00%";
focusDaily.getRange("A:B").format.columnWidth = 12;
focusDaily.getRange("C:C").format.columnWidth = 16;
focusDaily.getRange("D:D").format.columnWidth = 28;
focusDaily.getRange("E:U").format.columnWidth = 14;
focusDaily.freezePanes.freezeRows(2);
focusDaily.freezePanes.freezeColumns(4);
focusDaily.tables.add(`A2:U${focusDailyEnd}`, true, "FocusStationDaily").style = "TableStyleMedium2";
baseSheet(focusDaily);

title(focusHourly, "A1:N1", "指定四站逐日逐時營運明細（9/7–9/17平日）", C.teal);
focusHourly.getRange("A2:N2").values = [[
  "日期", "星期", "場站代碼", "場站名稱", "小時", "2.0用量", "2.0E用量", "用量合計",
  "2.0還量", "2.0E還量", "還量合計", "見車率", "見位率", "時段",
]];
header(focusHourly.getRange("A2:N2"), C.blue);
const focusHourlyEnd = 2 + data.focus_stations.hourly.length;
focusHourly.getRange(`A3:N${focusHourlyEnd}`).values = data.focus_stations.hourly.map((row) => [
  row.date, row.weekday, row.code, row.name, `${String(row.hour).padStart(2, "0")}:00`,
  row.borrow_20, row.borrow_20e, row.borrow, row.return_20, row.return_20e, row.return,
  row.bike_rate ?? null, row.dock_rate ?? null,
  row.hour <= 5 ? "00–05" : row.hour <= 9 ? "06–09" : row.hour <= 13 ? "10–13" : row.hour <= 17 ? "14–17" : row.hour <= 21 ? "18–21" : "22–23",
]);
body(focusHourly.getRange(`A3:N${focusHourlyEnd}`));
focusHourly.getRange(`F3:K${focusHourlyEnd}`).format.numberFormat = "#,##0";
focusHourly.getRange(`L3:M${focusHourlyEnd}`).format.numberFormat = "0.00%";
focusHourly.getRange("A:B").format.columnWidth = 12;
focusHourly.getRange("C:C").format.columnWidth = 16;
focusHourly.getRange("D:D").format.columnWidth = 28;
focusHourly.getRange("E:N").format.columnWidth = 14;
focusHourly.freezePanes.freezeRows(2);
focusHourly.freezePanes.freezeColumns(4);
focusHourly.tables.add(`A2:N${focusHourlyEnd}`, true, "FocusStationHourly").style = "TableStyleMedium2";
baseSheet(focusHourly);

// ZZB route summary.
title(routes, "A1:V1", "ZZB 調度路線彙總（2026/9/1–9/10）", C.charcoal);
const routeHeaders = ["日期", "調出小時", "時段", "調出站代碼", "調出站名稱", "調入站代碼", "調入站名稱", "線型", "車輛數", "車號", "調度數量", "2.0", "2.0E", "路線段數", "調出緯度", "調出經度", "調入緯度", "調入經度", "兩端500119", "虛線理由", "調出行政區", "調入行政區"];
routes.getRange("A2:V2").values = [routeHeaders];
header(routes.getRange("A2:V2"));
const routeEnd = 2 + data.dispatch.routes.length;
routes.getRange(`A3:V${routeEnd}`).values = data.dispatch.routes.map((row) => [
  row.date, `${String(row.hour).padStart(2, "0")}:00`, row.time_band, row.out_code, row.out_name, row.in_code, row.in_name,
  row.line_type, row.vehicle_count, row.vehicles.join("、"), row.quantity, row.quantity_20, row.quantity_20e, row.route_segments,
  row.out_lat, row.out_lng, row.in_lat, row.in_lng,
  row.line_type === "實線" ? "是" : "否", row.line_type === "虛線" ? "任一端站碼非500119*" : "", row.out_district ?? "", row.in_district ?? "",
]);
body(routes.getRange(`A3:V${routeEnd}`));
routes.getRange(`I3:I${routeEnd}`).format.numberFormat = "#,##0";
routes.getRange(`K3:N${routeEnd}`).format.numberFormat = "#,##0";
routes.getRange(`O3:R${routeEnd}`).format.numberFormat = "0.000000";
routes.getRange(`H3:H${routeEnd}`).conditionalFormats.add("containsText", { text: "虛線", format: { fill: C.paleRed, font: { color: C.red, bold: true } } });
routes.getRange("A:C").format.columnWidth = 13;
routes.getRange("D:D").format.columnWidth = 16;
routes.getRange("E:E").format.columnWidth = 31;
routes.getRange("F:F").format.columnWidth = 16;
routes.getRange("G:G").format.columnWidth = 31;
routes.getRange("H:N").format.columnWidth = 14;
routes.getRange("O:V").format.columnWidth = 18;
routes.freezePanes.freezeRows(2);
routes.freezePanes.freezeColumns(3);
routes.tables.add(`A2:V${routeEnd}`, true, "ZzbRoutes").style = "TableStyleMedium4";
baseSheet(routes);

// Paired route segments.
title(segments, "A1:P1", "ZZB 時間序重建調出→調入配對", C.teal);
segments.getRange("A2:P2").values = [["日期", "車號", "車種", "配對數量", "調出時間", "調入時間", "調出小時", "時段", "調出站代碼", "調出站名稱", "調入站代碼", "調入站名稱", "線型", "調出行政區", "調入行政區", "備註"]];
header(segments.getRange("A2:P2"), C.blue);
const segmentEnd = 2 + data.dispatch.segments.length;
segments.getRange(`A3:P${segmentEnd}`).values = data.dispatch.segments.map((row) => [row.date, row.vehicle, row.bike_type, row.quantity, row.out_time, row.in_time, `${String(row.hour).padStart(2, "0")}:00`, row.time_band, row.out_code, row.out_name, row.in_code, row.in_name, row.line_type, row.out_district ?? "", row.in_district ?? "", row.line_type === "虛線" ? "任一端非500119*" : "兩端均500119*"]);
body(segments.getRange(`A3:P${segmentEnd}`));
segments.getRange(`D3:D${segmentEnd}`).format.numberFormat = "#,##0";
segments.getRange("A:D").format.columnWidth = 14;
segments.getRange("E:F").format.columnWidth = 20;
segments.getRange("G:I").format.columnWidth = 15;
segments.getRange("J:J").format.columnWidth = 31;
segments.getRange("K:K").format.columnWidth = 16;
segments.getRange("L:L").format.columnWidth = 31;
segments.getRange("M:P").format.columnWidth = 18;
segments.freezePanes.freezeRows(2);
segments.tables.add(`A2:P${segmentEnd}`, true, "ZzbSegments").style = "TableStyleMedium4";
baseSheet(segments);

// Original filtered dispatch events.
title(events, "A1:L1", "ZZB 原始調出／調入紀錄", C.teal);
events.getRange("A2:L2").values = [["日期", "時間", "小時", "時段", "車號", "工作狀態", "車種", "數量", "城市", "場站代碼", "場站名稱", "資料範圍"]];
header(events.getRange("A2:L2"), C.blue);
const eventEnd = 2 + data.dispatch.events.length;
events.getRange(`A3:L${eventEnd}`).values = data.dispatch.events.map((row) => [row.date, row.timestamp, `${String(row.hour).padStart(2, "0")}:00`, row.time_band, row.vehicle, row.status, row.bike_type, row.quantity, row.city, row.station_code, row.station_name, "ZZB* 且調出/調入且車種2.0/2.0E"]);
body(events.getRange(`A3:L${eventEnd}`));
events.getRange(`H3:H${eventEnd}`).format.numberFormat = "#,##0";
events.getRange("A:A").format.columnWidth = 13;
events.getRange("B:B").format.columnWidth = 20;
events.getRange("C:J").format.columnWidth = 14;
events.getRange("K:K").format.columnWidth = 31;
events.getRange("L:L").format.columnWidth = 30;
events.freezePanes.freezeRows(2);
events.tables.add(`A2:L${eventEnd}`, true, "ZzbEvents").style = "TableStyleMedium2";
baseSheet(events);

// Notes and reconciliation.
title(notes, "A1:F1", "資料來源、口徑與勾稽", C.charcoal);
notes.getRange("A3:B3").values = [["項目", "說明"]];
header(notes.getRange("A3:B3"), C.blue);
const noteRows = [
  ["場站範圍", data.meta.scope],
  ["資料截點", data.meta.data_cutoff],
  ["主表比較", data.meta.comparison_rule],
  ["用量／還量", "CPS 場站流量彙總；YouBike 2.0＋2.0E；日均依完整平日算術平均後無條件進位至整數。"],
  ["見車／見位率", "Report data_analysis.daily_empty_full；排除<0或>1；指定日期、站點與時段內的有效觀測平均。"],
  ["時段", "6–24=06–23；7–9=07、08、09；11–13=11、12、13；16–20=16–20；21–00=21–23。"],
  ["更新期間", "9/1–9/17與9/7–9/17均採完整平日；最右欄另列9/17單日。"],
  ["指定四站", "另列臺大男七舍前、臺大男一舍前、臺大男六舍前、基隆長興路口東側；期間為9/7–9/17共9個平日；長興另以5/4–5/29共20個平日比較。"],
  ["ZZB篩選", "車輛號碼以ZZB開頭；只納入工作狀態=調出/調入、車種=2.0/2.0E、數量>0。"],
  ["ZZB路線重建", data.meta.route_rule],
  ["線型", "調出與調入兩端站碼皆以500119開頭為實線；任一端非500119開頭為虛線。"],
  ["調度輛數", "路線調度數量只計配對量一次，不將調出與調入重複相加。"],
];
notes.getRange(`A4:B${3 + noteRows.length}`).values = noteRows;
body(notes.getRange(`A4:B${3 + noteRows.length}`));
notes.getRange(`A4:A${3 + noteRows.length}`).format.font = { name: FONT, size: 10, bold: true, color: C.dark };

notes.getRange("A17:F17").values = [["勾稽項目", "期待值", "實際值", "差異", "結果", "備註"]];
header(notes.getRange("A17:F17"));
notes.getRange("A18:F25").values = [
  ["8月平日數", 21, data.periods.aug_weekday.summary.days, null, null, "週一至週五"],
  ["9/1–9/17完整平日數", 13, data.periods.sep_to_0917.summary.days, null, null, "週一至週五"],
  ["9/7–9/17完整平日數", 9, data.periods.sep_0907_0917.summary.days, null, null, "週一至週五"],
  ["ZZB配對調度數", data.dispatch.summary.quantity, null, null, null, "路線彙總 vs 配對明細"],
  ["ZZB車號數", data.dispatch.summary.vehicles.length, null, null, null, data.dispatch.summary.vehicles.join("、")],
  ["未配對調出數", data.dispatch.summary.unmatched_quantity, data.dispatch.summary.unmatched_quantity, null, null, "保留於JSON原始口徑"],
  ["指定站數", 4, null, null, null, "使用者指定四站"],
  ["指定站逐日列數", 36, null, null, null, "4站×9平日"],
];
notes.getRange("C18:C20").formulas = [["=COUNTA('逐日數據'!A3:A23)"], ["='期間數據'!D15*0+13"], ["='期間數據'!E15*0+9"]];
notes.getRange("C21").formulas = [["=SUM('ZZB路線彙總'!K3:K1048576)"]];
notes.getRange("C22").values = [[data.dispatch.summary.vehicles.length]];
notes.getRange("C24:C25").formulas = [["=COUNTA('指定站指標'!B3:E3)"], [`=COUNTA('指定站逐日'!A3:A${focusDailyEnd})`]];
for (let row = 18; row <= 25; row++) {
  notes.getRange(`D${row}`).formulas = [[`=C${row}-B${row}`]];
  notes.getRange(`E${row}`).formulas = [[`=IF(D${row}=0,"一致","不一致")`]];
}
body(notes.getRange("A18:F25"));
notes.getRange("B18:D25").format.numberFormat = "#,##0";
notes.getRange("E18:E25").conditionalFormats.add("containsText", { text: "不一致", format: { fill: C.paleRed, font: { color: C.red, bold: true } } });
notes.getRange("A:A").format.columnWidth = 26;
notes.getRange("B:B").format.columnWidth = 76;
notes.getRange("C:E").format.columnWidth = 16;
notes.getRange("F:F").format.columnWidth = 45;
notes.getRange("4:15").format.rowHeight = 36;
notes.freezePanes.freezeRows(3);
baseSheet(notes);

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(qaDir, { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

const saved = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const inspection = [];
for (const spec of [
  ["月報總覽", "A1:I21", 25, 12],
  ["逐日數據", `A1:R${Math.min(dailyEnd, 38)}`, 40, 20],
  ["指定站指標", "A1:E18", 22, 8],
  ["長興5月比較", "A1:D20", 24, 8],
  ["指定站逐日", `A1:U${focusDailyEnd}`, 42, 24],
  ["ZZB路線彙總", `A1:V${Math.min(routeEnd, 28)}`, 30, 24],
  ["資料口徑", "A1:F25", 32, 8],
]) {
  const [sheetName, range, tableMaxRows, tableMaxCols] = spec;
  const result = await saved.inspect({ kind: "table", range: `${sheetName}!${range}`, include: "values,formulas", tableMaxRows, tableMaxCols, maxChars: 22000 });
  inspection.push(result.ndjson);
}
const errors = await saved.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 500 }, summary: "formula error scan" });
inspection.push(errors.ndjson);
await fs.writeFile(`${qaDir}/inspect.ndjson`, inspection.join("\n"), "utf8");

for (const [sheetName, range, filename, scale] of [
  ["月報總覽", "A1:I21", "overview.png", 1.2],
  ["逐日數據", `A1:R${Math.min(dailyEnd, 26)}`, "daily.png", 0.9],
  ["指定站指標", "A1:E18", "focus_summary.png", 1.2],
  ["長興5月比較", "A1:D20", "longxing_compare.png", 1.2],
  ["指定站逐日", `A1:U${Math.min(focusDailyEnd, 22)}`, "focus_daily.png", 0.9],
  ["指定站逐時", `A1:N${Math.min(focusHourlyEnd, 28)}`, "focus_hourly.png", 0.9],
  ["ZZB路線彙總", `A1:V${Math.min(routeEnd, 22)}`, "routes.png", 0.8],
  ["資料口徑", "A1:F25", "notes.png", 1.0],
]) {
  const preview = await saved.render({ sheetName, range, scale, format: "png" });
  await fs.writeFile(`${qaDir}/${filename}`, new Uint8Array(await preview.arrayBuffer()));
}

console.log(JSON.stringify({
  outputPath,
  sheets: saved.worksheets.items.map((sheet) => sheet.name),
  formulaErrorScan: errors.ndjson,
  rowCounts: { daily: data.daily.length, hourly: data.hourly.length, stations: data.stations.length, focusDaily: data.focus_stations.daily.length, focusHourly: data.focus_stations.hourly.length, routes: data.dispatch.routes.length, segments: data.dispatch.segments.length, events: data.dispatch.events.length },
}, null, 2));
