#!/usr/bin/env python3
"""
OpenEMS High-Fidelity Industrial BMS (Battery Management System) Virtual Device
Simulates a Pylontech Powercube M2 High-Voltage LiFePO4 Energy Storage Battery Rack:
  • 160 Cells in Series, 10 Modules (512.0 V Nominal, 100 kWh Capacity)
  • Real-Time Dynamic Electro-Thermal Model & Coulomb Counting SOC Integration
  • High-Precision Cell-Level Voltage (mV) and Temperature (0.1°C) Matrix
  • Dynamic Safety Envelope (BP_CHARGE_BMS / BP_DISCHARGE_BMS Derating Curves)
  • Full Modbus TCP Server responding to FC03 (Read Holding), FC04 (Read Input),
    FC06 (Write Single: 0x1090 Wake/Sleep), and FC16 (Write Multiple).
  • High-Frequency InfluxDB Telemetry Publisher (edge=bms, edge=0) for 5-Tier
    Topology Visualization in Grafana (Cell, Module, Pack, Array, Cabinet).
"""

import asyncio
import struct
import time
import math
import random
import os
import sys
import urllib.request
import urllib.error

PORT = 8503
UNIT_ID = 1

INFLUX_WRITE_URL = "http://127.0.0.1:8086/api/v2/write?bucket=openems&org=openems&precision=s"
AUTH_TOKEN = "OpenEmsInfluxSecretToken2026!"

class VirtualPylontechBMS:
    def __init__(self):
        # Battery Specifications
        self.nominal_voltage_v = 512.0
        self.capacity_wh = 100_000.0   # 100 kWh
        self.capacity_ah = self.capacity_wh / self.nominal_voltage_v  # ~195.3 Ah
        self.internal_resistance_ohm = 0.08  # 80 mOhm pack internal resistance

        # Dynamic State Variables
        self.is_awake = True
        self.soc = 68.5                # Initial SOC in %
        self.soh = 99                  # Initial SOH in %
        self.cycle_count = 185
        self.current_a = 0.0           # Current: negative = charging, positive = discharging
        self.last_update_time = time.time()
        self.start_time = time.time()

        # Cumulative Energy Wh
        self.remaining_capacity_wh = (self.soc / 100.0) * self.capacity_wh
        self.charge_capacity_wh = 100_000
        self.discharge_capacity_wh = 100_000
        self.daily_charge_wh = 45_200
        self.daily_discharge_wh = 42_800
        self.history_charge_wh = 15_240_000
        self.history_discharge_wh = 14_890_000

        # Thermal Variables
        self.ambient_temp_c = 23.5
        self.pack_temp_c = 25.2
        self.max_cell_temp_c = 26.4
        self.min_cell_temp_c = 24.1
        self.max_temp_cell_no = 8
        self.min_temp_cell_no = 1

        # Cell Voltage Variables (160 cells)
        self.max_cell_v_mv = 3365
        self.min_cell_v_mv = 3342
        self.max_v_cell_no = 14
        self.min_v_cell_no = 3

        # 160 Cells static characterization offsets
        random.seed(42)
        self.cell_offsets = [int(random.gauss(0, 5)) for _ in range(160)]
        self.cell_offsets[13] = 16   # Cell #14 is max (+16mV offset)
        self.cell_offsets[2] = -14   # Cell #3 is min (-14mV offset)

        self.temp_offsets = [round(random.gauss(0, 0.35), 1) for _ in range(160)]
        self.temp_offsets[7] = 1.3   # Cell #8 is hottest (+1.3°C)
        self.temp_offsets[0] = -1.1  # Cell #1 is coolest (-1.1°C)

        self.cell_voltages_mv = [3300] * 160
        self.cell_temps_c = [24.5] * 160
        self.module_voltages_v = [51.2] * 10
        self.module_temps_c = [24.5] * 10

        self.max_module_v = 52.8
        self.min_module_v = 51.6
        self.max_v_module_no = 2
        self.min_v_module_no = 1
        self.max_module_temp_c = 25.8
        self.min_module_temp_c = 23.9
        self.max_temp_module_no = 4
        self.min_temp_module_no = 8

        # Safety Limits
        self.charge_max_voltage_v = 547.5   # 3.42V / cell
        self.discharge_min_voltage_v = 435.0 # 2.72V / cell
        self.charge_max_current_a = 120.0
        self.discharge_max_current_a = 140.0
        self.insulation_kohm = 10_000

        # Memory Map Storage (Word Address -> 16-bit uint)
        self.registers = {}
        self.update_physics()

    def update_physics(self):
        now = time.time()
        dt = max(0.1, min(now - self.last_update_time, 5.0))
        self.last_update_time = now
        elapsed = now - self.start_time

        if self.is_awake:
            # Simulate an industrial microgrid storage power profile:
            cycle_phase = (elapsed % 300.0) / 300.0  # 5-minute cycle
            if cycle_phase < 0.4:
                # Discharging to support microgrid load (positive current)
                target_i = 18.0 + 4.0 * math.sin(elapsed * 0.1) + random.uniform(-0.5, 0.5)
            elif cycle_phase < 0.5:
                # Float / Idle
                target_i = 0.0 + random.uniform(-0.2, 0.2)
            elif cycle_phase < 0.9:
                # Absorbing excess solar PV (negative current = charging)
                target_i = -24.0 + 5.0 * math.cos(elapsed * 0.08) + random.uniform(-0.5, 0.5)
            else:
                target_i = 0.0 + random.uniform(-0.1, 0.1)

            # Smoothly track target current
            self.current_a += (target_i - self.current_a) * 0.25

            # Dynamic Coulomb Counting (SOC integration)
            delta_soc = -(self.current_a * dt) / (self.capacity_ah * 3600.0) * 100.0
            self.soc = max(5.0, min(98.0, self.soc + delta_soc))
            self.remaining_capacity_wh = (self.soc / 100.0) * self.capacity_wh

            # Cumulative Wh updates
            power_w = self.nominal_voltage_v * self.current_a
            if power_w < 0: # Charging
                energy_delta = (-power_w * dt) / 3600.0
                self.daily_charge_wh += energy_delta
                self.history_charge_wh += energy_delta
            else:           # Discharging
                energy_delta = (power_w * dt) / 3600.0
                self.daily_discharge_wh += energy_delta
                self.history_discharge_wh += energy_delta

            # LiFePO4 Open Circuit Voltage (OCV) Curve (160 cells)
            cell_ocv = 3.20 + 0.0035 * (self.soc - 50.0) + (0.05 * math.tanh((self.soc - 50.0) / 15.0))
            pack_terminal_v = (cell_ocv * 160.0) - (self.current_a * self.internal_resistance_ohm)
            self.pack_voltage_v = max(420.0, min(560.0, pack_terminal_v))

            # Mean Cell Voltage in mV
            avg_cell_mv = int((self.pack_voltage_v / 160.0) * 1000.0)

            # Thermal dynamics (Joule heating + ambient dissipation)
            heat_gen = (self.current_a ** 2) * self.internal_resistance_ohm * 0.0005
            self.pack_temp_c += (self.ambient_temp_c + heat_gen - self.pack_temp_c) * 0.02

            # Compute all 160 Cells voltages & temperatures
            for i in range(160):
                mod_idx = i // 16
                # Middle modules run slightly warmer due to interior thermal retention
                mod_thermal_bias = 0.9 * math.sin((mod_idx / 9.0) * math.pi)
                
                # Active balancing reduces cell #14 if delta is elevated
                cell_v = avg_cell_mv + self.cell_offsets[i] + random.uniform(-0.6, 0.6)
                self.cell_voltages_mv[i] = int(round(cell_v))
                
                cell_t = self.pack_temp_c + mod_thermal_bias + self.temp_offsets[i] + random.uniform(-0.05, 0.05)
                self.cell_temps_c[i] = round(cell_t, 1)

            # Cell Extremes
            self.max_cell_v_mv = max(self.cell_voltages_mv)
            self.min_cell_v_mv = min(self.cell_voltages_mv)
            self.max_v_cell_no = self.cell_voltages_mv.index(self.max_cell_v_mv) + 1
            self.min_v_cell_no = self.cell_voltages_mv.index(self.min_cell_v_mv) + 1
            self.max_cell_temp_c = max(self.cell_temps_c)
            self.min_cell_temp_c = min(self.cell_temps_c)
            self.max_temp_cell_no = self.cell_temps_c.index(self.max_cell_temp_c) + 1
            self.min_temp_cell_no = self.cell_temps_c.index(self.min_cell_temp_c) + 1

            # Compute all 10 Modules voltages & temperatures
            self.module_voltages_v = []
            self.module_temps_c = []
            for m in range(10):
                m_cells = self.cell_voltages_mv[m * 16 : (m + 1) * 16]
                self.module_voltages_v.append(round(sum(m_cells) / 1000.0, 2))
                m_temps = self.cell_temps_c[m * 16 : (m + 1) * 16]
                self.module_temps_c.append(round(sum(m_temps) / 16.0, 1))

            self.max_module_v = max(self.module_voltages_v)
            self.min_module_v = min(self.module_voltages_v)
            self.max_v_module_no = self.module_voltages_v.index(self.max_module_v) + 1
            self.min_v_module_no = self.module_voltages_v.index(self.min_module_v) + 1
            self.max_module_temp_c = max(self.module_temps_c)
            self.min_module_temp_c = min(self.module_temps_c)
            self.max_temp_module_no = self.module_temps_c.index(self.max_module_temp_c) + 1
            self.min_temp_module_no = self.module_temps_c.index(self.min_module_temp_c) + 1

            # Dynamic BMS Envelope (Derating curves near SOC boundary)
            if self.soc > 90.0:
                taper = (98.0 - self.soc) / 8.0
                self.charge_max_current_a = max(10.0, 120.0 * taper)
            else:
                self.charge_max_current_a = 120.0

            if self.soc < 15.0:
                taper = (self.soc - 5.0) / 10.0
                self.discharge_max_current_a = max(10.0, 140.0 * taper)
            else:
                self.discharge_max_current_a = 140.0

            # Status determination
            if abs(self.current_a) < 0.5:
                status_code = 3  # IDLE
                status_word = (1 << 10) | 3
            elif self.current_a < -0.5:
                status_code = 1  # CHARGE
                status_word = (1 << 11) | 1
            else:
                status_code = 2  # DISCHARGE
                status_word = (1 << 12) | 2
        else:
            # Sleeping
            self.current_a = 0.0
            status_code = 0  # SLEEP
            status_word = (1 << 13) | 0

        # Rebuild Register Map
        # 1. Equipment Info (0x100A..0x100C)
        self.set_u16(0x100A, 0x0201)  # Version V02.01
        self.set_u16(0x100B, 100)     # Internal Version 100
        self.set_u16(0x100C, 1)       # Number of Parallel Piles = 1

        # 2. Status & Protections (0x1100..0x1102)
        self.set_u16(0x1100, status_word)
        self.set_u16(0x1101, 0)       # Protections = 0 (Normal)
        self.set_u16(0x1102, 0)       # Warnings = 0 (Normal)

        # 3. Electrical Metrics (0x1103..0x110E)
        self.set_u16(0x1103, int(round(self.pack_voltage_v * 10.0))) # Scale 0.1 V
        self.set_s32(0x1104, int(round(self.current_a * 100.0)))      # Scale 0.01 A
        self.set_s16(0x1106, int(round(self.pack_temp_c * 10.0)))     # Scale 0.1 °C
        self.set_u16(0x1107, int(round(self.soc)))                    # SOC %
        self.set_u16(0x1108, self.cycle_count)                        # Full Cycles
        self.set_u16(0x1109, int(round(self.charge_max_voltage_v * 10.0)))
        self.set_s32(0x110A, int(round(self.charge_max_current_a * 100.0)))
        self.set_u16(0x110C, int(round(self.discharge_min_voltage_v * 10.0)))
        self.set_s32(0x110D, -int(round(self.discharge_max_current_a * 100.0)))

        # 4. Circuit Status (0x110F)
        self.set_u16(0x110F, 0x0043 if self.is_awake else 0x0000)

        # 5. Cell Extremes (0x1110..0x1117)
        self.set_u16(0x1110, self.max_cell_v_mv)
        self.set_u16(0x1111, self.min_cell_v_mv)
        self.set_u16(0x1112, self.max_v_cell_no)
        self.set_u16(0x1113, self.min_v_cell_no)
        self.set_s16(0x1114, int(round(self.max_cell_temp_c * 10.0)))
        self.set_s16(0x1115, int(round(self.min_cell_temp_c * 10.0)))
        self.set_u16(0x1116, self.max_temp_cell_no)
        self.set_u16(0x1117, self.min_temp_cell_no)

        # 6. Module Extremes (0x1118..0x111F)
        self.set_u16(0x1118, int(round(self.max_module_v * 100.0)))
        self.set_u16(0x1119, int(round(self.min_module_v * 100.0)))
        self.set_u16(0x111A, self.max_v_module_no)
        self.set_u16(0x111B, self.min_v_module_no)
        self.set_s16(0x111C, int(round(self.max_module_temp_c * 10.0)))
        self.set_s16(0x111D, int(round(self.min_module_temp_c * 10.0)))
        self.set_u16(0x111E, self.max_temp_module_no)
        self.set_u16(0x111F, self.min_temp_module_no)

        # 7. SOH & Capacities (0x1120..0x1131)
        self.set_u16(0x1120, self.soh)
        self.set_u32(0x1121, int(self.remaining_capacity_wh))
        self.set_u32(0x1123, int(self.charge_capacity_wh))
        self.set_u32(0x1125, int(self.discharge_capacity_wh))
        self.set_u32(0x1127, int(self.daily_charge_wh))
        self.set_u32(0x1129, int(self.daily_discharge_wh))
        self.set_u32(0x112B, int(self.history_charge_wh))
        self.set_u32(0x112D, int(self.history_discharge_wh))
        self.set_u16(0x112F, 0) # Force charge = 0
        self.set_u16(0x1130, 0) # Balance charge = 0
        self.set_u16(0x1131, 0) # Piles in parallel = 0
        self.set_u16(0x1132, 0) # Error bits = 0

        # 8. Architecture & Insulation (0x1136..0x1149)
        self.set_u16(0x1136, 10)  # 10 modules in series
        self.set_u16(0x1137, 160) # 160 cells in series
        self.set_u16(0x1138, 0)   # Charge forbidden = 0
        self.set_u16(0x1139, 0)   # Discharge forbidden = 0
        self.set_u16(0x1148, self.insulation_kohm)
        self.set_u16(0x1149, 0)   # Insulation error level = 0

    def set_u16(self, addr, val):
        self.registers[addr] = val & 0xFFFF

    def set_s16(self, addr, val):
        if val < 0:
            val = (1 << 16) + val
        self.registers[addr] = val & 0xFFFF

    def set_u32(self, addr, val):
        val = int(val) & 0xFFFFFFFF
        self.registers[addr] = (val >> 16) & 0xFFFF
        self.registers[addr + 1] = val & 0xFFFF

    def set_s32(self, addr, val):
        val = int(val)
        if val < 0:
            val = (1 << 32) + val
        self.registers[addr] = (val >> 16) & 0xFFFF
        self.registers[addr + 1] = val & 0xFFFF

    def read_holding_registers(self, start_addr, count):
        self.update_physics()
        res = bytearray()
        for a in range(start_addr, start_addr + count):
            val = self.registers.get(a, 0)
            res.extend(struct.pack('>H', val))
        return bytes(res)

    def write_single_register(self, addr, val):
        self.registers[addr] = val & 0xFFFF
        if addr == 0x1090:
            if val == 0x0055:
                print(f"[BMS Virtual Device] Received WAKE UP command (0x55) at 0x1090", flush=True)
                self.is_awake = True
            elif val == 0x00AA:
                print(f"[BMS Virtual Device] Received SLEEP command (0xAA) at 0x1090", flush=True)
                self.is_awake = False
        self.update_physics()
        return val

bms = VirtualPylontechBMS()

def generate_influx_lines(edge_tag, ts_sec):
    """Generates complete 5-tier telemetry line protocol for the given edge tag."""
    bms.update_physics()
    
    # 1. Tier 3: Battery Pack / Rack Metrics
    v_pack = int(round(bms.pack_voltage_v))
    i_pack = int(round(bms.current_a))
    p_dc = int(round(bms.pack_voltage_v * bms.current_a))
    soc_int = int(round(bms.soc))
    
    delta_v = bms.max_cell_v_mv - bms.min_cell_v_mv
    delta_t = int(round((bms.max_cell_temp_c - bms.min_cell_temp_c) * 10.0))
    mod_delta_v = int(round((bms.max_module_v - bms.min_module_v) * 10.0))
    mod_delta_t = int(round((bms.max_module_temp_c - bms.min_module_temp_c) * 10.0))
    
    fields = {
        # Pack Level (Tier 3)
        "battery0/Voltage": v_pack,
        "battery0/Current": i_pack,
        "battery0/Soc": soc_int,
        "battery0/Soh": bms.soh,
        "battery0/CycleCount": bms.cycle_count,
        "battery0/RemainingCapacity": int(bms.remaining_capacity_wh),
        "battery0/DailyChargeEnergy": int(bms.daily_charge_wh),
        "battery0/DailyDischargeEnergy": int(bms.daily_discharge_wh),
        "battery0/TotalChargeEnergy": int(bms.history_charge_wh),
        "battery0/TotalDischargeEnergy": int(bms.history_discharge_wh),
        "battery0/ChargeMaxVoltage": int(round(bms.charge_max_voltage_v * 10)),
        "battery0/DischargeMinVoltage": int(round(bms.discharge_min_voltage_v * 10)),
        "battery0/ChargeMaxCurrent": int(round(bms.charge_max_current_a)),
        "battery0/DischargeMaxCurrent": int(round(bms.discharge_max_current_a)),
        "battery0/InsulationResistance": bms.insulation_kohm,
        "battery0/State": 0,
        "battery0/BalancingActiveCells": 3 if delta_v > 20 else 0,
        "battery0/BalancingState": 1 if delta_v > 20 else 0,

        # Cell Level Extremes (Tier 5)
        "battery0/MaxCellVoltage": bms.max_cell_v_mv,
        "battery0/MinCellVoltage": bms.min_cell_v_mv,
        "battery0/MaxVoltageCellNumber": bms.max_v_cell_no,
        "battery0/MinVoltageCellNumber": bms.min_v_cell_no,
        "battery0/CellVoltageDelta": delta_v,
        "battery0/MaxCellTemperature": int(round(bms.max_cell_temp_c * 10.0)),
        "battery0/MinCellTemperature": int(round(bms.min_cell_temp_c * 10.0)),
        "battery0/MaxTemperatureCellNumber": bms.max_temp_cell_no,
        "battery0/MinTemperatureCellNumber": bms.min_temp_cell_no,
        "battery0/CellTemperatureSpread": delta_t,

        # Module Level Extremes (Tier 4)
        "battery0/MaxModuleVoltage": int(round(bms.max_module_v * 10.0)),
        "battery0/MinModuleVoltage": int(round(bms.min_module_v * 10.0)),
        "battery0/MaxVoltageModuleNumber": bms.max_v_module_no,
        "battery0/MinVoltageModuleNumber": bms.min_v_module_no,
        "battery0/MaxModuleTemperature": int(round(bms.max_module_temp_c * 10.0)),
        "battery0/MinModuleTemperature": int(round(bms.min_module_temp_c * 10.0)),
        "battery0/MaxTemperatureModuleNumber": bms.max_temp_module_no,
        "battery0/MinTemperatureModuleNumber": bms.min_temp_module_no,
        "battery0/ModuleVoltageDelta": mod_delta_v,
        "battery0/ModuleTemperatureSpread": mod_delta_t,

        # Array Level (Tier 2)
        "array0/DcVoltage": v_pack,
        "array0/DcCurrent": i_pack,
        "array0/DcPower": p_dc,
        "array0/ParallelPiles": 1,
        "array0/SocBalanceVariance": 8,  # 0.8%
        "array0/CirculatingCurrent": 2,   # 0.2A
        "array0/DcBreakerStatus": 1,      # Closed
        "array0/MainContactorPos": 1,     # Closed
        "array0/MainContactorNeg": 1,     # Closed
        "array0/PrechargeContactor": 0,   # Precharge Finished

        # Cabinet Level (Tier 1)
        "cabinet0/State": 1 if i_pack < -1 else (2 if i_pack > 1 else 3),
        "cabinet0/ActivePower": int(round(p_dc * 0.96)),
        "cabinet0/DcPower": p_dc,
        "cabinet0/DailyChargeEnergy": int(bms.daily_charge_wh),
        "cabinet0/DailyDischargeEnergy": int(bms.daily_discharge_wh),
        "cabinet0/TotalChargeEnergy": int(bms.history_charge_wh),
        "cabinet0/TotalDischargeEnergy": int(bms.history_discharge_wh),
        "cabinet0/RteEfficiency": 925,    # 92.5%
        "cabinet0/AmbientTemp": int(round(bms.ambient_temp_c * 10.0)),
        "cabinet0/Humidity": 45,
        "cabinet0/HvacStatus": 1 if bms.pack_temp_c > 24.5 else 0,
        "cabinet0/HvacTempSetpoint": 220, # 22.0°C
        "cabinet0/FireSystemStatus": 0,   # Normal
        "cabinet0/DoorLimitStatus": 0,    # Closed
        "cabinet0/EmergencyStopStatus": 0 # Normal
    }

    # Individual 10 Modules (Tier 4)
    for m in range(10):
        m_id = m + 1
        fields[f"battery0/Module_{m_id:02d}_Voltage"] = int(round(bms.module_voltages_v[m] * 10.0))
        fields[f"battery0/Module_{m_id:02d}_Temp"] = int(round(bms.module_temps_c[m] * 10.0))

    # Individual 160 Cells (Tier 5)
    for c in range(160):
        c_id = c + 1
        fields[f"battery0/Cell_{c_id:03d}_V"] = bms.cell_voltages_mv[c]
        fields[f"battery0/Cell_{c_id:03d}_T"] = int(round(bms.cell_temps_c[c] * 10.0))

    field_strs = [f"{k}={v}i" for k, v in fields.items()]
    return f"data,edge={edge_tag} " + ",".join(field_strs) + f" {int(ts_sec)}"

async def influx_telemetry_loop():
    """Continuously writes 5-tier topology points to InfluxDB for edge=bms and edge=0."""
    await asyncio.sleep(2.0)
    print("[BMS InfluxDB Telemetry] Starting periodic 5-tier telemetry publisher (interval=2s)...", flush=True)
    while True:
        try:
            now_ts = time.time()
            line_bms = generate_influx_lines("bms", now_ts)
            line_edge0 = generate_influx_lines("0", now_ts)
            body = (line_bms + "\n" + line_edge0).encode("utf-8")
            
            req = urllib.request.Request(
                INFLUX_WRITE_URL,
                data=body,
                headers={"Authorization": f"Token {AUTH_TOKEN}", "Content-Type": "text/plain; charset=utf-8"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                pass
        except Exception as e:
            # print(f"[BMS InfluxDB Telemetry] Error writing to Influx: {e}", flush=True)
            pass
        await asyncio.sleep(2.0)

async def handle_client(reader, writer):
    peer = writer.get_extra_info('peername')
    try:
        while True:
            header = await reader.readexactly(7)
            if not header or len(header) < 7:
                break
            trans_id, proto_id, length, unit_id = struct.unpack('>HHHB', header)
            pdu_len = length - 1
            pdu = await reader.readexactly(pdu_len)
            fc = pdu[0]

            if fc in (0x03, 0x04) and len(pdu) >= 5:
                # Read Holding or Read Input Registers
                start_addr, count = struct.unpack('>HH', pdu[1:5])
                reg_bytes = bms.read_holding_registers(start_addr, count)
                resp_pdu = struct.pack('>BB', fc, len(reg_bytes)) + reg_bytes
                resp_header = struct.pack('>HHHB', trans_id, proto_id, len(resp_pdu) + 1, unit_id)
                writer.write(resp_header + resp_pdu)
                await writer.drain()

            elif fc == 0x06 and len(pdu) >= 5:
                # Write Single Register
                reg_addr, reg_val = struct.unpack('>HH', pdu[1:5])
                bms.write_single_register(reg_addr, reg_val)
                # Echo back the write request as positive confirmation
                resp_pdu = pdu[:5]
                resp_header = struct.pack('>HHHB', trans_id, proto_id, len(resp_pdu) + 1, unit_id)
                writer.write(resp_header + resp_pdu)
                await writer.drain()

            elif fc == 0x10 and len(pdu) >= 6:
                # Write Multiple Registers (FC16)
                start_addr, count, byte_count = struct.unpack('>HHB', pdu[1:6])
                values_data = pdu[6:6 + byte_count]
                for idx in range(count):
                    val = struct.unpack_from('>H', values_data, idx * 2)[0]
                    bms.write_single_register(start_addr + idx, val)
                # Echo back address and count
                resp_pdu = struct.pack('>BHH', fc, start_addr, count)
                resp_header = struct.pack('>HHHB', trans_id, proto_id, len(resp_pdu) + 1, unit_id)
                writer.write(resp_header + resp_pdu)
                await writer.drain()

            else:
                # Exception response (Illegal Function)
                err_pdu = struct.pack('>BB', fc | 0x80, 0x01)
                resp_header = struct.pack('>HHHB', trans_id, proto_id, len(err_pdu) + 1, unit_id)
                writer.write(resp_header + err_pdu)
                await writer.drain()

    except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
        pass
    except Exception as e:
        pass
    finally:
        writer.close()
        await writer.wait_closed()

async def main():
    server = await asyncio.start_server(handle_client, '0.0.0.0', PORT)
    print(f"==================================================================", flush=True)
    print(f"  OpenEMS Virtual BMS Device (Pylontech Powercube M2) Started    ", flush=True)
    print(f"  Listening on Modbus TCP 0.0.0.0:{PORT} (Unit-ID: {UNIT_ID})     ", flush=True)
    print(f"  Nominal: 512.0V, 100kWh, 160 LiFePO4 Cells, 10 Series Modules   ", flush=True)
    print(f"  Telemetry: Live InfluxDB 5-Tier Data Feed (edge=bms & edge=0)   ", flush=True)
    print(f"==================================================================", flush=True)
    
    # Launch concurrent tasks
    asyncio.create_task(influx_telemetry_loop())
    
    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())
