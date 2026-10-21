#!/usr/bin/env python3
"""
OpenEMS Live Feeder & Multi-Station Fleet Microgrid Daemon
Manages real-time continuous telemetry and WebSocket gateway connections
for all 5 microgrid / ESS stations:
  • edge0 (tag=0): 500kW/1000kWh 园区光储充一体化微电网 (C&I Solar-Storage-EV)
  • edge1 (tag=1): 1000kW/2000kWh 重工业削峰填谷储能电站 (Heavy Industrial Peak-Shaving ESS)
  • edge2 (tag=2): 2000kW/4000kWh 电网侧独立调频储能电站 (Utility Frequency Regulation ESS)
  • edge3 (tag=3): 200kW/400kWh 商业综合体光储直柔虚拟电厂 (Commercial Plaza & Hotel VPP Station)
  • edge4 (tag=4): 100kW/250kWh 海岛多能互补离网微电网 (Island Multi-Energy Off-Grid Microgrid)

Multi-Domain Simulation Data Sources:
  • Meteorological & Solar Irradiance (GHI, Ambient Temp, PV Cell Temp, Cloud Cover, Wind Speed)
  • Dynamic Electricity Spot Market Tariff (Spot Price CNY/kWh, Ancillary Capacity Price, Carbon Factor)
  • Battery BMS Cell-Level Health Matrix (Cell V Delta, Temp Spread, SOH, Cycle Count, Insulation)
  • Sub-Circuit Load Disaggregation (HVAC Chiller, Workshop Machinery, Lighting & Aux, IT/UPS)
  • Grid Power Quality (Frequency, 3-Phase Voltages, Power Factor, Reactive Power)
"""

import sys
import time
import math
import random
import json
import asyncio
import urllib.request
import urllib.error
from datetime import datetime, timezone

INFLUX_WRITE_URL = "http://127.0.0.1:8086/api/v2/write?bucket=openems&org=openems&precision=s"
INFLUX_QUERY_URL = "http://127.0.0.1:8086/api/v2/query?org=openems"
AUTH_TOKEN = "OpenEmsInfluxSecretToken2026!"
BACKEND_WS_URL = "ws://127.0.0.1:8084"
FEED_INTERVAL = 5.0  # seconds

# Station EdgeConfigs for Backend Gateway Registration
EDGE_CONFIGS = {
    "edge1": {
        "components": {
            "_sum": {"alias": "重工业削峰填谷储能微网总能流", "factoryId": "Core.Sum", "properties": {}, "channels": {}},
            "ess0": {"alias": "1000kW/2000kWh 工业高压储能系统", "factoryId": "Ess.Generic.ManagedSymmetric", "properties": {"capacity": 2000000, "maxApparentPower": 1000000, "maxChargePower": 1000000, "maxDischargePower": 1000000}, "channels": {}},
            "meter0": {"alias": "工业配电10kV主进线电表", "factoryId": "Meter.Socomec.Threephase", "properties": {"type": "GRID"}, "channels": {}},
            "meter2": {"alias": "工业冷暖暖通设备电表 (Chiller Plant)", "factoryId": "Meter.Chint.DTSU666", "properties": {"type": "CONSUMPTION_METERED"}, "channels": {}},
            "meter3": {"alias": "重型制造车间主产线电表 (Machinery Line)", "factoryId": "Meter.Chint.DTSU666", "properties": {"type": "CONSUMPTION_METERED"}, "channels": {}},
            "meter4": {"alias": "洁净厂区照明动力辅助电表 (Lighting & Aux)", "factoryId": "Meter.Socomec.Threephase", "properties": {"type": "CONSUMPTION_METERED"}, "channels": {}},
            "meter_hvac": {"alias": "工业冷暖暖通设备电表", "factoryId": "Meter.Chint.DTSU666", "properties": {"type": "CONSUMPTION_METERED"}, "channels": {}},
            "meter_production": {"alias": "重型制造车间主产线电表", "factoryId": "Meter.Chint.DTSU666", "properties": {"type": "CONSUMPTION_METERED"}, "channels": {}},
            "meter_lighting": {"alias": "厂区照明泛光电表", "factoryId": "Meter.Chint.DTSU666", "properties": {"type": "CONSUMPTION_METERED"}, "channels": {}},
            "meter_datacenter": {"alias": "工业中控与算力中心电表", "factoryId": "Meter.Chint.DTSU666", "properties": {"type": "CONSUMPTION_METERED"}, "channels": {}},
            "battery0": {"alias": "磷酸铁锂电池管理系统 (BMS)", "factoryId": "Battery.Generic", "properties": {"enabled": True}, "channels": {}},
            "weather0": {"alias": "工业园区气象监测站", "factoryId": "Weather.OpenMeteo", "properties": {"enabled": True}, "channels": {}},
            "timeOfUseTariff0": {"alias": "高耗能行业分时电价接口", "factoryId": "TimeOfUseTariff.Awattar", "properties": {"enabled": True, "zone": "GERMANY"}, "channels": {}},
            "ctrlBalancing0": {"alias": "工业微网自发自用与防逆流控制器", "factoryId": "Controller.Symmetric.Balancing", "properties": {"targetGridSetpoint": 0}, "channels": {}},
            "ctrlPeakShaving0": {"alias": "需量控制与削峰填谷控制器", "factoryId": "Controller.Symmetric.PeakShaving", "properties": {"enabled": True, "ess.id": "ess0", "meter.id": "meter0", "peakShavingPower": 750000, "rechargePower": 400000}, "channels": {}}
        },
        "factories": {}
    },
    "edge2": {
        "components": {
            "_sum": {"alias": "电网侧独立调频储能电站汇流", "factoryId": "Core.Sum", "properties": {}, "channels": {}},
            "ess0": {"alias": "2000kW/4000kWh 构网型高倍率储能系统", "factoryId": "Ess.Generic.ManagedSymmetric", "properties": {"capacity": 4000000, "maxApparentPower": 2000000}, "channels": {}},
            "meter0": {"alias": "35kV 升压变并网计量主表", "factoryId": "Meter.Socomec.Threephase", "properties": {}, "channels": {}},
            "meter_hvac": {"alias": "变电站站用空调暖通电表", "factoryId": "Meter.Chint.DTSU666", "properties": {}, "channels": {}},
            "battery0": {"alias": "集中式液冷电池管理系统 (BMS)", "factoryId": "Battery.Generic", "properties": {}, "channels": {}},
            "weather0": {"alias": "变电站环境微气象仪", "factoryId": "Weather.OpenMeteo", "properties": {}, "channels": {}},
            "timeOfUseTariff0": {"alias": "区域电网辅助服务补偿电价", "factoryId": "TimeOfUseTariff.Awattar", "properties": {}, "channels": {}},
            "ctrlFastFrequencyReserve0": {"alias": "一次调频毫秒级有功响应控制器", "factoryId": "Controller.Ess.FastFrequencyReserve", "properties": {}, "channels": {}},
            "ctrlFixActivePower0": {"alias": "电网调度AGC远程控制接口", "factoryId": "Controller.Ess.FixActivePower", "properties": {}, "channels": {}}
        },
        "factories": {}
    },
    "edge3": {
        "components": {
            "_sum": {"alias": "商业综合体微电网总能流", "factoryId": "Core.Sum", "properties": {}, "channels": {}},
            "ess0": {"alias": "200kW/400kWh 分布式户外柜储能", "factoryId": "Ess.Generic.ManagedSymmetric", "properties": {"capacity": 400000, "maxApparentPower": 200000}, "channels": {}},
            "meter0": {"alias": "综合体市电主供电计量表", "factoryId": "Meter.Socomec.Threephase", "properties": {}, "channels": {}},
            "meter1": {"alias": "150kW 光伏建筑一体化(BIPV)发电计量", "factoryId": "Meter.ABB.B23", "properties": {}, "channels": {}},
            "meter_hvac": {"alias": "商场中央空调冷冻水机房电表", "factoryId": "Meter.Chint.DTSU666", "properties": {}, "channels": {}},
            "meter_lighting": {"alias": "商场照明泛光与公区照明电表", "factoryId": "Meter.Chint.DTSU666", "properties": {}, "channels": {}},
            "evcs0": {"alias": "60kW 商用直流充电快充桩", "factoryId": "Simulator.Evcs", "properties": {"maxHwPower": 60000, "minHwPower": 0}, "channels": {}},
            "battery0": {"alias": "智能配电储能BMS系统", "factoryId": "Battery.Generic", "properties": {}, "channels": {}},
            "weather0": {"alias": "BIPV屋顶微气象环境站", "factoryId": "Weather.OpenMeteo", "properties": {}, "channels": {}},
            "timeOfUseTariff0": {"alias": "商业高峰谷价差实时接口", "factoryId": "TimeOfUseTariff.Awattar", "properties": {}, "channels": {}},
            "ctrlBalancing0": {"alias": "自发自用与需量控制协同器", "factoryId": "Controller.Symmetric.Balancing", "properties": {"targetGridSetpoint": 0}, "channels": {}},
            "ctrlEvcs0": {"alias": "商用充电桩有序充电管理控制器", "factoryId": "Controller.Evcs", "properties": {}, "channels": {}}
        },
        "factories": {}
    },
    "edge4": {
        "components": {
            "_sum": {"alias": "海岛多能互补离网微电网总能流", "factoryId": "Core.Sum", "properties": {}, "channels": {}},
            "ess0": {"alias": "100kW/250kWh 构网型耐盐雾储能主逆变器", "factoryId": "Ess.Generic.ManagedSymmetric", "properties": {"capacity": 250000, "maxApparentPower": 100000}, "channels": {}},
            "meter0": {"alias": "微电网交流母线联络总表", "factoryId": "Meter.Socomec.Threephase", "properties": {}, "channels": {}},
            "meter1": {"alias": "120kW 海岛分布式光伏阵列电表", "factoryId": "Meter.Fronius", "properties": {}, "channels": {}},
            "meter2": {"alias": "50kW 应急备用柴油发电机计量表", "factoryId": "Meter.Janitza.UMG96", "properties": {}, "channels": {}},
            "meter_production": {"alias": "海岛海水淡化增压泵站电表", "factoryId": "Meter.Chint.DTSU666", "properties": {}, "channels": {}},
            "battery0": {"alias": "海岛高等级防护磷酸铁锂BMS", "factoryId": "Battery.Generic", "properties": {}, "channels": {}},
            "weather0": {"alias": "海岛海洋气象与日照观测仪", "factoryId": "Weather.OpenMeteo", "properties": {}, "channels": {}},
            "ctrlAcIsland0": {"alias": "离网电压源与孤岛运行控制器", "factoryId": "Controller.Ess.AcIsland", "properties": {}, "channels": {}}
        },
        "factories": {}
    }
}

class StationLiveSimulator:
    def __init__(self, edge_id, edge_tag, capacity_wh, max_power_w, pv_peak_w, load_base_w, load_peak_w, station_type="solar_storage_ev"):
        self.edge_id = edge_id
        self.edge_tag = edge_tag
        self.capacity_wh = capacity_wh
        self.max_power_w = max_power_w
        self.pv_peak_w = pv_peak_w
        self.load_base_w = load_base_w
        self.load_peak_w = load_peak_w
        self.station_type = station_type

        # Cumulative Energy counters
        self.consumption_energy = 0
        self.production_energy = 0
        self.grid_buy_energy = 0
        self.grid_sell_energy = 0
        self.ess_charge_energy = 0
        self.ess_discharge_energy = 0
        self.evcs_energy = 0
        self.genset_energy = 0

        self.hvac_energy = 0
        self.machinery_energy = 0
        self.lighting_energy = 0
        self.datacenter_energy = 0

        self.current_soc = 55.0 if station_type != "utility_fcr" else 50.0
        self.rpc_completed = 15000 + edge_tag * 6000
        self.last_ts = time.time()

    def load_latest_from_influx(self):
        """Query last known values from InfluxDB to guarantee continuity."""
        q = f'''
        from(bucket: "openems")
          |> range(start: -2d)
          |> filter(fn: (r) => r.edge == "{self.edge_tag}")
          |> filter(fn: (r) => r._measurement == "data")
          |> last()
        '''
        req = urllib.request.Request(
            INFLUX_QUERY_URL,
            data=q.encode("utf-8"),
            headers={"Authorization": f"Token {AUTH_TOKEN}", "Content-Type": "application/vnd.flux"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req) as resp:
                lines = resp.read().decode("utf-8").strip().split("\n")
                field_map = {}
                for line in lines:
                    if line and not line.startswith("#"):
                        parts = line.split(",")
                        if len(parts) >= 8:
                            field_name = parts[7]
                            val_str = parts[6]
                            try:
                                field_map[field_name] = int(val_str)
                            except:
                                pass
                if "_sum/ConsumptionActiveEnergy" in field_map:
                    self.consumption_energy = field_map["_sum/ConsumptionActiveEnergy"]
                    self.production_energy = field_map.get("_sum/ProductionActiveEnergy", 0)
                    self.grid_buy_energy = field_map.get("_sum/GridBuyActiveEnergy", 0)
                    self.grid_sell_energy = field_map.get("_sum/GridSellActiveEnergy", 0)
                    self.ess_charge_energy = field_map.get("_sum/EssActiveChargeEnergy", 0)
                    self.ess_discharge_energy = field_map.get("_sum/EssActiveDischargeEnergy", 0)
                    self.evcs_energy = field_map.get("evcs0/ActiveConsumptionEnergy", 0)
                    self.genset_energy = field_map.get("meter2/ActiveProductionEnergy", 0)
                    self.hvac_energy = field_map.get("meter_hvac/ActiveConsumptionEnergy", int(self.consumption_energy * 0.30))
                    self.machinery_energy = field_map.get("meter_production/ActiveConsumptionEnergy", int(self.consumption_energy * 0.45))
                    self.lighting_energy = field_map.get("meter_lighting/ActiveConsumptionEnergy", int(self.consumption_energy * 0.15))
                    self.datacenter_energy = field_map.get("meter_datacenter/ActiveConsumptionEnergy", int(self.consumption_energy * 0.10))
                    self.current_soc = float(field_map.get("_sum/EssSoc", 55))
                    self.rpc_completed = field_map.get("coreJsonRpcRequestHandler0/Completed", 15000)
                    print(f"[{self.edge_id}] Baseline loaded: Consumption={self.consumption_energy/1e6:.2f}MWh, SOC={self.current_soc:.1f}%", flush=True)
                    return
        except Exception as e:
            print(f"[{self.edge_id}] Could not load baseline from InfluxDB: {e}. Initializing synthetic baseline.", flush=True)

        base_m = (self.capacity_wh / 1_000_000.0)
        self.consumption_energy = int(180_000_000 * base_m)
        self.production_energy = int(110_000_000 * (self.pv_peak_w / 400_000.0)) if self.pv_peak_w > 0 else 0
        self.grid_buy_energy = int(120_000_000 * base_m)
        self.grid_sell_energy = int(25_000_000 * (self.pv_peak_w / 400_000.0)) if self.pv_peak_w > 0 else 0
        self.ess_charge_energy = int(55_000_000 * base_m)
        self.ess_discharge_energy = int(52_000_000 * base_m)
        self.evcs_energy = int(32_000_000) if self.station_type in ["solar_storage_ev", "commercial_vpp"] else 0
        self.genset_energy = int(18_000_000) if self.station_type == "island_offgrid" else 0
        self.hvac_energy = int(self.consumption_energy * 0.30)
        self.machinery_energy = int(self.consumption_energy * 0.45)
        self.lighting_energy = int(self.consumption_energy * 0.15)
        self.datacenter_energy = int(self.consumption_energy * 0.10)

    def step_simulation(self, now_ts):
        dt = datetime.fromtimestamp(now_ts, tz=timezone.utc)
        hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
        is_weekend = (dt.weekday() >= 5)
        dt_hours = (now_ts - self.last_ts) / 3600.0
        self.last_ts = now_ts
        if dt_hours <= 0 or dt_hours > 0.1:
            dt_hours = FEED_INTERVAL / 3600.0

        # 1. Meteorological / Weather Data Source
        if 6.0 <= hour <= 18.5:
            rel_pos = (hour - 6.0) / 12.5
            solar_zenith = math.sin(rel_pos * math.pi)
            solar_irr = int(max(0.0, 950.0 * (solar_zenith ** 1.3)) + random.randint(-15, 15))
            cloud_cover = int(max(5.0, min(95.0, 15.0 + 10.0 * math.sin(hour * 0.6) + random.uniform(-3, 3))))
        else:
            solar_irr = 0
            cloud_cover = 20

        amb_temp = int((20.0 + 6.0 * math.sin((hour - 9.0) * math.pi / 12.0)) * 10.0 + random.randint(-3, 3))
        pv_temp = amb_temp + int((solar_irr / 800.0) * 250.0)
        wind_speed = int((3.5 + 1.5 * math.sin(hour * 0.5)) * 10.0 + random.randint(-4, 4))

        # Solar PV Generation
        if self.pv_peak_w > 0 and 6.25 <= hour <= 18.75:
            norm_h = (hour - 6.25) / (18.75 - 6.25)
            pv_curve = math.sin(math.pi * norm_h) ** 1.3
            p_pv = int(self.pv_peak_w * pv_curve * random.uniform(0.97, 1.03))
        else:
            p_pv = 0

        # 2. Dynamic Electricity Spot Market Tariff
        if 0.0 <= hour < 6.0: spot_price = 280 + random.randint(-15, 15)
        elif 6.0 <= hour < 8.5: spot_price = 650 + random.randint(-25, 25)
        elif 8.5 <= hour < 11.5: spot_price = 1250 + random.randint(-45, 45)
        elif 11.5 <= hour < 13.5: spot_price = 450 + random.randint(-30, 30)
        elif 13.5 <= hour < 18.0: spot_price = 720 + random.randint(-35, 35)
        elif 18.0 <= hour < 21.0: spot_price = 1550 + random.randint(-55, 55)
        else: spot_price = 600 + random.randint(-25, 25)

        ancillary_price = int((18.5 + 12.0 * math.sin(hour * 0.4)) * 100.0 + random.randint(-80, 80))
        carbon_intensity = int(550.0 - 160.0 * math.sin((hour - 6.0) * math.pi / 12.0)) if 6.0 <= hour <= 18.0 else (680 + random.randint(-20, 20))

        # 3. Load & Strategy by Station Type
        p_genset = 0
        p_evcs = 0
        grid_mode = 1

        if self.station_type == "solar_storage_ev":
            if is_weekend: l_factor = 0.35 + 0.15 * math.sin(math.pi * hour / 24.0)
            else:
                if hour < 6.5: l_factor = 0.25 + 0.03 * math.sin(now_ts / 20.0)
                elif hour < 8.5: l_factor = 0.25 + ((hour - 6.5) / 2.0) * 0.55
                elif hour < 11.5: l_factor = 0.85 + 0.10 * math.sin(math.pi * (hour - 8.5) / 3.0)
                elif hour < 13.5: l_factor = 0.55 + 0.06 * math.sin(now_ts / 15.0)
                elif hour < 17.5: l_factor = 0.90 + 0.08 * math.sin(math.pi * (hour - 13.5) / 4.0)
                elif hour < 20.5: l_factor = 0.70 + 0.08 * math.sin(math.pi * (hour - 17.5) / 3.0)
                else: l_factor = 0.25 + ((24.0 - hour) / 3.5) * 0.40
            p_load = int(self.load_base_w + (self.load_peak_w - self.load_base_w) * l_factor * random.uniform(0.98, 1.02))

            if not is_weekend and (7.5 <= hour < 9.5 or 17.0 <= hour < 20.0):
                p_evcs = int(random.choice([60000, 90000, 115000]) * random.uniform(0.95, 1.0))
            elif 12.0 <= hour < 13.5:
                p_evcs = int(random.choice([40000, 60000, 80000]) * random.uniform(0.95, 1.0))
            p_consumption = p_load + p_evcs

            p_ess = 0
            if 0.5 <= hour < 5.5:
                p_ess = -int(self.max_power_w * 0.55 * random.uniform(0.97, 1.0)) if self.current_soc < 94.0 else 0
            elif 8.5 <= hour < 11.5:
                needed = p_consumption - p_pv - int(self.load_base_w * 1.1)
                p_ess = min(self.max_power_w, max(0, needed)) if self.current_soc > 22.0 else 0
            elif 11.5 <= hour < 14.0:
                if p_pv > p_consumption:
                    p_ess = -min(self.max_power_w, p_pv - p_consumption) if self.current_soc < 85.0 else 0
                else:
                    p_ess = -int(self.max_power_w * 0.35) if self.current_soc < 70.0 else 0
            elif 18.0 <= hour < 21.0:
                needed = p_consumption - int(self.load_base_w * 0.9)
                p_ess = min(self.max_power_w, max(0, needed)) if self.current_soc > 18.0 else 0
            else:
                diff = p_consumption - p_pv
                if diff > 0 and self.current_soc > 35.0: p_ess = min(int(self.max_power_w * 0.15), diff)
                elif diff < 0 and self.current_soc < 90.0: p_ess = max(-int(self.max_power_w * 0.15), diff)

        elif self.station_type == "heavy_industrial":
            pulse = math.sin(hour * 4.0) * 0.15 + (0.2 if 8.0 <= hour <= 20.0 else 0.0)
            base_fac = 0.55 if not is_weekend else 0.35
            p_load = int(self.load_base_w + (self.load_peak_w - self.load_base_w) * (base_fac + pulse) * random.uniform(0.95, 1.05))
            p_consumption = p_load
            demand_limit = 750_000
            if p_consumption > demand_limit and self.current_soc > 15.0:
                p_ess = min(self.max_power_w, p_consumption - demand_limit)
            elif hour < 6.0 and self.current_soc < 92.0:
                p_ess = -int(self.max_power_w * 0.50)
            elif 12.0 <= hour < 14.0 and self.current_soc < 65.0:
                p_ess = -int(self.max_power_w * 0.30)
            else:
                p_ess = 0

        elif self.station_type == "utility_fcr":
            p_load = int(self.load_base_w * random.uniform(0.97, 1.03))
            p_consumption = p_load
            freq_offset = math.sin(now_ts / 15.0) * 0.04 + random.uniform(-0.02, 0.02)
            p_fcr = -int((freq_offset / 0.10) * self.max_power_w * 0.85)
            soc_bias = (50.0 - self.current_soc) * (self.max_power_w * 0.01)
            p_ess = max(-self.max_power_w, min(self.max_power_w, p_fcr - int(soc_bias)))

        elif self.station_type == "commercial_vpp":
            if hour < 7.0: l_fac = 0.25
            elif hour < 10.0: l_fac = 0.50
            elif hour < 14.0: l_fac = 0.85
            elif hour < 17.0: l_fac = 0.70
            elif hour < 22.0: l_fac = 0.95
            else: l_fac = 0.35
            p_load = int(self.load_base_w + (self.load_peak_w - self.load_base_w) * l_fac * random.uniform(0.98, 1.02))
            p_evcs = int(random.choice([20000, 45000, 60000]) * random.uniform(0.92, 1.0)) if 11.0 <= hour <= 21.0 else 0
            p_consumption = p_load + p_evcs

            p_ess = 0
            if hour < 6.0 and self.current_soc < 95.0: p_ess = -int(self.max_power_w * 0.65)
            elif 11.0 <= hour < 13.0 and self.current_soc < 80.0: p_ess = -int(self.max_power_w * 0.40)
            elif 18.0 <= hour < 21.5 and self.current_soc > 20.0: p_ess = int(self.max_power_w * 0.80)
            else:
                diff = p_consumption - p_pv
                if diff > 0 and self.current_soc > 40.0: p_ess = min(int(self.max_power_w * 0.20), diff)

        elif self.station_type == "island_offgrid":
            grid_mode = 2
            l_factor = 0.35 + 0.30 * math.sin(math.pi * hour / 24.0) + (0.35 if 18.0 <= hour <= 22.0 else 0.0)
            p_load = int(self.load_base_w + (self.load_peak_w - self.load_base_w) * l_factor * random.uniform(0.96, 1.04))
            p_consumption = p_load

            if self.current_soc < 22.0:
                p_genset = 45000
                surplus = p_genset + p_pv - p_consumption
                p_ess = -surplus
            elif self.current_soc > 80.0 and p_genset > 0:
                p_genset = 0
                p_ess = p_consumption - p_pv
            else:
                p_genset = 0
                p_ess = p_consumption - p_pv

        # Battery SOC update
        delta_soc = -(p_ess * dt_hours / self.capacity_wh) * 100.0 * (0.96 if p_ess < 0 else 1.04)
        self.current_soc = max(10.0, min(98.0, self.current_soc + delta_soc))

        # Physical Grid Balance (Exact)
        if self.station_type == "island_offgrid":
            p_grid = 0
        else:
            p_grid = p_consumption - p_pv - p_ess

        # Three-phase
        p_load_l1, p_load_l2, p_load_l3 = (int(p_consumption * 0.328), int(p_consumption * 0.342), p_consumption - int(p_consumption * 0.328) - int(p_consumption * 0.342))
        p_pv_l1, p_pv_l2, p_pv_l3 = (int(p_pv * 0.333), int(p_pv * 0.334), p_pv - int(p_pv * 0.333) - int(p_pv * 0.334))
        p_ess_l1, p_ess_l2, p_ess_l3 = (int(p_ess * 0.333), int(p_ess * 0.334), p_ess - int(p_ess * 0.333) - int(p_ess * 0.334))
        p_grid_l1 = p_load_l1 - p_pv_l1 - p_ess_l1
        p_grid_l2 = p_load_l2 - p_pv_l2 - p_ess_l2
        p_grid_l3 = p_load_l3 - p_pv_l3 - p_ess_l3

        # Sub-branch End-Use Disaggregation (Sum == p_load)
        if self.station_type in ["solar_storage_ev", "commercial_vpp"]:
            p_hvac = int(p_load * (0.32 + 0.12 * math.sin((hour - 8.0) * math.pi / 10.0) if 8.0 <= hour <= 19.0 else 0.18))
            p_lighting = int(p_load * (0.20 if 7.0 <= hour <= 22.0 else 0.08))
            p_datacenter = int(p_load * 0.12)
            p_machinery = p_load - p_hvac - p_lighting - p_datacenter
        elif self.station_type == "heavy_industrial":
            p_machinery = int(p_load * 0.72)
            p_hvac = int(p_load * 0.14)
            p_lighting = int(p_load * 0.08)
            p_datacenter = p_load - p_machinery - p_hvac - p_lighting
        else:
            p_machinery = int(p_load * 0.35)
            p_hvac = int(p_load * 0.35)
            p_lighting = int(p_load * 0.20)
            p_datacenter = p_load - p_machinery - p_hvac - p_lighting

        # Energy Counters
        self.consumption_energy += int(p_consumption * dt_hours)
        self.production_energy += int(p_pv * dt_hours)
        if p_grid > 0: self.grid_buy_energy += int(p_grid * dt_hours)
        else: self.grid_sell_energy += int(-p_grid * dt_hours)
        if p_ess > 0: self.ess_discharge_energy += int(p_ess * dt_hours)
        else: self.ess_charge_energy += int(-p_ess * dt_hours)
        if p_evcs > 0: self.evcs_energy += int(p_evcs * dt_hours)
        if p_genset > 0: self.genset_energy += int(p_genset * dt_hours)

        self.hvac_energy += int(p_hvac * dt_hours)
        self.machinery_energy += int(p_machinery * dt_hours)
        self.lighting_energy += int(p_lighting * dt_hours)
        self.datacenter_energy += int(p_datacenter * dt_hours)

        soc_int = int(round(self.current_soc))
        self.rpc_completed += 1

        # BMS Telemetry & Diagnostics
        v_mult = 1.0 if self.capacity_wh <= 500_000 else (1.8 if self.capacity_wh <= 1_500_000 else 2.5)
        bms_pack_v = int((740_000 + (self.current_soc - 50.0) * 1200) * v_mult)
        bms_pack_i = int(-p_ess / (bms_pack_v / 1000.0) * 1000)
        bms_min_cell_v = int(3150 + self.current_soc * 2.6)
        bms_max_cell_v = bms_min_cell_v + 18 + int((abs(p_ess) / self.max_power_w) * 15)
        bms_min_cell_t = int(220 + (abs(p_ess) / self.max_power_w) * 55)
        bms_max_cell_t = bms_min_cell_t + 16 + int((abs(p_ess) / self.max_power_w) * 10)
        cell_delta_v = bms_max_cell_v - bms_min_cell_v
        cell_temp_spread = bms_max_cell_t - bms_min_cell_t
        cycle_count = 120 + int(self.ess_discharge_energy / self.capacity_wh)
        insulation_res = 8500 + random.randint(-100, 100)

        # Grid measurements & Power quality
        freq = 50000 + random.randint(-20, 20)
        v_l1 = 230000 + random.randint(-800, 800)
        v_l2 = 231000 + random.randint(-800, 800)
        v_l3 = 229500 + random.randint(-800, 800)
        v_avg = int((v_l1 + v_l2 + v_l3) / 3)
        curr_grid_l1 = int(abs(p_grid_l1) / (v_l1 / 1000.0) * 1000)
        curr_grid_l2 = int(abs(p_grid_l2) / (v_l2 / 1000.0) * 1000)
        curr_grid_l3 = int(abs(p_grid_l3) / (v_l3 / 1000.0) * 1000)
        curr_grid_tot = curr_grid_l1 + curr_grid_l2 + curr_grid_l3
        pf = 965 + random.randint(-10, 10)
        tan_phi = math.tan(math.acos(pf / 1000.0))
        q_grid = int(p_grid * tan_phi)

        # ESS AC Currents
        curr_ess_l1 = int(abs(p_ess_l1) / (v_l1 / 1000.0) * 1000) if p_ess != 0 else 0
        curr_ess_l2 = int(abs(p_ess_l2) / (v_l2 / 1000.0) * 1000) if p_ess != 0 else 0
        curr_ess_l3 = int(abs(p_ess_l3) / (v_l3 / 1000.0) * 1000) if p_ess != 0 else 0
        curr_ess_tot = curr_ess_l1 + curr_ess_l2 + curr_ess_l3

        channel_data = {
            "_sum/State": 0,
            "_sum/GridMode": grid_mode,
            "_sum/EssCapacity": self.capacity_wh,
            "_sum/EssSoc": soc_int,
            "_sum/EssActivePower": p_ess,
            "_sum/EssActivePowerL1": p_ess_l1,
            "_sum/EssActivePowerL2": p_ess_l2,
            "_sum/EssActivePowerL3": p_ess_l3,
            "_sum/GridActivePower": p_grid,
            "_sum/GridActivePowerL1": p_grid_l1,
            "_sum/GridActivePowerL2": p_grid_l2,
            "_sum/GridActivePowerL3": p_grid_l3,
            "_sum/ProductionActivePower": p_pv,
            "_sum/ProductionAcActivePower": p_pv,
            "_sum/ProductionAcActivePowerL1": p_pv_l1,
            "_sum/ProductionAcActivePowerL2": p_pv_l2,
            "_sum/ProductionAcActivePowerL3": p_pv_l3,
            "_sum/ProductionDcActualPower": 0,
            "_sum/ConsumptionActivePower": p_consumption,
            "_sum/ConsumptionActivePowerL1": p_load_l1,
            "_sum/ConsumptionActivePowerL2": p_load_l2,
            "_sum/ConsumptionActivePowerL3": p_load_l3,
            "_sum/ConsumptionActiveEnergy": self.consumption_energy,
            "_sum/ProductionActiveEnergy": self.production_energy,
            "_sum/ProductionAcActiveEnergy": self.production_energy,
            "_sum/GridBuyActiveEnergy": self.grid_buy_energy,
            "_sum/GridSellActiveEnergy": self.grid_sell_energy,
            "_sum/EssActiveChargeEnergy": self.ess_charge_energy,
            "_sum/EssActiveDischargeEnergy": self.ess_discharge_energy,
            "_sum/EssDcChargeEnergy": self.ess_charge_energy,
            "_sum/EssDcDischargeEnergy": self.ess_discharge_energy,
            
            # ess0 (AC & DC storage metrics)
            "ess0/State": 0,
            "ess0/Soc": soc_int,
            "ess0/Capacity": self.capacity_wh,
            "ess0/ActivePower": p_ess,
            "ess0/ActivePowerL1": p_ess_l1,
            "ess0/ActivePowerL2": p_ess_l2,
            "ess0/ActivePowerL3": p_ess_l3,
            "ess0/MaxApparentPower": self.max_power_w,
            "ess0/AllowedChargePower": -self.max_power_w,
            "ess0/AllowedDischargePower": self.max_power_w,
            "ess0/ActiveChargeEnergy": self.ess_charge_energy,
            "ess0/ActiveDischargeEnergy": self.ess_discharge_energy,
            "ess0/GridMode": grid_mode,
            "ess0/Voltage": v_avg,
            "ess0/VoltageL1": v_l1,
            "ess0/VoltageL2": v_l2,
            "ess0/VoltageL3": v_l3,
            "ess0/Current": curr_ess_tot,
            "ess0/CurrentL1": curr_ess_l1,
            "ess0/CurrentL2": curr_ess_l2,
            "ess0/CurrentL3": curr_ess_l3,
            "ess0/MinCellVoltage": bms_min_cell_v,
            "ess0/MaxCellVoltage": bms_max_cell_v,
            
            # meter0 (Grid Meter with complete 3-phase Voltage and Current)
            "meter0/State": 0,
            "meter0/ActivePower": p_grid,
            "meter0/ActivePowerL1": p_grid_l1,
            "meter0/ActivePowerL2": p_grid_l2,
            "meter0/ActivePowerL3": p_grid_l3,
            "meter0/ActiveConsumptionEnergy": self.grid_buy_energy,
            "meter0/ActiveProductionEnergy": self.grid_sell_energy,
            "meter0/Voltage": v_avg,
            "meter0/VoltageL1": v_l1,
            "meter0/VoltageL2": v_l2,
            "meter0/VoltageL3": v_l3,
            "meter0/Current": curr_grid_tot,
            "meter0/CurrentL1": curr_grid_l1,
            "meter0/CurrentL2": curr_grid_l2,
            "meter0/CurrentL3": curr_grid_l3,
            "meter0/Frequency": freq,
            "meter0/PowerFactor": pf,
            "meter0/ReactivePower": q_grid,
            
            # battery0 (BMS Extended 5-Tier Data Model)
            "battery0/State": 0,
            "battery0/Soc": soc_int,
            "battery0/Soh": 98,
            "battery0/Voltage": int(round(bms_pack_v / 1000.0)) if bms_pack_v > 2000 else bms_pack_v,
            "battery0/Current": int(round(bms_pack_i / 1000.0)) if abs(bms_pack_i) > 500 else bms_pack_i,
            "battery0/MinCellVoltage": bms_min_cell_v,
            "battery0/MaxCellVoltage": bms_max_cell_v,
            "battery0/MaxVoltageCellNumber": 14,
            "battery0/MinVoltageCellNumber": 3,
            "battery0/MinCellTemperature": bms_min_cell_t,
            "battery0/MaxCellTemperature": bms_max_cell_t,
            "battery0/MaxTemperatureCellNumber": 8,
            "battery0/MinTemperatureCellNumber": 1,
            "battery0/CellVoltageDelta": cell_delta_v,
            "battery0/CellTemperatureSpread": cell_temp_spread,
            "battery0/CycleCount": cycle_count,
            "battery0/RemainingCapacity": int((soc_int / 100.0) * self.capacity_wh),
            "battery0/DailyChargeEnergy": self.ess_charge_energy,
            "battery0/DailyDischargeEnergy": self.ess_discharge_energy,
            "battery0/TotalChargeEnergy": self.ess_charge_energy * 10,
            "battery0/TotalDischargeEnergy": self.ess_discharge_energy * 10,
            "battery0/ChargeMaxVoltage": 5475,
            "battery0/DischargeMinVoltage": 4350,
            "battery0/ChargeMaxCurrent": 120,
            "battery0/DischargeMaxCurrent": 140,
            "battery0/InsulationResistance": insulation_res,
            "battery0/BalancingActiveCells": 3 if cell_delta_v > 20 else 0,
            "battery0/BalancingState": 1 if cell_delta_v > 20 else 0,

            # Module Level Extremes (Tier 4)
            "battery0/MaxModuleVoltage": int(round((((int(round(bms_pack_v / 1000.0)) if bms_pack_v > 2000 else bms_pack_v) / 10.0) + 0.35) * 10.0)),
            "battery0/MinModuleVoltage": int(round((((int(round(bms_pack_v / 1000.0)) if bms_pack_v > 2000 else bms_pack_v) / 10.0) - 0.28) * 10.0)),
            "battery0/MaxVoltageModuleNumber": 2,
            "battery0/MinVoltageModuleNumber": 1,
            "battery0/MaxModuleTemperature": bms_max_cell_t,
            "battery0/MinModuleTemperature": bms_min_cell_t,
            "battery0/MaxTemperatureModuleNumber": 4,
            "battery0/MinTemperatureModuleNumber": 8,
            "battery0/ModuleVoltageDelta": 6,
            "battery0/ModuleTemperatureSpread": cell_temp_spread,

            # Array Level (Tier 2)
            "array0/DcVoltage": int(round(bms_pack_v / 1000.0)) if bms_pack_v > 2000 else bms_pack_v,
            "array0/DcCurrent": int(round(bms_pack_i / 1000.0)) if abs(bms_pack_i) > 500 else bms_pack_i,
            "array0/DcPower": p_ess,
            "array0/ParallelPiles": 1 if self.capacity_wh <= 500_000 else (2 if self.capacity_wh <= 1_500_000 else 4),
            "array0/SocBalanceVariance": 8,
            "array0/CirculatingCurrent": 2,
            "array0/DcBreakerStatus": 1,
            "array0/MainContactorPos": 1,
            "array0/MainContactorNeg": 1,
            "array0/PrechargeContactor": 0,

            # Cabinet Level (Tier 1)
            "cabinet0/State": 1 if p_ess < -1000 else (2 if p_ess > 1000 else 3),
            "cabinet0/ActivePower": p_ess,
            "cabinet0/DcPower": p_ess,
            "cabinet0/DailyChargeEnergy": self.ess_charge_energy,
            "cabinet0/DailyDischargeEnergy": self.ess_discharge_energy,
            "cabinet0/TotalChargeEnergy": self.ess_charge_energy * 10,
            "cabinet0/TotalDischargeEnergy": self.ess_discharge_energy * 10,
            "cabinet0/RteEfficiency": 925,
            "cabinet0/AmbientTemp": amb_temp,
            "cabinet0/Humidity": 45,
            "cabinet0/HvacStatus": 1 if bms_max_cell_t > 240 else 0,
            "cabinet0/HvacTempSetpoint": 220,
            "cabinet0/FireSystemStatus": 0,
            "cabinet0/DoorLimitStatus": 0,
            "cabinet0/EmergencyStopStatus": 0,

            # Individual 10 Modules (Tier 4)
            **{f"battery0/Module_{m:02d}_Voltage": int(round((((int(round(bms_pack_v / 1000.0)) if bms_pack_v > 2000 else bms_pack_v) / 10.0) + (0.35 if m==2 else (-0.28 if m==1 else 0.04 * (m-5)))) * 10.0)) for m in range(1, 11)},
            **{f"battery0/Module_{m:02d}_Temp": bms_min_cell_t + int(cell_temp_spread * ((m * 3) % 10) / 10.0) for m in range(1, 11)},

            # Individual 160 Cells (Tier 5)
            **{f"battery0/Cell_{c:03d}_V": (bms_max_cell_v if c == 14 else (bms_min_cell_v if c == 3 else bms_min_cell_v + int((bms_max_cell_v - bms_min_cell_v) * ((c * 47) % 100) / 100.0))) for c in range(1, 161)},

            # Meteorological & Solar Irradiance
            "weather/SolarIrradiance": solar_irr,
            "weather/AmbientTemperature": amb_temp,
            "weather/PvCellTemperature": pv_temp,
            "weather/CloudCover": cloud_cover,
            "weather/WindSpeed": wind_speed,
            "weather0/State": 0,
            "weather0/CurrentTemperature": int(round(amb_temp / 10.0)),
            "weather0/CurrentWeatherCode": 1 if cloud_cover < 40 else (2 if cloud_cover < 75 else 3),
            "weather0/TodaysSunshineDuration": int(max(0, (hour - 6.0) * 3600 * 0.75)) if hour >= 6.0 else 0,
            "weather0/TodaysMinTemperature": 16,
            "weather0/TodaysMaxTemperature": 28,
            "weather0/TemperatureIn4h": int(round((amb_temp / 10.0) + 1)),
            "weather0/WeatherCodeIn4h": 1,
            "weather0/TemperatureIn8h": int(round((amb_temp / 10.0) - 2)),
            "weather0/WeatherCodeIn8h": 2,
            "weather0/TemperatureIn12h": int(round((amb_temp / 10.0) - 4)),
            "weather0/WeatherCodeIn12h": 0,
            "weather0/TemperatureIn16h": int(round((amb_temp / 10.0) - 2)),
            "weather0/WeatherCodeIn16h": 1,
            "weather0/TemperatureIn20h": int(round(amb_temp / 10.0)),
            "weather0/WeatherCodeIn20h": 1,
            "weather0/TemperatureIn24h": int(round(amb_temp / 10.0)),
            "weather0/WeatherCodeIn24h": 1,
            "weather0/WindSpeed": wind_speed,
            "weather0/CloudCover": cloud_cover,

            # Dynamic Electricity Spot Market Tariff
            "tariff/MarketPrice": spot_price,
            "tariff/AncillaryPrice": ancillary_price,
            "tariff/CarbonIntensity": carbon_intensity,
            "timeOfUseTariff0/State": 0,
            "timeOfUseTariff0/MarketPrice": spot_price,
            "timeOfUseTariff0/QuarterlyPrices": spot_price,

            # Sub-branch End-Use Disaggregation with Voltage and Current
            "meter_hvac/ActivePower": p_hvac,
            "meter_hvac/ActiveConsumptionEnergy": self.hvac_energy,
            "meter_hvac/Voltage": v_avg,
            "meter_hvac/VoltageL1": v_l1,
            "meter_hvac/VoltageL2": v_l2,
            "meter_hvac/VoltageL3": v_l3,
            "meter_hvac/Current": int(abs(p_hvac) / (v_avg / 1000.0) * 1000),
            "meter_hvac/Frequency": freq,

            "meter_production/ActivePower": p_machinery,
            "meter_production/ActiveConsumptionEnergy": self.machinery_energy,
            "meter_production/Voltage": v_avg,
            "meter_production/VoltageL1": v_l1,
            "meter_production/VoltageL2": v_l2,
            "meter_production/VoltageL3": v_l3,
            "meter_production/Current": int(abs(p_machinery) / (v_avg / 1000.0) * 1000),
            "meter_production/Frequency": freq,

            "meter_lighting/ActivePower": p_lighting,
            "meter_lighting/ActiveConsumptionEnergy": self.lighting_energy,
            "meter_lighting/Voltage": v_avg,
            "meter_lighting/VoltageL1": v_l1,
            "meter_lighting/VoltageL2": v_l2,
            "meter_lighting/VoltageL3": v_l3,
            "meter_lighting/Current": int(abs(p_lighting) / (v_avg / 1000.0) * 1000),
            "meter_lighting/Frequency": freq,

            "meter_datacenter/ActivePower": p_datacenter,
            "meter_datacenter/ActiveConsumptionEnergy": self.datacenter_energy,
            "meter_datacenter/Voltage": v_avg,
            "meter_datacenter/VoltageL1": v_l1,
            "meter_datacenter/VoltageL2": v_l2,
            "meter_datacenter/VoltageL3": v_l3,
            "meter_datacenter/Current": int(abs(p_datacenter) / (v_avg / 1000.0) * 1000),
            "meter_datacenter/Frequency": freq,

            "ctrlBalancing0/_PropertyTargetGridSetpoint": 0,
            "uiwebsocket0/Connections": 2,
            "edgewebsocket0/Connections": 2,
            "coreJsonRpcRequestHandler0/Completed": self.rpc_completed
        }

        if self.pv_peak_w > 0:
            curr_pv_l1 = int(abs(p_pv_l1) / (v_l1 / 1000.0) * 1000) if p_pv > 0 else 0
            curr_pv_l2 = int(abs(p_pv_l2) / (v_l2 / 1000.0) * 1000) if p_pv > 0 else 0
            curr_pv_l3 = int(abs(p_pv_l3) / (v_l3 / 1000.0) * 1000) if p_pv > 0 else 0
            curr_pv_tot = curr_pv_l1 + curr_pv_l2 + curr_pv_l3
            channel_data.update({
                "meter1/State": 0,
                "meter1/ActivePower": p_pv,
                "meter1/ActivePowerL1": p_pv_l1,
                "meter1/ActivePowerL2": p_pv_l2,
                "meter1/ActivePowerL3": p_pv_l3,
                "meter1/ActiveProductionEnergy": self.production_energy,
                "meter1/Voltage": v_avg,
                "meter1/VoltageL1": v_l1,
                "meter1/VoltageL2": v_l2,
                "meter1/VoltageL3": v_l3,
                "meter1/Current": curr_pv_tot,
                "meter1/CurrentL1": curr_pv_l1,
                "meter1/CurrentL2": curr_pv_l2,
                "meter1/CurrentL3": curr_pv_l3,
                "meter1/Frequency": freq
            })

        if self.station_type in ["solar_storage_ev", "commercial_vpp"]:
            evcs_curr = int(p_evcs / 3.0 / 230.0 * 1000) if p_evcs > 0 else 0
            evcs_p_phase = int(p_evcs // 3)
            channel_data.update({
                "evcs0/State": 0,
                "evcs0/Status": 5 if p_evcs > 0 else 1,
                "evcs0/ChargeState": 1 if p_evcs > 0 else 0,
                "evcs0/ActivePower": p_evcs,
                "evcs0/ChargePower": p_evcs,
                "evcs0/ActiveConsumptionEnergy": self.evcs_energy,
                "evcs0/Voltage": v_avg,
                "evcs0/VoltageL1": v_l1,
                "evcs0/VoltageL2": v_l2,
                "evcs0/VoltageL3": v_l3,
                "evcs0/Current": evcs_curr * 3,
                "evcs0/CurrentL1": evcs_curr,
                "evcs0/CurrentL2": evcs_curr,
                "evcs0/CurrentL3": evcs_curr,
                "evcsgoehttp/State": 0,
                "evcsgoehttp/Status": 3 if p_evcs > 0 else 2,
                "evcsgoehttp/ActivePower": p_evcs,
                "evcsgoehttp/ChargePower": p_evcs,
                "evcsgoehttp/ActiveConsumptionEnergy": self.evcs_energy,
                "evcsgoehttp/Voltage": v_avg,
                "evcsgoehttp/VoltageL1": v_l1,
                "evcsgoehttp/VoltageL2": v_l2,
                "evcsgoehttp/VoltageL3": v_l3,
                "evcsgoehttp/Current": evcs_curr * 3,
                "evcsgoehttp/CurrentL1": evcs_curr,
                "evcsgoehttp/CurrentL2": evcs_curr,
                "evcsgoehttp/CurrentL3": evcs_curr,
                "evcsgoehttp/ActivePowerL1": evcs_p_phase,
                "evcsgoehttp/ActivePowerL2": evcs_p_phase,
                "evcsgoehttp/ActivePowerL3": evcs_p_phase,
                "evcsgoehttp/Phases": 3
            })

        if self.station_type == "heavy_industrial":
            channel_data.update({
                "ctrlPeakShaving0/State": 0,
                "ctrlPeakShaving0/PeakShavingPowerLimit": 750000,
                "ctrlPeakShaving0/_PropertyPeakShavingPower": 750000,
                "ctrlPeakShaving0/_PropertyRechargePower": 400000,
                "ctrlPeakShaving0/ActivePower": p_ess,
                # Submeter mirrors for meter2 (HVAC), meter3 (Machinery), meter4 (Lighting)
                "meter2/State": 0,
                "meter2/ActivePower": p_hvac,
                "meter2/ActiveConsumptionEnergy": self.hvac_energy,
                "meter2/Voltage": v_avg,
                "meter2/VoltageL1": v_l1,
                "meter2/VoltageL2": v_l2,
                "meter2/VoltageL3": v_l3,
                "meter2/Current": int(abs(p_hvac) / (v_avg / 1000.0) * 1000),
                "meter2/Frequency": freq,
                "meter3/State": 0,
                "meter3/ActivePower": p_machinery,
                "meter3/ActiveConsumptionEnergy": self.machinery_energy,
                "meter3/Voltage": v_avg,
                "meter3/VoltageL1": v_l1,
                "meter3/VoltageL2": v_l2,
                "meter3/VoltageL3": v_l3,
                "meter3/Current": int(abs(p_machinery) / (v_avg / 1000.0) * 1000),
                "meter3/Frequency": freq,
                "meter4/State": 0,
                "meter4/ActivePower": p_lighting,
                "meter4/ActiveConsumptionEnergy": self.lighting_energy,
                "meter4/Voltage": v_avg,
                "meter4/VoltageL1": v_l1,
                "meter4/VoltageL2": v_l2,
                "meter4/VoltageL3": v_l3,
                "meter4/Current": int(abs(p_lighting) / (v_avg / 1000.0) * 1000),
                "meter4/Frequency": freq
            })

        if self.station_type == "island_offgrid":
            curr_gen_l1 = int(abs(p_genset / 3.0) / (v_l1 / 1000.0) * 1000) if p_genset > 0 else 0
            curr_gen_l2 = int(abs(p_genset / 3.0) / (v_l2 / 1000.0) * 1000) if p_genset > 0 else 0
            curr_gen_l3 = int(abs(p_genset / 3.0) / (v_l3 / 1000.0) * 1000) if p_genset > 0 else 0
            channel_data.update({
                "meter2/State": 0,
                "meter2/ActivePower": p_genset,
                "meter2/ActivePowerL1": int(p_genset // 3),
                "meter2/ActivePowerL2": int(p_genset // 3),
                "meter2/ActivePowerL3": p_genset - 2 * int(p_genset // 3),
                "meter2/ActiveProductionEnergy": self.genset_energy,
                "meter2/Voltage": v_avg,
                "meter2/VoltageL1": v_l1,
                "meter2/VoltageL2": v_l2,
                "meter2/VoltageL3": v_l3,
                "meter2/Current": curr_gen_l1 + curr_gen_l2 + curr_gen_l3,
                "meter2/CurrentL1": curr_gen_l1,
                "meter2/CurrentL2": curr_gen_l2,
                "meter2/CurrentL3": curr_gen_l3,
                "meter2/Frequency": freq
            })

        return channel_data

    def to_influx_line(self, channel_data, ts_sec):
        fields = [f"{k}={v}i" for k, v in channel_data.items()]
        return f"data,edge={self.edge_tag} " + ",".join(fields) + f" {int(ts_sec)}"

def post_influx_points(lines):
    if not lines:
        return
    body = "\n".join(lines).encode("utf-8")
    req = urllib.request.Request(
        INFLUX_WRITE_URL,
        data=body,
        headers={"Authorization": f"Token {AUTH_TOKEN}", "Content-Type": "text/plain; charset=utf-8"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            pass
    except Exception as e:
        print(f"Error posting live points to InfluxDB: {e}", flush=True)

async def edge_websocket_client_worker(edge_id, station_sim):
    """Maintains persistent Edge Gateway WebSocket connection for edgeX to Backend (port 8084)."""
    import websockets
    config = EDGE_CONFIGS.get(edge_id, {})
    while True:
        try:
            headers = {"Apikey": edge_id}
            async with websockets.connect(BACKEND_WS_URL, additional_headers=headers) as ws:
                print(f"[{edge_id}_ws] Connected to Gateway! Sending EdgeConfigNotification...", flush=True)
                cfg_notif = {
                    "jsonrpc": "2.0",
                    "method": "edgeConfigNotification",
                    "params": config
                }
                await ws.send(json.dumps(cfg_notif))

                async def handle_incoming():
                    while True:
                        msg_str = await ws.recv()
                        try:
                            req = json.loads(msg_str)
                            req_id = req.get("id")
                            method = req.get("method")
                            if req_id and method == "getEdgeConfig":
                                resp = {"jsonrpc": "2.0", "id": req_id, "result": config}
                                await ws.send(json.dumps(resp))
                            elif req_id:
                                resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
                                await ws.send(json.dumps(resp))
                        except Exception:
                            pass

                incoming_task = asyncio.create_task(handle_incoming())

                while True:
                    await asyncio.sleep(FEED_INTERVAL)
                    now_ms = int(time.time() * 1000)
                    ch_data = station_sim.step_simulation(time.time())
                    filtered_ch = {k: v for k, v in ch_data.items() if not k.startswith("coreJsonRpc") and not k.startswith("uiwebsocket") and not k.startswith("edgewebsocket")}
                    ts_data = {
                        "jsonrpc": "2.0",
                        "method": "timestampedData",
                        "params": {str(now_ms): filtered_ch}
                    }
                    await ws.send(json.dumps(ts_data))

        except Exception as e:
            print(f"[{edge_id}_ws] Disconnected ({e}). Reconnecting in 3s...", flush=True)
            await asyncio.sleep(3.0)

async def influx_feeder_worker(stations):
    """Continuously injects live simulated points into InfluxDB for all stations every 5s."""
    print("[influx_feeder] Starting continuous InfluxDB telemetry injection for all stations...", flush=True)
    loop_count = 0
    while True:
        try:
            now_ts = time.time()
            lines = []
            for st in stations:
                data = st.step_simulation(now_ts)
                lines.append(st.to_influx_line(data, now_ts))
            post_influx_points(lines)

            loop_count += 1
            if loop_count % 12 == 0:  # Every ~1 minute
                print(f"[influx_feeder] [{datetime.now().strftime('%H:%M:%S')}] Injected points for {len(stations)} stations. edge0 SOC={stations[0].current_soc:.1f}%, edge1 SOC={stations[1].current_soc:.1f}%, edge2 SOC={stations[2].current_soc:.1f}%, edge3 SOC={stations[3].current_soc:.1f}%, edge4 SOC={stations[4].current_soc:.1f}%", flush=True)

            await asyncio.sleep(FEED_INTERVAL)
        except Exception as e:
            print(f"[influx_feeder] Error: {e}", flush=True)
            await asyncio.sleep(FEED_INTERVAL)

async def main():
    print("==================================================================", flush=True)
    print("   OpenEMS 5-Station Microgrid Live Gateway & Feeder Daemon      ", flush=True)
    print("==================================================================", flush=True)

    stations = [
        # edge0: C&I Solar-Storage-EV (tag=0)
        StationLiveSimulator("edge0", 0, 1_000_000, 500_000, 400_000, 250_000, 650_000, "solar_storage_ev"),
        # edge1: Heavy Industrial (tag=1)
        StationLiveSimulator("edge1", 1, 2_000_000, 1_000_000, 0, 450_000, 1_250_000, "heavy_industrial"),
        # edge2: Utility Frequency Regulation (tag=2)
        StationLiveSimulator("edge2", 2, 4_000_000, 2_000_000, 0, 40_000, 60_000, "utility_fcr"),
        # edge3: Commercial VPP (tag=3)
        StationLiveSimulator("edge3", 3, 400_000, 200_000, 150_000, 180_000, 550_000, "commercial_vpp"),
        # edge4: Island Offgrid (tag=4)
        StationLiveSimulator("edge4", 4, 250_000, 100_000, 120_000, 30_000, 95_000, "island_offgrid")
    ]

    for st in stations:
        st.load_latest_from_influx()

    tasks = [
        asyncio.create_task(influx_feeder_worker(stations)),
        asyncio.create_task(edge_websocket_client_worker("edge1", stations[1])),
        asyncio.create_task(edge_websocket_client_worker("edge2", stations[2])),
        asyncio.create_task(edge_websocket_client_worker("edge3", stations[3])),
        asyncio.create_task(edge_websocket_client_worker("edge4", stations[4]))
    ]

    await asyncio.gather(*tasks)

if __name__ == "__main__":
    asyncio.run(main())
