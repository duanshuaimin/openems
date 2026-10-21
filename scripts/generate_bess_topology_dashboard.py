#!/usr/bin/env python3
"""
Generator for OpenEMS BESS 5-Tier Hierarchical Topology & Digital Twin Dashboard in Grafana.
Hierarchical Levels:
  1. 储能柜 (Cabinet / BESS Container)
  2. 电池阵列 (Array / DC Cluster)
  3. 电池簇 / Pack (Battery Pack / Rack)
  4. 模组 (Module - 10 Modules in Series)
  5. 电芯 (Cell - 160 LiFePO4 Cells in Series)
"""

import json
import os
import urllib.request
import urllib.error

DS_UID = "P0DBC1A8D6496B50C"
DASHBOARD_UID = "openems-bess-topology"
DASHBOARD_TITLE = "OpenEMS 储能柜五级物理拓扑与电芯数字孪生全景看板 (BESS 5-Tier Topology & Digital Twin)"

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
    # SECTION 0: 拓扑全景图与交互说明 (Interactive Architecture & Topology Map)
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 0},
        "id": pid,
        "title": "🏗️ 储能柜五级物理拓扑架构全景 (BESS 5-Tier Physical Topology & Hierarchy)",
        "type": "row"
    })
    pid += 1

    topology_html = """
<div style="background: linear-gradient(135deg, #111827 0%, #1f2937 100%); border-radius: 12px; padding: 18px 24px; border: 1px solid #374151; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid #374151; padding-bottom: 10px;">
    <div>
      <h3 style="margin: 0; color: #60a5fa; font-size: 19px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
        <span>🔋</span> 储能柜系统五级物理拓扑 (BESS 5-Tier Physical Topology)
      </h3>
      <p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 13px;">
        从宏观储能集装箱/户外柜到微观单体电芯的全链路数字孪生监测，覆盖电、热、安全多维度实时状态
      </p>
    </div>
    <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 8px; padding: 6px 14px; color: #34d399; font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px;">
      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
      拓扑链路就绪 (Digital Twin Active)
    </div>
  </div>

  <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; position: relative;">
    
    <!-- Level 1: 储能柜 -->
    <div style="background: rgba(31, 41, 55, 0.7); border: 1px solid #3b82f6; border-radius: 10px; padding: 14px; position: relative; transition: all 0.3s ease;">
      <div style="font-size: 11px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.5px;">Level 1 • 系统级</div>
      <div style="font-size: 16px; font-weight: 700; color: #f3f4f6; margin: 4px 0 8px 0; display: flex; align-items: center; gap: 6px;">
        <span>🏢</span> 储能柜 (Cabinet)
      </div>
      <div style="font-size: 12px; color: #d1d5db; line-height: 1.6;">
        • 额定容量: <b>100 kWh</b><br>
        • 额定功率: <b>50 kW / 100 kW</b><br>
        • PCS 双向变流器耦合<br>
        • 液冷/空调恒温 + 气溶胶消防
      </div>
      <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #374151; font-size: 11px; color: #9ca3af;">
        关注: AC/DC总功率, RTE效率, 柜内温湿度
      </div>
    </div>

    <!-- Level 2: 电池阵列 -->
    <div style="background: rgba(31, 41, 55, 0.7); border: 1px solid #8b5cf6; border-radius: 10px; padding: 14px; position: relative;">
      <div style="font-size: 11px; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: 0.5px;">Level 2 • 阵列级</div>
      <div style="font-size: 16px; font-weight: 700; color: #f3f4f6; margin: 4px 0 8px 0; display: flex; align-items: center; gap: 6px;">
        <span>⚡</span> 电池阵列 (Array)
      </div>
      <div style="font-size: 12px; color: #d1d5db; line-height: 1.6;">
        • 直流母线电压: <b>512V ~ 750V</b><br>
        • 多簇并联拓扑 (1~N Piles)<br>
        • 高压直流断路器 + 接触器<br>
        • 簇间环流阻断与均衡管理
      </div>
      <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #374151; font-size: 11px; color: #9ca3af;">
        关注: 母线电压, 阵列总流, 簇间SOC方差
      </div>
    </div>

    <!-- Level 3: 电池簇 / Pack -->
    <div style="background: rgba(31, 41, 55, 0.7); border: 1px solid #ec4899; border-radius: 10px; padding: 14px; position: relative;">
      <div style="font-size: 11px; font-weight: 700; color: #f472b6; text-transform: uppercase; letter-spacing: 0.5px;">Level 3 • 电池簇</div>
      <div style="font-size: 16px; font-weight: 700; color: #f3f4f6; margin: 4px 0 8px 0; display: flex; align-items: center; gap: 6px;">
        <span>🔋</span> 电池簇 (Pack / Rack)
      </div>
      <div style="font-size: 12px; color: #d1d5db; line-height: 1.6;">
        • 拓扑串并联: <b>160S1P</b><br>
        • 额定电压: <b>512.0 V</b><br>
        • 标称电量: <b>100 kWh</b> (195.3Ah)<br>
        • BMU 主控 + 动态保护包络
      </div>
      <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #374151; font-size: 11px; color: #9ca3af;">
        关注: Pack电压/电流, SOC/SOH, 绝缘电阻
      </div>
    </div>

    <!-- Level 4: 电池模组 -->
    <div style="background: rgba(31, 41, 55, 0.7); border: 1px solid #f59e0b; border-radius: 10px; padding: 14px; position: relative;">
      <div style="font-size: 11px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.5px;">Level 4 • 模组级</div>
      <div style="font-size: 16px; font-weight: 700; color: #f3f4f6; margin: 4px 0 8px 0; display: flex; align-items: center; gap: 6px;">
        <span>🧱</span> 电池模组 (Module)
      </div>
      <div style="font-size: 12px; color: #d1d5db; line-height: 1.6;">
        • 模组数量: <b>10 个串联模组</b><br>
        • 单模组构型: <b>16S 51.2V</b><br>
        • 模组集成采样板 (CSC / CMU)<br>
        • 模组独立温场监测 (10点测温)
      </div>
      <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #374151; font-size: 11px; color: #9ca3af;">
        关注: 10模组电压分布, 模组极值与温差
      </div>
    </div>

    <!-- Level 5: 单体电芯 -->
    <div style="background: rgba(31, 41, 55, 0.7); border: 1px solid #10b981; border-radius: 10px; padding: 14px; position: relative;">
      <div style="font-size: 11px; font-weight: 700; color: #34d399; text-transform: uppercase; letter-spacing: 0.5px;">Level 5 • 电芯级</div>
      <div style="font-size: 16px; font-weight: 700; color: #f3f4f6; margin: 4px 0 8px 0; display: flex; align-items: center; gap: 6px;">
        <span>🔬</span> 单体电芯 (Cell)
      </div>
      <div style="font-size: 12px; color: #d1d5db; line-height: 1.6;">
        • 单体数量: <b>160 颗串联电芯</b><br>
        • 化学体系: <b>LiFePO4 (3.2V)</b><br>
        • 电压区间: <b>2.80V ~ 3.45V</b><br>
        • 主动/被动均衡电路精准护航
      </div>
      <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #374151; font-size: 11px; color: #9ca3af;">
        关注: Max/Min电芯编号, 压差ΔV, 温差ΔT
      </div>
    </div>

  </div>
</div>
"""
    panels.append({
        "gridPos": {"h": 5, "w": 24, "x": 0, "y": 1},
        "id": pid,
        "options": {
            "content": topology_html,
            "mode": "html"
        },
        "title": "拓扑结构层级导览 (Topology Navigation)",
        "type": "text"
    })
    pid += 1

    # ----------------------------------------------------
    # SECTION 1: 第一级 - 储能柜系统级总览 (Tier 1: Cabinet Overview & Thermal / Safety)
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 6},
        "id": pid,
        "title": "🏢 第一级: 储能柜宏观工况与环境安全 (Tier 1: Cabinet Overview & Thermal / Safety)",
        "type": "row"
    })
    pid += 1

    # Panel 1.1: 储能柜系统工况
    panels.append({
        "id": pid,
        "title": "储能柜系统运行工况 (Cabinet State)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 0, "y": 7},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("cabinet0/State", "A")],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "mappings": [
                    {"type": "value", "options": {
                        "0": {"text": "💤 停机休眠 (SLEEP)", "color": "gray"},
                        "1": {"text": "🔌 填谷充电 (CHARGING)", "color": "#FF9900"},
                        "2": {"text": "⚡ 削峰放电 (DISCHARGING)", "color": "#5794F2"},
                        "3": {"text": "✨ 浮充待机 (STANDBY)", "color": "#73BF69"},
                        "4": {"text": "⚠️ 系统告警 (WARNING)", "color": "#FADE2A"},
                        "5": {"text": "🚨 保护故障 (FAULT)", "color": "#F2495C"}
                    }},
                    {"type": "special", "options": {"match": "null", "result": {"text": "待机 (STANDBY)", "color": "#73BF69"}}}
                ],
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            }
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 1.2: 储能柜交流有功功率
    panels.append({
        "id": pid,
        "title": "储能柜交流有功功率 (AC Active Power)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 4, "y": 7},
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
        "options": {"colorMode": "value", "graphMode": "area", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 1.3: 系统综合能量转换效率 RTE
    panels.append({
        "id": pid,
        "title": "系统充放电能效 RTE (Efficiency)",
        "type": "gauge",
        "gridPos": {"h": 4, "w": 4, "x": 8, "y": 7},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("cabinet0/RteEfficiency", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))')],
        "fieldConfig": {
            "defaults": {
                "unit": "percent",
                "min": 70,
                "max": 100,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 85},
                    {"color": "green", "value": 90}
                ]}
            }
        },
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "values": False}, "showThresholdLabels": False, "showThresholdMarkers": True}
    })
    pid += 1

    # Panel 1.4: 今日累计充放电量
    panels.append({
        "id": pid,
        "title": "今日累计充放电量 (Daily Energy)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 12, "y": 7},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("cabinet0/DailyChargeEnergy", "A"),
            flux_target("cabinet0/DailyDischargeEnergy", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "unit": "watth",
                "color": {"mode": "palette-classic"}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "DailyChargeEnergy"}, "properties": [{"id": "displayName", "value": "日充电量"}, {"id": "color", "value": {"fixedColor": "#FF9900", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "DailyDischargeEnergy"}, "properties": [{"id": "displayName", "value": "日放电量"}, {"id": "color", "value": {"fixedColor": "#5794F2", "mode": "fixed"}}]}
            ]
        },
        "options": {"colorMode": "value", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 1.5: 柜内热工与温控环境
    panels.append({
        "id": pid,
        "title": "柜内热工与温控 (Thermal & HVAC)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 16, "y": 7},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("cabinet0/AmbientTemp", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("cabinet0/HvacStatus", "B"),
            flux_target("cabinet0/Humidity", "C")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "AmbientTemp"}, "properties": [{"id": "displayName", "value": "柜内环温"}, {"id": "unit", "value": "celsius"}]},
                {"matcher": {"id": "byName", "options": "HvacStatus"}, "properties": [
                    {"id": "displayName", "value": "温控机组"},
                    {"id": "mappings", "value": [{"type": "value", "options": {"0": {"text": "待机 (IDLE)", "color": "gray"}, "1": {"text": "制冷运行 (COOLING)", "color": "#5794F2"}}}]}
                ]},
                {"matcher": {"id": "byName", "options": "Humidity"}, "properties": [{"id": "displayName", "value": "相对湿度"}, {"id": "unit", "value": "humidity"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 1.6: 消防安全与电气联锁
    panels.append({
        "id": pid,
        "title": "消防与安全联锁 (Safety & Interlocks)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 20, "y": 7},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("cabinet0/FireSystemStatus", "A"),
            flux_target("cabinet0/DoorLimitStatus", "B"),
            flux_target("cabinet0/EmergencyStopStatus", "C"),
            flux_target("battery0/InsulationResistance", "D")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "FireSystemStatus"}, "properties": [
                    {"id": "displayName", "value": "气溶胶消防"},
                    {"id": "mappings", "value": [{"type": "value", "options": {"0": {"text": "正常警戒", "color": "green"}, "1": {"text": "告警喷淋", "color": "red"}}}]}
                ]},
                {"matcher": {"id": "byName", "options": "DoorLimitStatus"}, "properties": [
                    {"id": "displayName", "value": "柜门行程联锁"},
                    {"id": "mappings", "value": [{"type": "value", "options": {"0": {"text": "闭合锁止", "color": "green"}, "1": {"text": "开启中", "color": "yellow"}}}]}
                ]},
                {"matcher": {"id": "byName", "options": "EmergencyStopStatus"}, "properties": [
                    {"id": "displayName", "value": "急停开关"},
                    {"id": "mappings", "value": [{"type": "value", "options": {"0": {"text": "复位正常", "color": "green"}, "1": {"text": "急停拍下", "color": "red"}}}]}
                ]},
                {"matcher": {"id": "byName", "options": "InsulationResistance"}, "properties": [
                    {"id": "displayName", "value": "整柜绝缘阻抗"},
                    {"id": "unit", "value": "kohm"}
                ]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 1.7: 储能柜有功/直流功率连续流
    panels.append({
        "id": pid,
        "title": "储能柜交/直流有功功率动态时序曲线 (Cabinet AC/DC Power kW)",
        "type": "timeseries",
        "gridPos": {"h": 7, "w": 24, "x": 0, "y": 11},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_timeseries_target("cabinet0/ActivePower", "A"),
            flux_timeseries_target("cabinet0/DcPower", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "custom": {
                    "drawStyle": "line",
                    "lineInterpolation": "smooth",
                    "lineWidth": 2,
                    "fillOpacity": 15,
                    "gradientMode": "opacity"
                },
                "unit": "watt"
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "ActivePower"}, "properties": [{"id": "displayName", "value": "储能柜交流功率 (AC)"}, {"id": "color", "value": {"fixedColor": "#5794F2", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "DcPower"}, "properties": [{"id": "displayName", "value": "电池直流总功率 (DC)"}, {"id": "color", "value": {"fixedColor": "#FF9900", "mode": "fixed"}}]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # ----------------------------------------------------
    # SECTION 2: 第二级 - 电池阵列与多簇汇流 (Tier 2: Array & DC Cluster Management)
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 18},
        "id": pid,
        "title": "⚡ 第二级: 电池阵列与汇流管理 (Tier 2: Array & DC Cluster Management)",
        "type": "row"
    })
    pid += 1

    # Panel 2.1: 阵列直流母线电压
    panels.append({
        "id": pid,
        "title": "阵列直流母线电压 (DC Bus Voltage)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 6, "x": 0, "y": 19},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("array0/DcVoltage", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "volt",
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "green", "value": 450},
                    {"color": "red", "value": 780}
                ]}
            }
        },
        "options": {"colorMode": "value", "graphMode": "area", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 2.2: 阵列总直流电流
    panels.append({
        "id": pid,
        "title": "阵列总直流电流 (Array DC Current)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 6, "x": 6, "y": 19},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("array0/DcCurrent", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "amp",
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "#FF9900", "value": None},
                    {"color": "gray", "value": -2},
                    {"color": "#5794F2", "value": 2}
                ]}
            }
        },
        "options": {"colorMode": "value", "graphMode": "area", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 2.3: 并联簇数与簇间均衡度
    panels.append({
        "id": pid,
        "title": "并联簇数与均衡度 (Parallel Racks & Balance)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 6, "x": 12, "y": 19},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("array0/ParallelPiles", "A"),
            flux_target("array0/SocBalanceVariance", "B", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("array0/CirculatingCurrent", "C", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))')
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "ParallelPiles"}, "properties": [{"id": "displayName", "value": "投运并联簇数"}]},
                {"matcher": {"id": "byName", "options": "SocBalanceVariance"}, "properties": [{"id": "displayName", "value": "簇间SOC方差"}, {"id": "unit", "value": "percent"}]},
                {"matcher": {"id": "byName", "options": "CirculatingCurrent"}, "properties": [{"id": "displayName", "value": "簇间环流"}, {"id": "unit", "value": "amp"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 2.4: 高压直流断路器与接触器工况
    panels.append({
        "id": pid,
        "title": "高压断路器与接触器 (DC Breakers & Contactors)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 6, "x": 18, "y": 19},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("array0/DcBreakerStatus", "A"),
            flux_target("array0/MainContactorPos", "B"),
            flux_target("array0/MainContactorNeg", "C"),
            flux_target("array0/PrechargeContactor", "D")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "mappings": [{"type": "value", "options": {
                    "0": {"text": "分闸/断开 (OPEN)", "color": "gray"},
                    "1": {"text": "合闸/闭合 (CLOSED)", "color": "green"}
                }}],
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "DcBreakerStatus"}, "properties": [{"id": "displayName", "value": "高压直流主断路器"}]},
                {"matcher": {"id": "byName", "options": "MainContactorPos"}, "properties": [{"id": "displayName", "value": "主正接触器 (KM+)"}]},
                {"matcher": {"id": "byName", "options": "MainContactorNeg"}, "properties": [{"id": "displayName", "value": "主负接触器 (KM-)"}]},
                {"matcher": {"id": "byName", "options": "PrechargeContactor"}, "properties": [{"id": "displayName", "value": "预充回路接触器"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 2.5: 阵列直流母线电压与充放电电流动态曲线
    panels.append({
        "id": pid,
        "title": "阵列直流母线电压与总电流动态曲线 (DC Bus Voltage & Current Trend)",
        "type": "timeseries",
        "gridPos": {"h": 7, "w": 24, "x": 0, "y": 23},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_timeseries_target("array0/DcVoltage", "A"),
            flux_timeseries_target("array0/DcCurrent", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "lineWidth": 2}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "DcVoltage"}, "properties": [
                    {"id": "displayName", "value": "直流母线电压 (V)"},
                    {"id": "unit", "value": "volt"},
                    {"id": "custom.axisPlacement", "value": "left"},
                    {"id": "color", "value": {"fixedColor": "#73BF69", "mode": "fixed"}}
                ]},
                {"matcher": {"id": "byName", "options": "DcCurrent"}, "properties": [
                    {"id": "displayName", "value": "阵列总电流 (A)"},
                    {"id": "unit", "value": "amp"},
                    {"id": "custom.axisPlacement", "value": "right"},
                    {"id": "color", "value": {"fixedColor": "#F2CC0C", "mode": "fixed"}}
                ]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # ----------------------------------------------------
    # SECTION 3: 第三级 - 电池簇 / Pack 详情 (Tier 3: Pack Electrical & Dynamic Envelope)
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 30},
        "id": pid,
        "title": "🔋 第三级: 电池簇 / Pack 运行工况与保护包络 (Tier 3: Pack / Rack Electrical & Dynamic Envelope)",
        "type": "row"
    })
    pid += 1

    # Panel 3.1: 电池簇 SOC 荷电状态
    panels.append({
        "id": pid,
        "title": "电池簇 SOC 荷电状态 (Pack SOC)",
        "type": "gauge",
        "gridPos": {"h": 5, "w": 6, "x": 0, "y": 31},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("battery0/Soc", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "percent",
                "min": 0,
                "max": 100,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 15},
                    {"color": "green", "value": 25},
                    {"color": "#5794F2", "value": 85}
                ]}
            }
        },
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "values": False}, "showThresholdLabels": True, "showThresholdMarkers": True}
    })
    pid += 1

    # Panel 3.2: 电池簇 SOH 健康度与循环次数
    panels.append({
        "id": pid,
        "title": "电池簇健康度与寿命 (SOH & Cycle Count)",
        "type": "stat",
        "gridPos": {"h": 5, "w": 6, "x": 6, "y": 31},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/Soh", "A"),
            flux_target("battery0/CycleCount", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "Soh"}, "properties": [{"id": "displayName", "value": "SOH 健康度"}, {"id": "unit", "value": "percent"}]},
                {"matcher": {"id": "byName", "options": "CycleCount"}, "properties": [{"id": "displayName", "value": "累计等效满充满放循环 (Cycles)"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 3.3: 电池簇剩余可用电量
    panels.append({
        "id": pid,
        "title": "电池簇剩余可用电量 (Remaining Capacity)",
        "type": "stat",
        "gridPos": {"h": 5, "w": 6, "x": 12, "y": 31},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("battery0/RemainingCapacity", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "watth",
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 20000},
                    {"color": "green", "value": 50000}
                ]}
            }
        },
        "options": {"colorMode": "value", "graphMode": "area", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 3.4: 电池簇绝缘阻抗
    panels.append({
        "id": pid,
        "title": "电池簇极对地绝缘阻抗 (Pack Insulation)",
        "type": "stat",
        "gridPos": {"h": 5, "w": 6, "x": 18, "y": 31},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("battery0/InsulationResistance", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "kohm",
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 1000},
                    {"color": "green", "value": 5000}
                ]}
            }
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 3.5: BMS 充放电动态包络安全曲线
    panels.append({
        "id": pid,
        "title": "BMS 充放电安全包络与实际电流 (Dynamic Current Limit Envelope & Derating)",
        "type": "timeseries",
        "gridPos": {"h": 7, "w": 12, "x": 0, "y": 36},
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
                {"matcher": {"id": "byName", "options": "ChargeMaxCurrent"}, "properties": [{"id": "displayName", "value": "允许充电电流限额 (Envelope Max)"}, {"id": "color", "value": {"fixedColor": "#34d399", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "DischargeMaxCurrent"}, "properties": [{"id": "displayName", "value": "允许放电电流限额 (Envelope Max)"}, {"id": "color", "value": {"fixedColor": "#f87171", "mode": "fixed"}}]},
                {"matcher": {"id": "byName", "options": "Current"}, "properties": [{"id": "displayName", "value": "电池簇实际电流 (Actual Current)"}, {"id": "color", "value": {"fixedColor": "#60a5fa", "mode": "fixed"}}, {"id": "custom.lineWidth", "value": 3}]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # Panel 3.6: 电池簇端电压 (V) 与 SOC (%) 动态演变趋势
    panels.append({
        "id": pid,
        "title": "电池簇端电压与 SOC 荷电状态变化曲线 (Pack Voltage & SOC Trend)",
        "type": "timeseries",
        "gridPos": {"h": 7, "w": 12, "x": 12, "y": 36},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_timeseries_target("battery0/Voltage", "A"),
            flux_timeseries_target("battery0/Soc", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "lineWidth": 2}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "Voltage"}, "properties": [
                    {"id": "displayName", "value": "Pack 端电压 (V)"},
                    {"id": "unit", "value": "volt"},
                    {"id": "custom.axisPlacement", "value": "left"},
                    {"id": "color", "value": {"fixedColor": "#ec4899", "mode": "fixed"}}
                ]},
                {"matcher": {"id": "byName", "options": "Soc"}, "properties": [
                    {"id": "displayName", "value": "Pack SOC (%)"},
                    {"id": "unit", "value": "percent"},
                    {"id": "custom.axisPlacement", "value": "right"},
                    {"id": "color", "value": {"fixedColor": "#a78bfa", "mode": "fixed"}}
                ]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # ----------------------------------------------------
    # SECTION 4: 第四级 - 模组级看板 (Tier 4: 10-Module Voltage & Temperature Distribution)
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 43},
        "id": pid,
        "title": "🧱 第四级: 模组级均衡与温场分布 (Tier 4: 10-Module Voltage & Temperature Distribution)",
        "type": "row"
    })
    pid += 1

    # Panel 4.1: 10个模组实时电压分布 (Bar Gauge)
    mod_v_targets = [flux_target(f"battery0/Module_{m:02d}_Voltage", chr(65 + m), extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))') for m in range(1, 11)]
    mod_v_overrides = [{"matcher": {"id": "byName", "options": f"Module_{m:02d}_Voltage"}, "properties": [{"id": "displayName", "value": f"模组 #{m:02d}"}]} for m in range(1, 11)]
    panels.append({
        "id": pid,
        "title": "10个模组实时电压分布 (Module 01 ~ Module 10 Voltage, 16S 51.2V Nominal)",
        "type": "bargauge",
        "gridPos": {"h": 6, "w": 12, "x": 0, "y": 44},
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
                    {"color": "#5794F2", "value": 54.0},
                    {"color": "red", "value": 55.5}
                ]}
            },
            "overrides": mod_v_overrides
        },
        "options": {
            "displayMode": "gradient",
            "orientation": "horizontal",
            "showUnfilled": True,
            "reduceOptions": {"calcs": ["lastNotNull"], "values": False}
        }
    })
    pid += 1

    # Panel 4.2: 10个模组实时温度分布 (Bar Gauge)
    mod_t_targets = [flux_target(f"battery0/Module_{m:02d}_Temp", chr(65 + m), extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))') for m in range(1, 11)]
    mod_t_overrides = [{"matcher": {"id": "byName", "options": f"Module_{m:02d}_Temp"}, "properties": [{"id": "displayName", "value": f"模组 #{m:02d}"}]} for m in range(1, 11)]
    panels.append({
        "id": pid,
        "title": "10个模组实时温度分布 (Module 01 ~ Module 10 Temperature, °C)",
        "type": "bargauge",
        "gridPos": {"h": 6, "w": 12, "x": 12, "y": 44},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": mod_t_targets,
        "fieldConfig": {
            "defaults": {
                "unit": "celsius",
                "min": 15.0,
                "max": 45.0,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "blue", "value": None},
                    {"color": "green", "value": 20.0},
                    {"color": "yellow", "value": 30.0},
                    {"color": "red", "value": 38.0}
                ]}
            },
            "overrides": mod_t_overrides
        },
        "options": {
            "displayMode": "gradient",
            "orientation": "horizontal",
            "showUnfilled": True,
            "reduceOptions": {"calcs": ["lastNotNull"], "values": False}
        }
    })
    pid += 1

    # Panel 4.3: 模组极值电压与定位
    panels.append({
        "id": pid,
        "title": "模组电压极值与精准定位 (Module Extremes & Localization)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 6, "x": 0, "y": 50},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/MaxModuleVoltage", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("battery0/MaxVoltageModuleNumber", "B"),
            flux_target("battery0/MinModuleVoltage", "C", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("battery0/MinVoltageModuleNumber", "D")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "MaxModuleVoltage"}, "properties": [{"id": "displayName", "value": "最高模组电压"}, {"id": "unit", "value": "volt"}]},
                {"matcher": {"id": "byName", "options": "MaxVoltageModuleNumber"}, "properties": [{"id": "displayName", "value": "最高电压模组编号 (Mod #)"}]},
                {"matcher": {"id": "byName", "options": "MinModuleVoltage"}, "properties": [{"id": "displayName", "value": "最低模组电压"}, {"id": "unit", "value": "volt"}]},
                {"matcher": {"id": "byName", "options": "MinVoltageModuleNumber"}, "properties": [{"id": "displayName", "value": "最低电压模组编号 (Mod #)"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 4.4: 模组极值温度与定位
    panels.append({
        "id": pid,
        "title": "模组温度极值与精准定位 (Module Thermal Extremes)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 6, "x": 6, "y": 50},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/MaxModuleTemperature", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("battery0/MaxTemperatureModuleNumber", "B"),
            flux_target("battery0/MinModuleTemperature", "C", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("battery0/MinTemperatureModuleNumber", "D")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "MaxModuleTemperature"}, "properties": [{"id": "displayName", "value": "最高模组温度"}, {"id": "unit", "value": "celsius"}]},
                {"matcher": {"id": "byName", "options": "MaxTemperatureModuleNumber"}, "properties": [{"id": "displayName", "value": "最高温度模组编号 (Mod #)"}]},
                {"matcher": {"id": "byName", "options": "MinModuleTemperature"}, "properties": [{"id": "displayName", "value": "最低模组温度"}, {"id": "unit", "value": "celsius"}]},
                {"matcher": {"id": "byName", "options": "MinTemperatureModuleNumber"}, "properties": [{"id": "displayName", "value": "最低温度模组编号 (Mod #)"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 4.5: 模组级压差与温差变化趋势
    panels.append({
        "id": pid,
        "title": "模组级压差 ΔV 与温差 ΔT 演变趋势 (Module Delta-V & Delta-T)",
        "type": "timeseries",
        "gridPos": {"h": 4, "w": 12, "x": 12, "y": 50},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_timeseries_target("battery0/ModuleVoltageDelta", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_timeseries_target("battery0/ModuleTemperatureSpread", "B", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))')
        ],
        "fieldConfig": {
            "defaults": {
                "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "lineWidth": 2}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "ModuleVoltageDelta"}, "properties": [
                    {"id": "displayName", "value": "模组最大压差 ΔV (V)"},
                    {"id": "unit", "value": "volt"},
                    {"id": "custom.axisPlacement", "value": "left"},
                    {"id": "color", "value": {"fixedColor": "#f59e0b", "mode": "fixed"}}
                ]},
                {"matcher": {"id": "byName", "options": "ModuleTemperatureSpread"}, "properties": [
                    {"id": "displayName", "value": "模组最大温差 ΔT (°C)"},
                    {"id": "unit", "value": "celsius"},
                    {"id": "custom.axisPlacement", "value": "right"},
                    {"id": "color", "value": {"fixedColor": "#ec4899", "mode": "fixed"}}
                ]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # ----------------------------------------------------
    # SECTION 5: 第五级 - 电芯级单体极值与压差全景 (Tier 5: 160-Cell Matrix, Delta-V & Delta-T)
    # ----------------------------------------------------
    panels.append({
        "collapsed": False,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": 54},
        "id": pid,
        "title": "🔬 第五级: 电芯单体电压矩阵与极值诊断 (Tier 5: 160-Cell Voltage Matrix, Delta-V & Delta-T)",
        "type": "row"
    })
    pid += 1

    # Panel 5.1: 最高单体电压与电芯位置
    panels.append({
        "id": pid,
        "title": "最高单体电压与电芯号 (Max Cell Voltage & Cell #)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 0, "y": 55},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/MaxCellVoltage", "A"),
            flux_target("battery0/MaxVoltageCellNumber", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "MaxCellVoltage"}, "properties": [{"id": "displayName", "value": "最高电压"}, {"id": "unit", "value": "millivolt"}]},
                {"matcher": {"id": "byName", "options": "MaxVoltageCellNumber"}, "properties": [{"id": "displayName", "value": "电芯位置 (Cell #)"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 5.2: 最低单体电压与电芯位置
    panels.append({
        "id": pid,
        "title": "最低单体电压与电芯号 (Min Cell Voltage & Cell #)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 4, "y": 55},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/MinCellVoltage", "A"),
            flux_target("battery0/MinVoltageCellNumber", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "MinCellVoltage"}, "properties": [{"id": "displayName", "value": "最低电压"}, {"id": "unit", "value": "millivolt"}]},
                {"matcher": {"id": "byName", "options": "MinVoltageCellNumber"}, "properties": [{"id": "displayName", "value": "电芯位置 (Cell #)"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 5.3: 单体压差 Delta-V
    panels.append({
        "id": pid,
        "title": "单体最大压差 (Cell Delta-V)",
        "type": "gauge",
        "gridPos": {"h": 4, "w": 4, "x": 8, "y": 55},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("battery0/CellVoltageDelta", "A")],
        "fieldConfig": {
            "defaults": {
                "unit": "millivolt",
                "min": 0,
                "max": 60,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "green", "value": None},
                    {"color": "yellow", "value": 25},
                    {"color": "red", "value": 45}
                ]}
            }
        },
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "values": False}, "showThresholdLabels": True, "showThresholdMarkers": True}
    })
    pid += 1

    # Panel 5.4: 最高单体温度与电芯位置
    panels.append({
        "id": pid,
        "title": "最高单体温度与电芯号 (Max Cell Temp & Cell #)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 12, "y": 55},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/MaxCellTemperature", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("battery0/MaxTemperatureCellNumber", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "MaxCellTemperature"}, "properties": [{"id": "displayName", "value": "最高温度"}, {"id": "unit", "value": "celsius"}]},
                {"matcher": {"id": "byName", "options": "MaxTemperatureCellNumber"}, "properties": [{"id": "displayName", "value": "电芯位置 (Cell #)"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 5.5: 最低单体温度与电芯位置
    panels.append({
        "id": pid,
        "title": "最低单体温度与电芯号 (Min Cell Temp & Cell #)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 4, "x": 16, "y": 55},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/MinCellTemperature", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))'),
            flux_target("battery0/MinTemperatureCellNumber", "B")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "MinCellTemperature"}, "properties": [{"id": "displayName", "value": "最低温度"}, {"id": "unit", "value": "celsius"}]},
                {"matcher": {"id": "byName", "options": "MinTemperatureCellNumber"}, "properties": [{"id": "displayName", "value": "电芯位置 (Cell #)"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
    })
    pid += 1

    # Panel 5.6: 单体温差 Delta-T
    panels.append({
        "id": pid,
        "title": "单体最大温差 (Cell Delta-T)",
        "type": "gauge",
        "gridPos": {"h": 4, "w": 4, "x": 20, "y": 55},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [flux_target("battery0/CellTemperatureSpread", "A", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))')],
        "fieldConfig": {
            "defaults": {
                "unit": "celsius",
                "min": 0,
                "max": 6.0,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "green", "value": None},
                    {"color": "yellow", "value": 2.5},
                    {"color": "red", "value": 4.5}
                ]}
            }
        },
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "values": False}, "showThresholdLabels": True, "showThresholdMarkers": True}
    })
    pid += 1

    # Panel 5.7: 电芯压差 Delta-V 与温差 Delta-T 历史演化趋势
    panels.append({
        "id": pid,
        "title": "电芯单体压差 ΔV (mV) 与温差 ΔT (°C) 历史演变曲线",
        "type": "timeseries",
        "gridPos": {"h": 7, "w": 24, "x": 0, "y": 59},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_timeseries_target("battery0/CellVoltageDelta", "A"),
            flux_timeseries_target("battery0/CellTemperatureSpread", "B", extra_pipe='\n  |> map(fn: (r) => ({ r with _value: float(v: r._value) / 10.0 }))')
        ],
        "fieldConfig": {
            "defaults": {
                "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "lineWidth": 2}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "CellVoltageDelta"}, "properties": [
                    {"id": "displayName", "value": "电芯单体最大压差 ΔV (mV)"},
                    {"id": "unit", "value": "millivolt"},
                    {"id": "custom.axisPlacement", "value": "left"},
                    {"id": "color", "value": {"fixedColor": "#34d399", "mode": "fixed"}}
                ]},
                {"matcher": {"id": "byName", "options": "CellTemperatureSpread"}, "properties": [
                    {"id": "displayName", "value": "电芯单体最大温差 ΔT (°C)"},
                    {"id": "unit", "value": "celsius"},
                    {"id": "custom.axisPlacement", "value": "right"},
                    {"id": "color", "value": {"fixedColor": "#f43f5e", "mode": "fixed"}}
                ]}
            ]
        },
        "options": {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    })
    pid += 1

    # Panel 5.8: 160 颗电芯单体电压全景分布矩阵 (Bar Gauge)
    cell_query = f'''from(bucket: "openems")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r.edge == "${{edge}}")
  |> filter(fn: (r) => r._measurement == "data" and r._field =~ /^battery0\/Cell_[0-9]{{3}}_V$/)
  |> last()'''
    panels.append({
        "id": pid,
        "title": "160颗单体电芯电压全景矩阵 (160-Cell LiFePO4 Voltage Matrix mV, Across 10 Modules)",
        "type": "bargauge",
        "gridPos": {"h": 10, "w": 24, "x": 0, "y": 66},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [{
            "datasource": {"type": "influxdb", "uid": DS_UID},
            "query": cell_query,
            "refId": "A"
        }],
        "fieldConfig": {
            "defaults": {
                "unit": "millivolt",
                "min": 3200,
                "max": 3450,
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [
                    {"color": "red", "value": None},
                    {"color": "yellow", "value": 3250},
                    {"color": "#10b981", "value": 3280},
                    {"color": "#3b82f6", "value": 3340},
                    {"color": "yellow", "value": 3400},
                    {"color": "red", "value": 3440}
                ]}
            }
        },
        "options": {
            "displayMode": "lcd",
            "orientation": "horizontal",
            "showUnfilled": True,
            "reduceOptions": {"calcs": ["lastNotNull"], "values": False}
        }
    })
    pid += 1

    # Panel 5.9: 电芯主动均衡与异常单体体检诊断 (Table / Stat)
    panels.append({
        "id": pid,
        "title": "电芯均衡状态与极值单体健康档案 (Cell Balancing & Outlier Diagnostics)",
        "type": "stat",
        "gridPos": {"h": 4, "w": 24, "x": 0, "y": 76},
        "datasource": {"type": "influxdb", "uid": DS_UID},
        "targets": [
            flux_target("battery0/BalancingState", "A"),
            flux_target("battery0/BalancingActiveCells", "B"),
            flux_target("battery0/MaxVoltageCellNumber", "C"),
            flux_target("battery0/MinVoltageCellNumber", "D"),
            flux_target("battery0/MaxTemperatureCellNumber", "E"),
            flux_target("battery0/MinTemperatureCellNumber", "F")
        ],
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "thresholds"},
                "thresholds": {"mode": "absolute", "steps": [{"color": "green", "value": None}]}
            },
            "overrides": [
                {"matcher": {"id": "byName", "options": "BalancingState"}, "properties": [
                    {"id": "displayName", "value": "均衡控制状态"},
                    {"id": "mappings", "value": [{"type": "value", "options": {"0": {"text": "待机未触发 (IDLE)", "color": "gray"}, "1": {"text": "主动能量转移均衡中 (ACTIVE)", "color": "#10b981"}}}]}
                ]},
                {"matcher": {"id": "byName", "options": "BalancingActiveCells"}, "properties": [{"id": "displayName", "value": "当前均衡旁路电芯数"}]},
                {"matcher": {"id": "byName", "options": "MaxVoltageCellNumber"}, "properties": [{"id": "displayName", "value": "压差偏高单体编号"}]},
                {"matcher": {"id": "byName", "options": "MinVoltageCellNumber"}, "properties": [{"id": "displayName", "value": "压差偏低单体编号"}]},
                {"matcher": {"id": "byName", "options": "MaxTemperatureCellNumber"}, "properties": [{"id": "displayName", "value": "热点单体编号"}]},
                {"matcher": {"id": "byName", "options": "MinTemperatureCellNumber"}, "properties": [{"id": "displayName", "value": "冷点单体编号"}]}
            ]
        },
        "options": {"colorMode": "background", "graphMode": "none", "justifyMode": "center", "orientation": "horizontal", "reduceOptions": {"calcs": ["lastNotNull"], "values": False}}
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
                "tags": ["openems"],
                "targetBlank": False,
                "title": "⚡ 返回智慧微电网与储能调度中心",
                "type": "link",
                "url": "/d/openems-ess-analytics"
            }
        ],
        "liveNow": True,
        "panels": panels,
        "refresh": "5s",
        "schemaVersion": 38,
        "style": "dark",
        "tags": ["openems", "bess", "topology", "bms", "battery", "cell", "module", "pack", "cabinet"],
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
    dest_path = "/var/lib/grafana/dashboards/openems_bess_5tier_topology_dashboard.json"
    repo_path = "/home/user01/local/openems/scripts/openems_bess_5tier_topology_dashboard.json"
    
    with open(repo_path, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    print(f"Generated dashboard JSON at {repo_path}")

    # Copy to /var/lib/grafana/dashboards
    os.system(f"sudo cp {repo_path} {dest_path} && sudo chmod 644 {dest_path}")
    print(f"Copied to provisioning directory: {dest_path}")

    # Also POST directly to Grafana API
    api_payload = json.dumps({"dashboard": db, "overwrite": True}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:3000/api/dashboards/db",
        data=api_payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Basic " + "YWRtaW46YWRtaW4="  # admin:admin
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
