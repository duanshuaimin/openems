#!/usr/bin/env python3
"""
OpenEMS High-Fidelity Industrial PCS (Power Conversion System / 储能变流器) Virtual Device
Simulates a Sinexcel PW-100K (100 kW / 100 kVA) High-Voltage Energy Storage Inverter:
  • Complete Sinexcel Modbus TCP Register Mapping (Holding Regs 1..4096)
  • Three-Phase AC Grid Modeling (380V L-L, 50.00 Hz, Ia/Ib/Ic, Active/Reactive Power)
  • High-Voltage DC Link Modeling (528V Nominal, Positive/Negative split bus, Idc, Pdc)
  • Dynamic Closed-Loop Setpoint Tracking (Register 135: SET_ACTIVE_POWER)
  • Dynamic Inverter State Machine (Standby, Starting, Running, Stopped, Fault)
  • Electro-Thermal Model (IGBT & Inductor heatsink temperatures with load-dependent rise)
  • Direct High-Frequency InfluxDB Telemetry Publisher (edge=pcs, edge=0)
  • Fully Integrated with OpenEMS Edge 'Battery-Inverter.Sinexcel' and 'Ess.Generic.ManagedSymmetric'
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

PORT = 8504
UNIT_ID = 1

def _load_influx_token():
    if os.environ.get("INFLUX_TOKEN"):
        return os.environ["INFLUX_TOKEN"]
    try:
        with open("/etc/openems/influx.env", "r") as f:
            for line in f:
                if line.startswith("INFLUX_TOKEN="):
                    return line.strip().split("=", 1)[1]
    except Exception:
        pass
    return ""

INFLUX_WRITE_URL = "http://127.0.0.1:8086/api/v2/write?bucket=openems&org=openems&precision=s"
AUTH_TOKEN = _load_influx_token()

class VirtualSinexcelPCS:
    def __init__(self):
        # Rated Nameplate Specifications
        self.rated_power_w = 100_000       # 100 kW
        self.rated_apparent_va = 100_000   # 100 kVA
        self.rated_voltage_ll_v = 380.0    # 380 V AC Line-Line
        self.nominal_freq_hz = 50.0        # 50.00 Hz
        self.efficiency = 0.978            # 97.8% peak efficiency

        # Inverter Operational State
        self.is_running = True             # Inverter started and grid-tied
        self.grid_mode = 1                 # 1 = On-Grid, 0 = Off-Grid
        self.allow_grid_conn = 1           # 1 = Allowed
        self.fault_status = 0              # 0 = No fault
        self.alert_status = 0              # 0 = No alert
        self.standby_status = 0            # 0 = Running, 1 = Standby

        # Closed-Loop Setpoints
        self.target_active_power_w = 25_000.0   # Current active target in W (positive=discharge, negative=charge)
        self.actual_active_power_w = 25_000.0   # Actual smoothed active power
        self.target_reactive_power_var = 0.0    # Target reactive power in var
        self.actual_reactive_power_var = 0.0    # Actual smoothed reactive power
        self.power_ramp_rate_w_s = 20_000.0     # 20 kW/s ramp rate

        # Three-Phase AC Measurements
        self.v_l1_l2_v = 380.2
        self.v_l2_l3_v = 379.8
        self.v_l3_l1_v = 380.1
        self.i_l1_a = 38.0
        self.i_l2_a = 38.1
        self.i_l3_a = 37.9
        self.frequency_hz = 50.00
        self.cos_phi = 0.999

        # DC Side Measurements
        self.dc_voltage_v = 528.0          # DC link voltage (matches 160-cell LiFePO4 pack)
        self.dc_current_a = 48.5           # DC current (A)
        self.dc_power_w = 25_600.0         # DC power (W)
        self.cum_charge_energy_wh = 45_200_000
        self.cum_discharge_energy_wh = 42_800_000

        # Thermal System
        self.ambient_temp_c = 24.5
        self.ac_heatsink_temp_c = 36.2
        self.dc_heatsink_temp_c = 38.5

        self.last_update_time = time.time()
        self.start_time = time.time()

        # Register Memory Map (0..5000)
        self.registers = [0] * 5001
        self._init_static_registers()

    def _pack_string_to_words(self, s, num_words):
        """Packs an ASCII string into 16-bit big-endian register words."""
        b = s.encode('ascii')[:num_words * 2].ljust(num_words * 2, b'\x00')
        words = []
        for i in range(num_words):
            words.append(struct.unpack('>H', b[i*2:(i+1)*2])[0])
        return words

    def _init_static_registers(self):
        # 1..16: Manufacturer & Model Number (String, 16 words)
        model_words = self._pack_string_to_words("Sinexcel PW-100K", 16)
        for i, w in enumerate(model_words):
            self.registers[1 + i] = w

        # 17..24: Serial Number (String, 8 words)
        sn_words = self._pack_string_to_words("SN-20261021-001", 8)
        for i, w in enumerate(sn_words):
            self.registers[17 + i] = w

        # 225..226: Charge & Discharge max current readback (SCALE_FACTOR_2 -> 100A = 1000)
        self.registers[224] = 5280  # DC_RELAY_REAR_END_VOLTAGE = 528.0V (scale factor 2)
        self.registers[225] = 1000  # CHARGE_MAX_CURRENT_READ = 100.0A
        self.registers[226] = 1000  # DISCHARGE_MAX_CURRENT_READ = 100.0A

        # 300..311: Network IP, Netmask, Gateway
        self.registers[300] = 127
        self.registers[301] = 0
        self.registers[302] = 0
        self.registers[303] = 1
        self.registers[304] = 255
        self.registers[305] = 255
        self.registers[306] = 255
        self.registers[307] = 0
        self.registers[308] = 127
        self.registers[309] = 0
        self.registers[310] = 0
        self.registers[311] = 1

        # 312..314: MAC address
        self.registers[312] = 0x001A
        self.registers[313] = 0x2B3C
        self.registers[314] = 0x4D5E

        # 316: Unit ID
        self.registers[316] = 1
        self.registers[320] = 3    # 115200
        self.registers[325] = 1    # Ethernet
        self.registers[326] = 1    # Modbus TCP
        self.registers[327] = 60   # EMS Timeout (s)
        self.registers[329] = 0    # BMS Timeout (s)
        self.registers[331] = 1    # On Grid mode

        # 650..658: Control registers
        self.registers[650] = 1    # START_INVERTER
        self.registers[651] = 0    # STOP_INVERTER
        self.registers[652] = 0    # CLEAR_FAILURE
        self.registers[653] = 1    # SET_ON_GRID_MODE
        self.registers[654] = 0    # SET_OFF_GRID_MODE
        self.registers[655] = 0    # SET_STANDBY_COMMAND
        self.registers[656] = 1    # SET_SOFT_START

        # 748..757: Hardware & Topology Config
        self.registers[748] = 0    # VOLTAGE_LEVEL = 400V
        self.registers[749] = 0    # FREQUENCY_LEVEL = 50Hz
        self.registers[750] = 0    # INVERTER_WIRING_TOPOLOGY = 3P4W
        self.registers[752] = 0
        self.registers[753] = 100  # MODULE_POWER_LEVEL = 100kW
        self.registers[754] = 0
        self.registers[755] = 1    # CPU_TYPE
        self.registers[756] = 0
        self.registers[757] = 0

        # 768..805: Grid Code & Protection thresholds
        self.registers[768] = 4400 # 440V Over-voltage
        self.registers[769] = 200  # Trip time 200ms
        self.registers[772] = 3200 # 320V Under-voltage
        self.registers[773] = 300  # Trip time 300ms
        self.registers[778] = 5150 # 51.5Hz Over-freq
        self.registers[782] = 4750 # 47.5Hz Under-freq
        self.registers[786] = 60   # Reconnect time 60s
        self.registers[790] = 1    # Anti-islanding enable
        self.registers[793] = 1    # Power rising mode: step/ramp
        self.registers[800] = 1    # Grid code: VDE-AR-N 4105 / GB/T 34120

        # 808..815: Battery protection and operational limits (SCALE_FACTOR_MINUS_1: value * 10)
        self.registers[808] = 5760 # Float charge voltage: 576.0V
        self.registers[809] = 5760 # Topping charge voltage: 576.0V
        self.registers[810] = 100  # Topping to float current: 10.0A
        self.registers[811] = 1000 # Charge max current: 100.0A
        self.registers[812] = 1000 # Discharge max current: 100.0A
        self.registers[813] = 4400 # Discharge min voltage: 440.0V
        self.registers[814] = 5840 # Charge max voltage: 584.0V
        self.registers[815] = 6000 # Battery voltage protection limit: 600.0V

        # 846..894: Regulation parameters & curves
        self.registers[846] = 5020 # Resume & limit frequency: 50.2Hz
        self.registers[847] = 4980 # Restore lower freq: 49.8Hz
        self.registers[876] = 100  # Soft start ramp rate
        self.registers[877] = 100  # Power ramp rate
        self.registers[878] = 100  # Power factor setting: 1.00

        # 934..967: Calibration multipliers
        self.registers[934] = 0
        for r in range(948, 968):
            self.registers[r] = 1000  # 1.000 calibration factor

        self.update_physics(0.0)

    def update_physics(self, dt=None):
        now = time.time()
        if dt is None:
            dt = now - self.last_update_time
        self.last_update_time = now
        if dt <= 0:
            dt = 0.05
        dt = min(dt, 2.0)

        # 1. Inverter State Machine Updates
        if self.is_running:
            # Gradually ramp actual power towards target setpoint
            max_delta = self.power_ramp_rate_w_s * dt
            p_error = self.target_active_power_w - self.actual_active_power_w
            if abs(p_error) <= max_delta:
                self.actual_active_power_w = self.target_active_power_w
            else:
                self.actual_active_power_w += math.copysign(max_delta, p_error)

            q_error = self.target_reactive_power_var - self.actual_reactive_power_var
            if abs(q_error) <= max_delta:
                self.actual_reactive_power_var = self.target_reactive_power_var
            else:
                self.actual_reactive_power_var += math.copysign(max_delta, q_error)

            self.standby_status = 0
        else:
            # Inverter is stopped
            self.actual_active_power_w = 0.0
            self.actual_reactive_power_var = 0.0
            self.standby_status = 1

        # 2. AC Grid Three-Phase Physics
        # Micro grid frequency flutter: 50.00 Hz ± 0.03 Hz
        t = now - self.start_time
        freq_flutter = 0.02 * math.sin(t * 0.4) + 0.01 * math.sin(t * 1.3)
        self.frequency_hz = round(self.nominal_freq_hz + freq_flutter, 3)

        # Line-Line Voltages (around 380V RMS)
        v_base = self.rated_voltage_ll_v + 1.2 * math.sin(t * 0.25)
        self.v_l1_l2_v = round(v_base + random.uniform(-0.3, 0.3), 1)
        self.v_l2_l3_v = round(v_base - 0.2 + random.uniform(-0.3, 0.3), 1)
        self.v_l3_l1_v = round(v_base + 0.1 + random.uniform(-0.3, 0.3), 1)

        # Line Currents (3-phase symmetric with minor phase unbalance)
        p_act = self.actual_active_power_w
        q_act = self.actual_reactive_power_var
        s_act = math.sqrt(p_act**2 + q_act**2)

        if s_act > 100.0:
            i_base = s_act / (math.sqrt(3.0) * self.rated_voltage_ll_v)
            self.cos_phi = min(1.0, max(0.8, abs(p_act) / s_act))
        else:
            i_base = 0.0
            self.cos_phi = 1.0

        self.i_l1_a = round(i_base * (1.0 + 0.005 * math.sin(t * 0.7)), 2)
        self.i_l2_a = round(i_base * (1.0 - 0.004 * math.sin(t * 0.8)), 2)
        self.i_l3_a = round(i_base * (1.0 + 0.002 * math.sin(t * 0.9)), 2)

        # 3. DC Side Physics & Electro-Chemical Link
        # Fetch live pack voltage from local BMS if available, otherwise nominal 528.0V
        # In OpenEMS convention:
        # P > 0: Discharging battery -> power flows from DC to AC (grid injection)
        # P < 0: Charging battery -> power flows from AC to DC
        if p_act > 0:
            # Discharging: DC power is AC power / efficiency
            self.dc_power_w = p_act / self.efficiency
            self.cum_discharge_energy_wh += int((p_act * dt) / 3600.0)
        elif p_act < 0:
            # Charging: DC power is AC power * efficiency
            self.dc_power_w = p_act * self.efficiency
            self.cum_charge_energy_wh += int((abs(p_act) * dt) / 3600.0)
        else:
            self.dc_power_w = 0.0

        # DC Voltage sag or rise depending on current
        # Pack resistance ~ 0.08 ohm
        self.dc_current_a = self.dc_power_w / self.dc_voltage_v
        v_ocv = 528.0
        self.dc_voltage_v = round(v_ocv - (self.dc_current_a * 0.08), 1)

        # 4. Thermal Model
        load_ratio = s_act / self.rated_apparent_va
        target_ac_temp = self.ambient_temp_c + (22.0 * (load_ratio ** 1.5))
        target_dc_temp = self.ambient_temp_c + (26.0 * (load_ratio ** 1.5))
        # First-order thermal time constant (~30 seconds)
        thermal_alpha = min(1.0, dt / 30.0)
        self.ac_heatsink_temp_c = round(self.ac_heatsink_temp_c + thermal_alpha * (target_ac_temp - self.ac_heatsink_temp_c), 1)
        self.dc_heatsink_temp_c = round(self.dc_heatsink_temp_c + thermal_alpha * (target_dc_temp - self.dc_heatsink_temp_c), 1)

        # 5. Populate Modbus Registers
        # Reg 32: Status Register
        # Bit 0: Fault
        # Bit 1: Alert
        # Bit 2: Inverter State (1 = ON/running)
        # Bit 3: Grid Mode (1 = On-Grid, 0 = Off-Grid)
        # Bit 4: Island Mode
        # Bit 5: Derating Status
        # Bit 6: Allow Grid Connection (1 = Yes)
        # Bit 7: Standby Status (1 = Standby)
        status_word = 0
        if self.fault_status:
            status_word |= (1 << 0)
        if self.alert_status:
            status_word |= (1 << 1)
        if self.is_running:
            status_word |= (1 << 2)  # Inverter State ON
        if self.grid_mode == 1:
            status_word |= (1 << 3)  # On Grid
        if self.allow_grid_conn:
            status_word |= (1 << 6)  # Allow Grid Connection
        if self.standby_status:
            status_word |= (1 << 7)  # Standby Status
        self.registers[32] = status_word

        # Reg 101..103: Grid Voltages (SCALE_FACTOR_2 -> 380.0V * 10 = 3800)
        self.registers[101] = int(round(self.v_l1_l2_v * 10.0))
        self.registers[102] = int(round(self.v_l2_l3_v * 10.0))
        self.registers[103] = int(round(self.v_l3_l1_v * 10.0))

        # Reg 104..106: Grid Currents (SCALE_FACTOR_2 -> 38.0A * 10 = 380)
        self.registers[104] = int(round(self.i_l1_a * 10.0))
        self.registers[105] = int(round(self.i_l2_a * 10.0))
        self.registers[106] = int(round(self.i_l3_a * 10.0))

        # Reg 107: Frequency (SCALE_FACTOR_1 -> 50.00Hz * 100 = 5000)
        self.registers[107] = int(round(self.frequency_hz * 100.0))

        # Reg 110..112: Active Power L1, L2, L3 (SCALE_FACTOR_1 -> W / 10)
        p_per_phase = int(round(p_act / 3.0 / 10.0))
        self.registers[110] = p_per_phase & 0xFFFF
        self.registers[111] = p_per_phase & 0xFFFF
        self.registers[112] = p_per_phase & 0xFFFF

        # Reg 113..115: Reactive Power L1, L2, L3 (SCALE_FACTOR_1 -> var / 10)
        q_per_phase = int(round(q_act / 3.0 / 10.0))
        self.registers[113] = q_per_phase & 0xFFFF
        self.registers[114] = q_per_phase & 0xFFFF
        self.registers[115] = q_per_phase & 0xFFFF

        # Reg 116..118: Apparent Power L1, L2, L3 (SCALE_FACTOR_1 -> VA / 10)
        s_per_phase = int(round(s_act / 3.0 / 10.0))
        self.registers[116] = s_per_phase & 0xFFFF
        self.registers[117] = s_per_phase & 0xFFFF
        self.registers[118] = s_per_phase & 0xFFFF

        # Reg 119..121: Cos Phi L1, L2, L3 (SCALE_FACTOR_MINUS_2 -> 100 = 1.00)
        cos_phi_val = int(round(self.cos_phi * 100.0))
        self.registers[119] = cos_phi_val
        self.registers[120] = cos_phi_val
        self.registers[121] = cos_phi_val

        # Reg 122: ACTIVE_POWER Total (SCALE_FACTOR_1 -> W / 10)
        p_reg = int(round(p_act / 10.0))
        self.registers[122] = p_reg & 0xFFFF

        # Reg 123: REACTIVE_POWER Total (SCALE_FACTOR_1 -> var / 10)
        q_reg = int(round(q_act / 10.0))
        self.registers[123] = q_reg & 0xFFFF

        # Reg 124: APPARENT_POWER Total (SCALE_FACTOR_1 -> VA / 10)
        s_reg = int(round(s_act / 10.0))
        self.registers[124] = s_reg & 0xFFFF

        # Reg 125: COS_PHI Total (SCALE_FACTOR_MINUS_2 -> 100 = 1.00)
        self.registers[125] = cos_phi_val

        # Reg 132: Temperature AC Heat sink (°C)
        self.registers[132] = int(round(self.ac_heatsink_temp_c))

        # Reg 133..134: DC Voltage Positive & Negative (SCALE_FACTOR_2 -> 264.0V * 10 = 2640)
        v_half = int(round((self.dc_voltage_v / 2.0) * 10.0))
        self.registers[133] = v_half
        self.registers[134] = (-v_half) & 0xFFFF

        # Reg 135: SET_ACTIVE_POWER readback (SCALE_FACTOR_2 -> W / 100)
        self.registers[135] = int(round(self.target_active_power_w / 100.0)) & 0xFFFF

        # Reg 136: SET_REACTIVE_POWER readback (SCALE_FACTOR_2 -> var / 100)
        self.registers[136] = int(round(self.target_reactive_power_var / 100.0)) & 0xFFFF

        # Reg 141: DC_POWER (SCALE_FACTOR_1 -> W / 10)
        self.registers[141] = int(round(self.dc_power_w / 10.0)) & 0xFFFF

        # Reg 142: DC_VOLTAGE (SCALE_FACTOR_2 -> 528.0V * 10 = 5280)
        self.registers[142] = int(round(self.dc_voltage_v * 10.0))

        # Reg 143: DC_CURRENT (SCALE_FACTOR_2 -> 48.5A * 10 = 485)
        self.registers[143] = int(round(self.dc_current_a * 10.0)) & 0xFFFF

        # Reg 144..145: DC_CHARGE_ENERGY (UnsignedDoubleword, Wh / 100)
        chg_dw = int(self.cum_charge_energy_wh / 100.0) & 0xFFFFFFFF
        self.registers[144] = (chg_dw >> 16) & 0xFFFF
        self.registers[145] = chg_dw & 0xFFFF

        # Reg 146..147: DC_DISCHARGE_ENERGY (UnsignedDoubleword, Wh / 100)
        dis_dw = int(self.cum_discharge_energy_wh / 100.0) & 0xFFFFFFFF
        self.registers[146] = (dis_dw >> 16) & 0xFFFF
        self.registers[147] = dis_dw & 0xFFFF

        # Reg 148: Temperature DC Heat sink (°C)
        self.registers[148] = int(round(self.dc_heatsink_temp_c))

        # Reg 224: DC Relay rear end voltage
        self.registers[224] = int(round(self.dc_voltage_v * 10.0))

    def read_holding_registers(self, start_addr, count):
        self.update_physics()
        bytes_out = bytearray()
        for addr in range(start_addr, start_addr + count):
            if 0 <= addr < len(self.registers):
                val = self.registers[addr] & 0xFFFF
            else:
                val = 0
            bytes_out.extend(struct.pack('>H', val))
        return bytes(bytes_out)

    def write_single_register(self, reg_addr, reg_val):
        reg_val = reg_val & 0xFFFF
        if 0 <= reg_addr < len(self.registers):
            self.registers[reg_addr] = reg_val

        # Specific control handlers
        if reg_addr == 650: # START_INVERTER
            if reg_val == 1:
                self.is_running = True
                self.standby_status = 0
                print(f"[PCS Virtual Device] START command received (reg 650=1) -> State: RUNNING", flush=True)

        elif reg_addr == 651: # STOP_INVERTER
            if reg_val == 1:
                self.is_running = False
                self.standby_status = 1
                self.actual_active_power_w = 0.0
                print(f"[PCS Virtual Device] STOP command received (reg 651=1) -> State: STOPPED", flush=True)

        elif reg_addr == 652: # CLEAR_FAILURE
            self.fault_status = 0
            self.alert_status = 0
            print(f"[PCS Virtual Device] CLEAR_FAILURE command received (reg 652=1)", flush=True)

        elif reg_addr == 653: # SET_ON_GRID_MODE
            if reg_val == 1:
                self.grid_mode = 1
                print(f"[PCS Virtual Device] SET_ON_GRID_MODE received (reg 653=1) -> On-Grid", flush=True)

        elif reg_addr == 654: # SET_OFF_GRID_MODE
            if reg_val == 1:
                self.grid_mode = 0
                print(f"[PCS Virtual Device] SET_OFF_GRID_MODE received (reg 654=1) -> Off-Grid", flush=True)

        elif reg_addr == 135: # SET_ACTIVE_POWER (SCALE_FACTOR_2: Channel ActivePower / 100)
            # Signed 16-bit integer
            s_val = reg_val if reg_val < 32768 else reg_val - 65536
            power_w = s_val * 100.0
            if abs(power_w - self.target_active_power_w) > 1.0:
                print(f"[PCS Virtual Device] SET_ACTIVE_POWER setpoint changed: {power_w:.0f} W (reg 135={reg_val})", flush=True)
            self.target_active_power_w = power_w

        elif reg_addr == 136: # SET_REACTIVE_POWER
            s_val = reg_val if reg_val < 32768 else reg_val - 65536
            self.target_reactive_power_var = s_val * 100.0

        self.update_physics()

pcs = VirtualSinexcelPCS()

def generate_pcs_influx_line(edge_tag, ts_sec):
    """Generates InfluxDB Line Protocol for PCS telemetry."""
    pcs.update_physics()
    fields = {
        "batteryInverter0/ActivePower": int(round(pcs.actual_active_power_w)),
        "batteryInverter0/ReactivePower": int(round(pcs.actual_reactive_power_var)),
        "batteryInverter0/ApparentPower": int(round(math.sqrt(pcs.actual_active_power_w**2 + pcs.actual_reactive_power_var**2))),
        "batteryInverter0/Frequency": int(round(pcs.frequency_hz * 1000.0)),
        "batteryInverter0/GridVoltageL1": int(round(pcs.v_l1_l2_v * 1000.0)),
        "batteryInverter0/GridVoltageL2": int(round(pcs.v_l2_l3_v * 1000.0)),
        "batteryInverter0/GridVoltageL3": int(round(pcs.v_l3_l1_v * 1000.0)),
        "batteryInverter0/GridCurrentL1": int(round(pcs.i_l1_a * 1000.0)),
        "batteryInverter0/GridCurrentL2": int(round(pcs.i_l2_a * 1000.0)),
        "batteryInverter0/GridCurrentL3": int(round(pcs.i_l3_a * 1000.0)),
        "batteryInverter0/DcVoltage": int(round(pcs.dc_voltage_v * 1000.0)),
        "batteryInverter0/DcCurrent": int(round(pcs.dc_current_a * 1000.0)),
        "batteryInverter0/DcPower": int(round(pcs.dc_power_w)),
        "batteryInverter0/TemperatureAcHeatSink": int(round(pcs.ac_heatsink_temp_c * 10.0)),
        "batteryInverter0/TemperatureDcHeatSink": int(round(pcs.dc_heatsink_temp_c * 10.0)),
        "batteryInverter0/InverterState": 1 if pcs.is_running else 0,
        "batteryInverter0/GridMode": 1 if pcs.grid_mode == 1 else 0,
        "batteryInverter0/ActiveChargeEnergy": pcs.cum_charge_energy_wh,
        "batteryInverter0/ActiveDischargeEnergy": pcs.cum_discharge_energy_wh,
        "batteryInverter0/CosPhi": int(round(pcs.cos_phi * 1000.0)),
        "batteryInverter0/State": 0
    }
    field_strs = [f"{k}={v}i" for k, v in fields.items()]
    return f"data,edge={edge_tag} " + ",".join(field_strs) + f" {int(ts_sec)}"

async def influx_telemetry_loop():
    """Continuously writes PCS telemetry points to InfluxDB for edge=pcs and edge=0."""
    await asyncio.sleep(2.0)
    print("[PCS InfluxDB Telemetry] Starting periodic telemetry publisher for edge=pcs and edge=0 (interval=2s)...", flush=True)
    while True:
        try:
            now_ts = time.time()
            for edge in ("pcs", "0"):
                line = generate_pcs_influx_line(edge, now_ts)
                body = line.encode("utf-8")
                req = urllib.request.Request(
                    INFLUX_WRITE_URL,
                    data=body,
                    headers={"Authorization": f"Token {AUTH_TOKEN}", "Content-Type": "text/plain; charset=utf-8"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    pass
        except Exception:
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
                reg_bytes = pcs.read_holding_registers(start_addr, count)
                resp_pdu = struct.pack('>BB', fc, len(reg_bytes)) + reg_bytes
                resp_header = struct.pack('>HHHB', trans_id, proto_id, len(resp_pdu) + 1, unit_id)
                writer.write(resp_header + resp_pdu)
                await writer.drain()

            elif fc == 0x06 and len(pdu) >= 5:
                # Write Single Register
                reg_addr, reg_val = struct.unpack('>HH', pdu[1:5])
                pcs.write_single_register(reg_addr, reg_val)
                # Echo back positive confirmation
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
                    pcs.write_single_register(start_addr + idx, val)
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
    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

async def main():
    server = await asyncio.start_server(handle_client, '0.0.0.0', PORT)
    print(f"==================================================================", flush=True)
    print(f"  OpenEMS Virtual PCS Device (Sinexcel PW-100K) Started          ", flush=True)
    print(f"  Listening on Modbus TCP 0.0.0.0:{PORT} (Unit-ID: {UNIT_ID})     ", flush=True)
    print(f"  Nominal: 100kW / 100kVA, 380V AC 3P4W, 50.00Hz, 528V DC Link    ", flush=True)
    print(f"  Telemetry: Live InfluxDB Stream (edge=pcs & edge=0)             ", flush=True)
    print(f"==================================================================", flush=True)

    # Launch telemetry publisher task
    asyncio.create_task(influx_telemetry_loop())

    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())
