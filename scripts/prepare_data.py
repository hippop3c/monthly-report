from __future__ import annotations

import json
import math
from collections import defaultdict, deque
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from statistics import mean

from openpyxl import load_workbook


ROOT = Path(r"C:\Users\user\Documents\調度相關")
BASE = ROOT / "monthly-report"
RAW = BASE / "data" / "raw"
OUT = BASE / "data" / "monthly_report_data.json"
NTU_PREFIX = "500119"
CURRENT_END = date(2026, 9, 10)

FLOW_AUG = ROOT / "outputs" / "01a057bd-84e6-7bd3-995f-1d34ab3e518e" / "hourly_metrics_data" / "raw_cps"
RATE_AUG = ROOT / "github-release" / "youbike-shuangbei-hourly-metrics-2026" / "public" / "data" / "station_chunks" / "taipei" / "2026-08-weekday.json"
COORD_JS = ROOT / "youbike-hourly-heatmap" / "data" / "heatmap-2026-09.js"

BANDS = {
    "06_23": list(range(6, 24)),
    "07_09": [7, 8, 9],
    "11_13": [11, 12, 13],
    "16_20": [16, 17, 18, 19, 20],
    "21_23": [21, 22, 23],
}

BASELINE_MAY = {
    "borrow": 15681,
    "return": 15384,
    "bike_rate_06_23": 0.866,
    "usage_06_23": 15459,
    "bike_rate_07_09": 0.915,
    "usage_07_09": 1013,
    "bike_rate_11_13": 0.9,
    "usage_11_13": 2656,
    "bike_rate_16_20": 0.845,
    "usage_16_20": 4948,
    "bike_rate_21_23": 0.677916528,
    "usage_21_23": 869,
    "dock_rate_07_09": 0.965,
}


def iso_date(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value or "")
    if "," in text and "GMT" in text:
        return parsedate_to_datetime(text).date().isoformat()
    return text[:10]


def split_pair(value) -> tuple[int, int]:
    if value in (None, ""):
        return 0, 0
    text = str(value).strip()
    if "/" not in text:
        return int(float(text or 0)), 0
    left, right = text.split("/", 1)
    return int(float(left.strip() or 0)), int(float(right.strip() or 0))


def clean_rate(value):
    if value in (None, ""):
        return None
    value = float(value)
    return value if 0 <= value <= 1 else None


def load_flow(path: Path, vehicle: str, target: dict) -> None:
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    headers = [str(value or "") for value in next(rows)]
    pos = {name: index for index, name in enumerate(headers)}
    required = ["場站代號", "場站名稱", "時間", *[f"{hour:02d}" for hour in range(24)]]
    missing = [name for name in required if name not in pos]
    if missing:
        raise RuntimeError(f"{path.name}: missing CPS columns {missing}")
    for raw in rows:
        code = str(raw[pos["場站代號"]] or "").strip()
        if not code.startswith(NTU_PREFIX):
            continue
        day = iso_date(raw[pos["時間"]])
        slot = target.setdefault(day, {}).setdefault(code, {
            "code": code,
            "name": str(raw[pos["場站名稱"]] or "").strip(),
            "borrow": [0] * 24,
            "return": [0] * 24,
            "borrow_20": [0] * 24,
            "borrow_20e": [0] * 24,
            "return_20": [0] * 24,
            "return_20e": [0] * 24,
        })
        for hour in range(24):
            borrow, returned = split_pair(raw[pos[f"{hour:02d}"]])
            slot["borrow"][hour] += borrow
            slot["return"][hour] += returned
            slot[f"borrow_{'20e' if vehicle == '2.0E' else '20'}"][hour] += borrow
            slot[f"return_{'20e' if vehicle == '2.0E' else '20'}"][hour] += returned
    workbook.close()


def load_aug_rates() -> list[dict]:
    payload = json.loads(RATE_AUG.read_text(encoding="utf-8"))
    columns = payload["columns"]
    rows = []
    for raw in payload["rows"]:
        item = dict(zip(columns, raw))
        if str(item["stationId"]).startswith(NTU_PREFIX):
            rows.append(item)
    return rows


def load_report_rates(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for raw in payload:
        code = str(raw.get("s_no") or "").strip()
        if not code.startswith(NTU_PREFIX):
            continue
        status = str(raw.get("status") or "").strip()
        if status not in {"見車率", "見位率"}:
            continue
        rows.append({
            "date": iso_date(raw.get("date")),
            "code": code,
            "name": str(raw.get("s_name") or "").strip(),
            "status": status,
            "hourly": [clean_rate(raw.get(f"r{hour}")) for hour in range(24)],
        })
    return rows


def weekday(day: str) -> bool:
    return date.fromisoformat(day).weekday() < 5


def aggregate_flow(flow: dict, dates: list[str]) -> tuple[dict, list[dict], list[dict]]:
    daily_rows = []
    hourly_rows = []
    for day in dates:
        stations = flow.get(day, {})
        by_hour = []
        for hour in range(24):
            row = {
                "date": day,
                "hour": hour,
                "borrow_20": sum(s["borrow_20"][hour] for s in stations.values()),
                "borrow_20e": sum(s["borrow_20e"][hour] for s in stations.values()),
                "return_20": sum(s["return_20"][hour] for s in stations.values()),
                "return_20e": sum(s["return_20e"][hour] for s in stations.values()),
            }
            row["borrow"] = row["borrow_20"] + row["borrow_20e"]
            row["return"] = row["return_20"] + row["return_20e"]
            by_hour.append(row)
            hourly_rows.append(row)
        daily = {
            "date": day,
            "weekday": "一二三四五六日"[date.fromisoformat(day).weekday()],
            "station_count": len(stations),
            "borrow_20": sum(row["borrow_20"] for row in by_hour),
            "borrow_20e": sum(row["borrow_20e"] for row in by_hour),
            "return_20": sum(row["return_20"] for row in by_hour),
            "return_20e": sum(row["return_20e"] for row in by_hour),
        }
        daily["borrow"] = daily["borrow_20"] + daily["borrow_20e"]
        daily["return"] = daily["return_20"] + daily["return_20e"]
        for key, hours in BANDS.items():
            daily[f"usage_{key}"] = sum(by_hour[hour]["borrow"] for hour in hours)
        daily_rows.append(daily)
    summary = {}
    for key in ["borrow", "return", *[f"usage_{key}" for key in BANDS]]:
        summary[key] = math.ceil(mean(row[key] for row in daily_rows)) if daily_rows else 0
    summary["days"] = len(daily_rows)
    summary["station_union"] = len({code for day in dates for code in flow.get(day, {})})
    return summary, daily_rows, hourly_rows


def aggregate_aug_rates(rows: list[dict], summary: dict) -> None:
    for metric, sum_col, count_col, bands in (
        ("bike_rate", "bikeRateSum", "bikeRateCount", BANDS),
        ("dock_rate", "dockRateSum", "dockRateCount", {"07_09": BANDS["07_09"]}),
    ):
        for key, hours in bands.items():
            selected = [row for row in rows if int(row["hour"]) in hours]
            numerator = sum(float(row[sum_col]) for row in selected)
            denominator = sum(int(row[count_col]) for row in selected)
            summary[f"{metric}_{key}"] = numerator / denominator if denominator else None


def aggregate_report_rates(rows: list[dict], dates: list[str], summary: dict) -> None:
    selected_dates = set(dates)
    for status, prefix, bands in (
        ("見車率", "bike_rate", BANDS),
        ("見位率", "dock_rate", {"07_09": BANDS["07_09"]}),
    ):
        status_rows = [row for row in rows if row["date"] in selected_dates and row["status"] == status]
        for key, hours in bands.items():
            values = [row["hourly"][hour] for row in status_rows for hour in hours if row["hourly"][hour] is not None]
            summary[f"{prefix}_{key}"] = mean(values) if values else None


def attach_daily_rates(daily_rows: list[dict], report_rows: list[dict]) -> None:
    for daily in daily_rows:
        rates = [row for row in report_rows if row["date"] == daily["date"]]
        for status, prefix, bands in (
            ("見車率", "bike_rate", BANDS),
            ("見位率", "dock_rate", {"07_09": BANDS["07_09"]}),
        ):
            selected = [row for row in rates if row["status"] == status]
            for key, hours in bands.items():
                values = [row["hourly"][hour] for row in selected for hour in hours if row["hourly"][hour] is not None]
                daily[f"{prefix}_{key}"] = mean(values) if values else None


def station_period(flow: dict, report_rows: list[dict], dates: list[str], label: str) -> list[dict]:
    codes = sorted({code for day in dates for code in flow.get(day, {})})
    output = []
    for code in codes:
        station_days = [flow.get(day, {}).get(code) for day in dates]
        station_days = [item for item in station_days if item]
        name = next((item["name"] for item in station_days if item.get("name")), code)
        row = {
            "period": label,
            "code": code,
            "name": name,
            "active_days": len(station_days),
            "daily_avg_borrow": mean(sum(item["borrow"]) for item in station_days) if station_days else 0,
            "daily_avg_return": mean(sum(item["return"]) for item in station_days) if station_days else 0,
        }
        station_rates = [r for r in report_rows if r["date"] in dates and r["code"] == code]
        for status, prefix, bands in (
            ("見車率", "bike_rate", BANDS),
            ("見位率", "dock_rate", {"07_09": BANDS["07_09"]}),
        ):
            selected = [item for item in station_rates if item["status"] == status]
            for key, hours in bands.items():
                values = [item["hourly"][hour] for item in selected for hour in hours if item["hourly"][hour] is not None]
                row[f"{prefix}_{key}"] = mean(values) if values else None
        output.append(row)
    return output


def load_coords() -> dict[str, dict]:
    text = COORD_JS.read_text(encoding="utf-8")
    prefix = "window.YOUBIKE_HEATMAP_DATA="
    if not text.startswith(prefix):
        raise RuntimeError("Unexpected coordinate data wrapper")
    payload = json.loads(text[len(prefix):].rstrip().rstrip(";"))
    return {
        str(row[5]): {"name": row[0], "city": row[1], "district": row[2], "lat": row[3], "lng": row[4]}
        for row in payload["stations"]
    }


def time_band(hour: int) -> str:
    if hour <= 5:
        return "00–05"
    if hour <= 9:
        return "06–09"
    if hour <= 13:
        return "10–13"
    if hour <= 17:
        return "14–17"
    if hour <= 21:
        return "18–21"
    return "22–23"


def load_dispatch(path: Path) -> tuple[list[dict], list[dict], list[dict]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = sheet.iter_rows(values_only=True)
    headers = [str(value or "") for value in next(rows)]
    pos = {name: index for index, name in enumerate(headers)}
    required = ["城市", "場站代號", "場站名稱", "車輛號碼", "工作狀態", "車種", "數量", "抵達時間"]
    missing = [name for name in required if name not in pos]
    if missing:
        raise RuntimeError(f"{path.name}: missing VDS columns {missing}")
    events = []
    for raw in rows:
        vehicle = str(raw[pos["車輛號碼"]] or "").strip().upper()
        status = str(raw[pos["工作狀態"]] or "").strip()
        bike_type = str(raw[pos["車種"]] or "").strip()
        quantity = int(float(raw[pos["數量"]] or 0))
        if not vehicle.startswith("ZZB") or status not in {"調出", "調入"} or bike_type not in {"2.0", "2.0E"} or quantity <= 0:
            continue
        timestamp = raw[pos["抵達時間"]]
        if not isinstance(timestamp, datetime):
            timestamp = datetime.fromisoformat(str(timestamp))
        events.append({
            "date": timestamp.date().isoformat(),
            "timestamp": timestamp.isoformat(sep=" "),
            "hour": timestamp.hour,
            "time_band": time_band(timestamp.hour),
            "vehicle": vehicle,
            "status": status,
            "bike_type": bike_type,
            "quantity": quantity,
            "city": str(raw[pos["城市"]] or "").strip(),
            "station_code": str(raw[pos["場站代號"]] or "").strip(),
            "station_name": str(raw[pos["場站名稱"]] or "").strip(),
        })
    workbook.close()
    events.sort(key=lambda row: (row["date"], row["vehicle"], row["bike_type"], row["timestamp"], 0 if row["status"] == "調出" else 1))

    pending: dict[tuple[str, str, str], deque] = defaultdict(deque)
    segments = []
    unmatched = []
    for event in events:
        key = (event["date"], event["vehicle"], event["bike_type"])
        if event["status"] == "調出":
            pending[key].append({**event, "remaining": event["quantity"]})
            continue
        remaining = event["quantity"]
        while remaining > 0 and pending[key]:
            outbound = pending[key][0]
            quantity = min(remaining, outbound["remaining"])
            solid = outbound["station_code"].startswith(NTU_PREFIX) and event["station_code"].startswith(NTU_PREFIX)
            segments.append({
                "date": event["date"],
                "vehicle": event["vehicle"],
                "bike_type": event["bike_type"],
                "quantity": quantity,
                "out_time": outbound["timestamp"],
                "in_time": event["timestamp"],
                "hour": outbound["hour"],
                "time_band": outbound["time_band"],
                "out_code": outbound["station_code"],
                "out_name": outbound["station_name"],
                "in_code": event["station_code"],
                "in_name": event["station_name"],
                "line_type": "實線" if solid else "虛線",
            })
            outbound["remaining"] -= quantity
            remaining -= quantity
            if outbound["remaining"] == 0:
                pending[key].popleft()
        if remaining:
            unmatched.append({**event, "unmatched_quantity": remaining, "reason": "無前置調出"})
    for queue in pending.values():
        for event in queue:
            if event["remaining"]:
                unmatched.append({**event, "unmatched_quantity": event["remaining"], "reason": "無後續調入"})

    coords = load_coords()
    for segment in segments:
        for side in ("out", "in"):
            info = coords.get(segment[f"{side}_code"])
            segment[f"{side}_lat"] = info["lat"] if info else None
            segment[f"{side}_lng"] = info["lng"] if info else None
            segment[f"{side}_district"] = info["district"] if info else ""

    grouped = defaultdict(lambda: {"quantity": 0, "segments": 0, "vehicles": set(), "yb20": 0, "yb20e": 0})
    for row in segments:
        key = (row["date"], row["hour"], row["time_band"], row["out_code"], row["out_name"], row["in_code"], row["in_name"], row["line_type"])
        item = grouped[key]
        item["quantity"] += row["quantity"]
        item["segments"] += 1
        item["vehicles"].add(row["vehicle"])
        item["yb20" if row["bike_type"] == "2.0" else "yb20e"] += row["quantity"]
    routes = []
    for key, value in sorted(grouped.items()):
        day, hour, band, out_code, out_name, in_code, in_name, line_type = key
        out_coord = coords.get(out_code, {})
        in_coord = coords.get(in_code, {})
        routes.append({
            "date": day,
            "hour": hour,
            "time_band": band,
            "out_code": out_code,
            "out_name": out_name,
            "out_lat": out_coord.get("lat"),
            "out_lng": out_coord.get("lng"),
            "in_code": in_code,
            "in_name": in_name,
            "in_lat": in_coord.get("lat"),
            "in_lng": in_coord.get("lng"),
            "line_type": line_type,
            "route_segments": value["segments"],
            "vehicle_count": len(value["vehicles"]),
            "vehicles": sorted(value["vehicles"]),
            "quantity": value["quantity"],
            "quantity_20": value["yb20"],
            "quantity_20e": value["yb20e"],
        })
    return events, segments, routes, unmatched


def main() -> None:
    flow = {}
    load_flow(FLOW_AUG / "cps_taipei_yb20_2026-08-01_2026-08-31.xlsx", "2.0", flow)
    load_flow(FLOW_AUG / "cps_taipei_yb20e_2026-08-01_2026-08-31.xlsx", "2.0E", flow)
    load_flow(RAW / "cps_taipei_yb20_2026-09-01_2026-09-10.xlsx", "2.0", flow)
    load_flow(RAW / "cps_taipei_yb20e_2026-09-01_2026-09-10.xlsx", "2.0E", flow)

    report_sep = load_report_rates(RAW / "report_taipei_2026-09-01_2026-09-10.json")
    aug_dates = sorted(day for day in flow if day.startswith("2026-08") and weekday(day))
    sep_requested = sorted(day for day in flow if "2026-09-01" <= day <= "2026-09-10" and weekday(day))
    sep_complete = [day for day in sep_requested if day != "2026-09-10"]
    recent_requested = [day for day in sep_requested if day >= "2026-09-07"]
    recent_complete = [day for day in recent_requested if day != "2026-09-10"]

    aug_summary, aug_daily, aug_hourly = aggregate_flow(flow, aug_dates)
    aggregate_aug_rates(load_aug_rates(), aug_summary)

    sep_summary, sep_daily, sep_hourly = aggregate_flow(flow, sep_complete)
    aggregate_report_rates(report_sep, sep_complete, sep_summary)
    attach_daily_rates(sep_daily, report_sep)

    recent_summary, recent_daily, recent_hourly = aggregate_flow(flow, recent_complete)
    aggregate_report_rates(report_sep, recent_complete, recent_summary)
    attach_daily_rates(recent_daily, report_sep)

    sep_inclusive, sep_inclusive_daily, _ = aggregate_flow(flow, sep_requested)
    aggregate_report_rates(report_sep, sep_requested, sep_inclusive)
    attach_daily_rates(sep_inclusive_daily, report_sep)
    recent_inclusive, recent_inclusive_daily, _ = aggregate_flow(flow, recent_requested)
    aggregate_report_rates(report_sep, recent_requested, recent_inclusive)
    attach_daily_rates(recent_inclusive_daily, report_sep)

    last_report_hour = max(
        hour
        for row in report_sep
        if row["date"] == "2026-09-10"
        for hour, value in enumerate(row["hourly"])
        if value is not None
    )
    current_daily = next(row for row in sep_inclusive_daily if row["date"] == "2026-09-10")

    events, segments, routes, unmatched = load_dispatch(RAW / "vds_staffinfo_2026-09-01_2026-09-10_all.xlsx")
    route_summary = {
        "events": len(events),
        "segments": len(segments),
        "routes": len(routes),
        "quantity": sum(row["quantity"] for row in segments),
        "quantity_20": sum(row["quantity"] for row in segments if row["bike_type"] == "2.0"),
        "quantity_20e": sum(row["quantity"] for row in segments if row["bike_type"] == "2.0E"),
        "solid_quantity": sum(row["quantity"] for row in segments if row["line_type"] == "實線"),
        "dashed_quantity": sum(row["quantity"] for row in segments if row["line_type"] == "虛線"),
        "vehicles": sorted({row["vehicle"] for row in segments}),
        "stations": len({row["out_code"] for row in segments} | {row["in_code"] for row in segments}),
        "unmatched_quantity": sum(row["unmatched_quantity"] for row in unmatched),
    }

    export_time = datetime.fromtimestamp((RAW / "cps_taipei_yb20_2026-09-01_2026-09-10.xlsx").stat().st_mtime).astimezone()
    payload = {
        "meta": {
            "title": "臺大公館校區 8–9 月營運與 ZZB 調度月報",
            "scope": "臺北市場站代碼 500119* 動態聯集",
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "data_cutoff": export_time.isoformat(timespec="minutes"),
            "current_day_report_complete_through_hour": last_report_hour,
            "comparison_rule": "主表僅用完整平日；9/10 即時部分日另列，避免尚未發生的時段被當成 0。",
            "route_rule": "VDS 無原生起訖鍵，路線依同日、同車號、同車種的抵達時間 FIFO 重建。",
        },
        "baseline_may_weekday": BASELINE_MAY,
        "periods": {
            "aug_weekday": {"label": "8月平日", "dates": aug_dates, "summary": aug_summary},
            "sep_to_0910": {"label": "9/1–9/10（完整平日至9/9）", "requested_dates": sep_requested, "dates": sep_complete, "summary": sep_summary, "inclusive_partial_summary": sep_inclusive},
            "sep_0907_0910": {"label": "9/7–9/10（完整平日至9/9）", "requested_dates": recent_requested, "dates": recent_complete, "summary": recent_summary, "inclusive_partial_summary": recent_inclusive},
        },
        "daily": aug_daily + sep_inclusive_daily,
        "hourly": [dict(row, period="8月平日") for row in aug_hourly] + [dict(row, period="9/1–9/9完整平日") for row in sep_hourly] + [dict(row, period="9/7–9/9完整平日") for row in recent_hourly],
        "stations": station_period(flow, [], aug_dates, "8月平日") + station_period(flow, report_sep, sep_complete, "9/1–9/9完整平日") + station_period(flow, report_sep, recent_complete, "9/7–9/9完整平日"),
        "current_day_partial": current_daily,
        "dispatch": {
            "summary": route_summary,
            "events": events,
            "segments": segments,
            "routes": routes,
            "unmatched": unmatched,
        },
        "sources": {
            "aug_flow": ["cps_taipei_yb20_2026-08-01_2026-08-31.xlsx", "cps_taipei_yb20e_2026-08-01_2026-08-31.xlsx"],
            "aug_rates": str(RATE_AUG),
            "sep_flow": ["cps_taipei_yb20_2026-09-01_2026-09-10.xlsx", "cps_taipei_yb20e_2026-09-01_2026-09-10.xlsx"],
            "sep_rates": "report_taipei_2026-09-01_2026-09-10.json",
            "dispatch": "vds_staffinfo_2026-09-01_2026-09-10_all.xlsx",
        },
    }

    known_aug = {
        "borrow": 9906, "return": 9673, "usage_06_23": 9722, "usage_07_09": 1485,
        "usage_11_13": 2289, "usage_16_20": 3490, "usage_21_23": 624,
    }
    for key, expected in known_aug.items():
        if aug_summary[key] != expected:
            raise RuntimeError(f"August reconciliation failed for {key}: {aug_summary[key]} != {expected}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "output": str(OUT),
        "aug": aug_summary,
        "sep": sep_summary,
        "recent": recent_summary,
        "current_partial": current_daily,
        "dispatch": route_summary,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
