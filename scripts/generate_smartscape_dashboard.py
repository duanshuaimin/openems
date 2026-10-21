#!/usr/bin/env python3
"""
Generator for OpenEMS Smartscape Full-Stack Interactive Topology Dashboard in Grafana.
Inspired by Dynatrace Smartscape:
  - Applications (VPP, Peak Shaving, Balancing, EVCS, Spot Market)
  - Control Plane (OpenEMS Edge, Backend, InfluxDB, Odoo, MPC)
  - Systems & Cabinets (BESS Container, PCS Inverter, Grid Meter, PV, Loads)
  - DC Arrays & Racks (DC Busbar, Battery Rack 160S1P, BMU, HV Box)
  - Modules (10 Series Modules, CSC)
  - Cells (160 LiFePO4 Cells, Balancing Bus)
"""

import json
import os
import urllib.request
import urllib.error

DS_UID = "P0DBC1A8D6496B50C"
DASHBOARD_UID = "openems-smartscape-topology"
DASHBOARD_TITLE = "OpenEMS 储能全景 Smartscape 交互式立体拓扑看板 (Cyber-Physical Digital Twin)"

def flux_target(field, ref_id="A", extra_pipe=""):
    q = f'''from(bucket: "openems")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r.edge == "${{edge}}")
  |> filter(fn: (r) => r._measurement == "data" and r._field == "{field}"){extra_pipe}
  |> last()'''
    return {
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "query": q,
        "refId": ref_id
    }

def flux_timeseries_target(field, ref_id="A", extra_pipe=""):
    q = f'''from(bucket: "openems")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r.edge == "${{edge}}")
  |> filter(fn: (r) => r._measurement == "data" and r._field == "{field}"){extra_pipe}'''
    return {
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "query": q,
        "refId": ref_id
    }

def build_dashboard():
    panels = []
    pid = 1

    # ----------------------------------------------------
    # SECTION 1: Top KPI Summary Bar
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 0},
        "id": pid,
        "title": "⚡ 储能全景实时运行核心指标 (Real-Time Smartscape Operations & Health)",
        "type": "row"
    })
    pid += 1

    # 1.1 系统运行工况
    panels.append({
        "id": pid,
        "title": "储能柜工况 (State)",
        "type": "stat",
        "gridPos": {"h": 3, "w": 3, "x": 0, "y": 1},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("cabinet0/State", "A")],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "mappings": [
                    {"type": "value", "options": {
                        "0": {"text": "💤 停机休眠", "color": "gray"},
                        "1": {"text": "🔌 填谷充电", "color": "#FF9900"},
                        "2": {"text": "⚡ 削峰放电", "color": "#5794F2"},
                        "3": {"text": "✨ 浮充待机", "color": "#73BF69"},
                        "4": {"text": "⚠️ 告警状态", "color": "#FADE2A"},
                        "5": {"text": "🚨 保护停机", "color": "#F2495C"}
                    }},
                    {"type": "special", "options": {"match": "null", "result": {"text": "运行正常", "color": "#73BF69"}}}
                ],
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            }
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # 1.2 实时有功功率
    panels.append({
        "id": pid,
        "title": "有功功率 (Active Power)",
        "type": "stat",
        "gridPos": {"h": 3, "w": 3, "x": 3, "y": 1},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("cabinet0/ActivePower", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "watt",
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "#FF9900", "value": None},
                    {"color": "gray", "value": -500},
                    {"color": "#5794F2", "value": 500}
                ]}
            }
        },
        "options": {"colorMode": "value", "graphMode": "none", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # 1.3 Pack 端电压与电流
    panels.append({
        "id": pid,
        "title": "直流端电压 / 电流",
        "type": "stat",
        "gridPos": {"h": 3, "w": 4, "x": 6, "y": 1},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/Voltage", "A"),
            flux_target("battery0/Current", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "Voltage"}, "properties": [{"id": "displayName", "value": "总电压"}, {"id": "unit", "value": "volt"}]},
                {"matcher": {"id": "byName", "options": "Current"}, "properties": [{"id": "displayName", "value": "总电流"}, {"id": "unit", "value": "amp"}]}
            ]
        },
        "options": {"colorMode": "value", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # 1.4 电池簇 SOC 荷电状态
    panels.append({
        "id": pid,
        "title": "电池簇 SOC",
        "type": "stat",
        "gridPos": {"h": 3, "w": 3, "x": 10, "y": 1},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("battery0/Soc", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "percent",
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 15},
                    {"color": "green", "value": 25},
                    {"color": "#5794F2", "value": 85}
                ]}
            }
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # 1.5 电芯最大压差 ΔV
    panels.append({
        "id": pid,
        "title": "单体最大压差 (ΔV)",
        "type": "stat",
        "gridPos": {"h": 3, "w": 3, "x": 13, "y": 1},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("battery0/CellVoltageDelta", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "millivolt",
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "green", "value": None},
                    {"color": "yellow", "value": 25},
                    {"color": "red", "value": 40}
                ]}
            }
        },
        "options": {"colorMode": "value", "graphMode": "none", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # 1.6 最高 / 最低电压电芯定位
    panels.append({
        "id": pid,
        "title": "单体极值定位 (Max/Min)",
        "type": "stat",
        "gridPos": {"h": 3, "w": 4, "x": 16, "y": 1},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/MaxVoltageCellNumber", "A"),
            flux_target("battery0/MinVoltageCellNumber", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "MaxVoltageCellNumber"}, "properties": [{"id": "displayName", "value": "最高电压电芯号 (#)"}, {"id": "color", "value": {"fixedColor": "#f59e0b", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "MinVoltageCellNumber"}, "properties": [{"id": "displayName", "value": "最低电压电芯号 (#)"}, {"id": "color", "value": {"fixedColor": "#3b82f6", "mode": "fixed"}}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # 1.7 绝缘阻抗与温控状态
    panels.append({
        "id": pid,
        "title": "安全绝缘与热工",
        "type": "stat",
        "gridPos": {"h": 3, "w": 4, "x": 20, "y": 1},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/InsulationResistance", "A"),
            flux_target("cabinet0/HvacStatus", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "InsulationResistance"}, "properties": [{"id": "displayName", "value": "母线绝缘"}, {"id": "unit", "value": "kohm"}]},
                {"matcher": {"id": "byName", "options": "HvacStatus"}, "properties": [
                    {"id": "displayName", "value": "温控空调"},
                    {"id": "mappings", "value": [{"type": "value", "options": {"0": {"text": "待机", "color": "gray"}, "1": {"text": "制冷中 ❄️", "color": "#38bdf8"}}}]}
                ]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # ----------------------------------------------------
    # SECTION 2: Centerpiece Smartscape Full-Stack Interactive App
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 4},
        "id": pid,
        "title": "🌐 Dynatrace Smartscape 储能全景拓扑：支持 L0~L5 六级下钻 (Drill-Down) 与自底向上指标上卷 (Roll-Up)",
        "type": "row"
    })
    pid += 1

    smartscape_iframe_html = """
<div style="width: 100%; height: 100%; min-height: 760px; position: relative; border-radius: 10px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 8px 32px rgba(0,0,0,0.5);">
  <iframe 
    src="/smartscape/index.html?station=${edge}&v=3.2" 
    style="width: 100%; height: 100%; min-height: 760px; border: none; display: block; background: #0a0e17;"
    title="OpenEMS Dynatrace-Style Smartscape Drill-Down & Roll-Up Topology">
  </iframe>
  <div style="position: absolute; bottom: 12px; right: 16px; pointer-events: auto;">
    <a href="/smartscape/index.html?station=${edge}&v=3.2" target="_blank" style="background: rgba(37,99,235,0.85); backdrop-filter: blur(8px); color: #fff; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,0.2);">
      <span>↗️</span> 全屏新窗口独立运行 (Drill-Down / Roll-Up)
    </a>
  </div>
</div>
"""
    panels.append({
        "gridPos": {"h": 20, "w": 24, "x": 0, "y": 5},
        "id": pid,
        "options": {
            "content": smartscape_iframe_html,
            "mode": "html"
        },
        "title": "Dynatrace Smartscape 实时拓扑数字孪生中心 (双击节点下钻 / 面包屑上卷 / ∑V·μT·ΔV·状态传染聚合)",
        "type": "text"
    })
    pid += 1

    # ----------------------------------------------------
    # SECTION 3: Deep Supporting Telemetry Rows
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 25},
        "id": pid,
        "title": "📊 物理时序遥测校验与动态演进 (Deep Physical Telemetry & Analytical Trends)",
        "type": "row"
    })
    pid += 1

    # 3.1 AC/DC Power Curves
    panels.append({
        "id": pid,
        "title": "交直流有功功率连续响应曲线 (AC/DC Active Power kW)",
        "type": "timeseries",
        "gridPos": {"h": 7, "w": 12, "x": 0, "y": 24},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_timeseries_target("cabinet0/ActivePower", "A"),
            flux_timeseries_target("cabinet0/DcPower", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "unit": "watt",
                "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "lineWidth": 2}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "ActivePower"}, "properties": [{"id": "displayName", "value": "PCS 交流有功 (AC)"}, {"id": "color", "value": {"fixedColor": "#5794F2", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "DcPower"}, "properties": [{"id": "displayName", "value": "电池直流总功率 (DC)"}, {"id": "color", "value": {"fixedColor": "#FF9900", "mode": "fixed"}}]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # 3.2 Dynamic BMS Safety Limits vs Current
    panels.append({
        "id": pid,
        "title": "BMS 充放电安全降额包络与实际电流 (Dynamic Current Limits)",
        "type": "timeseries",
        "gridPos": {"h": 7, "w": 12, "x": 12, "y": 24},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_timeseries_target("battery0/ChargeMaxCurrent", "A"),
            flux_timeseries_target("battery0/DischargeMaxCurrent", "B"),
            flux_timeseries_target("battery0/Current", "C")
        ],
        "fieldConfig": {
            "defaults": {
                "unit": "amp",
                "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "lineWidth": 2}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "ChargeMaxCurrent"}, "properties": [{"id": "displayName", "value": "充电电流保护上限"}, {"id": "color", "value": {"fixedColor": "#10b981", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "DischargeMaxCurrent"}, "properties": [{"id": "displayName", "value": "放电电流保护上限"}, {"id": "color", "value": {"fixedColor": "#ef4444", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "Current"}, "properties": [{"id": "displayName", "value": "电池簇实际电流"}, {"id": "color", "value": {"fixedColor": "#3b82f6", "mode": "fixed"}}, {"id": "custom.lineWidth", "value": 3}]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # 3.3 10-Module Voltages Bar Gauge
    mod_v_targets = [flux_target(f"battery0/Module_{m:02d}_Voltage", chr(65 + m), extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))') for m in range(1, 11)]
    mod_v_overrides = [{"matcher": {"id": "byName", "options": f"Module_{m:02d}_Voltage"}, "properties": [{"id": "displayName", "value": f"模组 #{m:02d}"}]} for m in range(1, 11)]
    panels.append({
        "id": pid,
        "title": "10个串联模组实时电压分布 (Module 01 ~ Module 10 Voltage, 51.2V Nominal)",
        "type": "bargauge",
        "gridPos": {"h": 6, "w": 12, "x": 0, "y": 31},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": mod_v_targets,
        "fieldConfig": {
            "defaults": {
                "unit": "volt",
                "min": 48.0,
                "max": 56.0,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 50.0},
                    {"color": "green", "value": 51.0},
                    {"color": "#3b82f6", "value": 54.0},
                    {"color": "red", "value": 55.5}
                ]}
            },
            "overrides": mod_v_overrides
        },
        "options": {"displayMode": "gradient", "orientation": "horizontal", "showUnfilled": True, "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # 3.4 160-Cell Voltage Matrix
    cell_query = f'''from(bucket: "openems")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r.edge == "${{edge}}")
  |> filter(fn: (r) => r._measurement == "data" and r._field =~ /^battery0\/Cell_[0-9]{{3}}_V$/)
  |> last()'''
    panels.append({
        "id": pid,
        "title": "160颗 LiFePO4 电芯单体电压全景分布 (160-Cell Matrix across 10 Modules, mV)",
        "type": "bargauge",
        "gridPos": {"h": 6, "w": 12, "x": 12, "y": 31},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [{
            "datasource": {"type": "influxdb", "uid": DS_UID},
            "query": cell_query,
            "refId": "A"
        }],
        "fieldConfig": {
            "defaults": {
                "unit": "millivolt",
                "min": 3220,
                "max": 3420,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 3260},
                    {"color": "#10b981", "value": 3280},
                    {"color": "#3b82f6", "value": 3330},
                    {"color": "yellow", "value": 3380},
                    {"color": "red", "value": 3420}
                ]}
            }
        },
        "options": {"displayMode": "lcd", "orientation": "horizontal", "showUnfilled": True, "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Templating variables
    templating = {
        "list": [
            {
                "current": {"selected": True, "text": "bms", "value": "bms"},
                "datasource": {"type": "influxdb", "uid": DS_UID},
                "definition": 'import "influxdata/influxdb/schema"\nschema.tagValues(bucket: "openems", tag: "edge")',
                "hide": 0,
                "includeAll": False,
                "label": "选择监控储能柜 / BMS设备",
                "multi": False,
                "name": "edge",
                "options": [],
                "query": 'import "influxdata/influxdb/schema"\nschema.tagValues(bucket: "openems", tag: "edge")',
                "refresh": 1,
                "regex": "",
                "skipUrlSync": False,
                "sort": 1,
                "type": "query"
            }
        ]
    }

    dashboard = {
        "annotations": {"list": []},
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 1,
        "id": None,
        "links": [
            {
                "asDropdown": False,
                "icon": "dashboard",
                "includeVars": True,
                "keepTime": True,
                "tags": ["bess", "topology"],
                "targetBlank": False,
                "title": "🔋 储能柜五级物理拓扑看板",
                "type": "link",
                "url": "/d/openems-bess-topology"
            },
            {
                "asDropdown": False,
                "icon": "dashboard",
                "includeVars": True,
                "keepTime": True,
                "tags": ["command-center"],
                "targetBlank": False,
                "title": "⚡ 智慧微电网调度中心",
                "type": "link",
                "url": "/d/openems-ess-analytics"
            }
        ],
        "liveNow": True,
        "panels": panels,
        "refresh": "5s",
        "schemaVersion": 38,
        "style": "dark",
        "tags": ["openems", "smartscape", "topology", "dynatrace", "bess", "digital-twin", "microgrid"],
        "templating": templating,
        "time": {"from": "now-15m", "to": "now"},
        "timepicker": {"refresh_intervals": ["2s", "5s", "10s", "30s", "1m"]},
        "timezone": "browser",
        "title": DASHBOARD_TITLE,
        "uid": DASHBOARD_UID,
        "version": 1
    }

    return dashboard

def main():
    db = build_dashboard()
    dest_path = "/var/lib/grafana/dashboards/openems_smartscape_topology_dashboard.json"
    repo_path = "/home/user01/local/openems/scripts/openems_smartscape_topology_dashboard.json"
    
    with open(repo_path, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    print(f"Generated Smartscape dashboard JSON at {repo_path}")

    # Copy to /var/lib/grafana/dashboards
    os.system(f"sudo cp {repo_path} {dest_path} && sudo chmod 644 {dest_path}")
    print(f"Copied to provisioning directory: {dest_path}")

    # POST to Grafana API
    grafana_auth = os.environ.get("GRAFANA_BASIC_AUTH", "")
    api_payload = json.dumps({"dashboard": db, "overwrite": True}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:3000/api/dashboards/db",
        data=api_payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {grafana_auth}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            resp_body = resp.read().decode("utf-8")
            print("Grafana API Response:", resp_body)
    except Exception as e:
        print("Error uploading to Grafana API:", e)

if __name__ == "__main__":
    main()
