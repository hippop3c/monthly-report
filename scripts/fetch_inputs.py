from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(r"C:\Users\user\Documents\調度相關")
BASE = ROOT / "monthly-report"
RAW = BASE / "data" / "raw"
SESSIONS = Path.home() / ".codex" / "sessions"
REPORT_CREDENTIALS = ROOT / "working_report_credentials.json"
START = "2026-09-01"
END = "2026-09-10"
VDS_URL = "https://vds.youbike2.com/Work/StaffInfo"
REPORT_API = "https://youbike-report-api-421613424541.asia-east1.run.app"

sys.path.insert(0, str(ROOT))
from fetch_weekday_station_data import download_cps, opener, sso_login


def credential_pairs(prefix: str) -> list[tuple[str, str]]:
    pattern = re.compile(
        rf"\$env:{re.escape(prefix)}_ACCOUNT='([^'\r\n]{{1,100}})'\s*;\s*"
        rf"\$env:{re.escape(prefix)}_PASSWORD='([^'\r\n]{{1,200}})'"
    )
    command = ["rg", "-l", prefix, str(SESSIONS), "-g", "*.jsonl"]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    paths = [Path(line.strip()) for line in completed.stdout.splitlines() if line.strip()]
    paths.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    seen: set[tuple[str, str]] = set()
    result: list[tuple[str, str]] = []
    for path in paths:
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for match in pattern.finditer(source):
            pair = (match.group(1), match.group(2))
            if pair not in seen:
                seen.add(pair)
                result.append(pair)
    return result


def authenticated(system: str, prefix: str, landing: str):
    pairs = credential_pairs(prefix)
    for index, (account, password) in enumerate(pairs, 1):
        web = opener()
        try:
            sso_login(web, account, password, system, landing)
        except Exception as exc:
            print(json.dumps({"system": system, "candidate": index, "ok": False, "error": type(exc).__name__}), flush=True)
            continue
        print(json.dumps({"system": system, "candidate": index, "ok": True}), flush=True)
        return web
    raise RuntimeError(f"No working {system} credential among {len(pairs)} saved candidates")


def read_json(web: urllib.request.OpenerDirector, url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, text/plain, */*",
            "Referer": VDS_URL,
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    try:
        with web.open(request, timeout=300) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body[:500]}") from exc


def fetch_vds(web) -> dict:
    output = RAW / f"vds_staffinfo_{START}_{END}_all.xlsx"
    params = {
        "province": "50",
        "county": "5001",
        "area": "",
        "duty_group": "",
        "station": "",
        "dispatch_type": "",
        "contract_type": "",
        "dispatch_sn": "",
        "dispatch_user": "",
        "dispatch_bike_type": "",
        "device_uuid": "",
        "date_st": f"{START} 00:00",
        "date_ed": f"{END} 23:59",
        "tab": "0",
    }
    query = urllib.parse.urlencode(params)
    init = read_json(web, f"{VDS_URL}/ExportForLongConnection?{query}")
    if init.get("retCode") != 1:
        raise RuntimeError(f"VDS export initialization failed: {init}")
    token = init["retVal"]["file_token"]
    deadline = time.monotonic() + 1800
    checks = 0
    while True:
        checks += 1
        status = read_json(web, f"{VDS_URL}/ExportCheck?{urllib.parse.urlencode({'file_token': token})}")
        if status.get("retCode") != 1:
            raise RuntimeError(f"VDS export failed: {status}")
        if not (status.get("retVal") or {}).get("continue"):
            break
        if time.monotonic() >= deadline:
            raise TimeoutError("VDS export did not finish within 1800 seconds")
        if checks % 15 == 0:
            print(json.dumps({"system": "vds", "status": "processing", "checks": checks}), flush=True)
        time.sleep(2)
    url = f"{VDS_URL}/ExportDownload?{urllib.parse.urlencode({'file_token': token})}"
    request = urllib.request.Request(url, headers={"Referer": VDS_URL})
    with web.open(request, timeout=900) as response:
        content = response.read()
        source_filename = urllib.parse.unquote(response.headers.get("X-Filename", ""))
    if not content.startswith(b"PK"):
        raise RuntimeError(f"VDS download is not XLSX ({len(content)} bytes)")
    output.write_bytes(content)
    return {"file": output.name, "bytes": len(content), "source_filename": source_filename, "checks": checks}


def fetch_report(start: str, end: str, output: Path) -> dict:
    credentials = json.loads(REPORT_CREDENTIALS.read_text(encoding="utf-8"))
    body = json.dumps({"account": credentials["account"], "password": credentials["password"]}).encode("utf-8")
    request = urllib.request.Request(
        f"{REPORT_API}/auth/login",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        token = json.loads(response.read().decode("utf-8"))["token"]
    params = {
        "station[]": ["all"],
        "dataset_id": "data_analysis",
        "table_id": "daily_empty_full",
        "begin_date": start,
        "end_date": end,
        "city[]": ["台北市"],
        "status[]": ["見車率", "見位率"],
    }
    url = f"{REPORT_API}/report/gcpfun?" + urllib.parse.urlencode(params, doseq=True)
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=900) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("message") != "成功" or not isinstance(payload.get("data"), list):
        raise RuntimeError(f"Report request failed: {payload.get('message')}")
    output.write_text(json.dumps(payload["data"], ensure_ascii=False), encoding="utf-8")
    return {"file": output.name, "rows": len(payload["data"])}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    summary: dict = {"period": {"start": START, "end": END}}

    cps = authenticated("cps", "CPS_TASK", "https://cps.youbike2.com/login")
    cps_files = []
    for bike_type, label in (("01", "yb20"), ("02", "yb20e")):
        output = RAW / f"cps_taipei_{label}_{START}_{END}.xlsx"
        item = download_cps(cps, "taipei", "5001", "2", bike_type, START, END, output)
        cps_files.append(item)
        print(json.dumps({"system": "cps", "file": output.name, "bytes": output.stat().st_size}), flush=True)
    summary["cps"] = cps_files

    report_output = RAW / f"report_taipei_{START}_{END}.json"
    summary["report"] = fetch_report(START, END, report_output)
    print(json.dumps({"system": "report", **summary["report"]}), flush=True)

    vds = authenticated("vds", "VDS_TASK", "https://vds.youbike2.com/login")
    summary["vds"] = fetch_vds(vds)
    print(json.dumps({"system": "vds", **summary["vds"]}, ensure_ascii=False), flush=True)

    target = RAW / "fetch_summary.json"
    target.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"complete": True, "summary": str(target)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
