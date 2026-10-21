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
"""

import asyncio
import struct
import time
import math
import random
import os
import sys

PORT = 8503
UNIT_ID = 1

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
            # Simulate a realistic industrial microgrid storage power profile:
            # Gentle sinusoidal fluctuation with occasional steady states (+18A discharge, -25A charge, or idle)
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
            # 1 Ah = 3600 A*s -> delta_soc = -(I * dt) / (Capacity_Ah * 3600) * 100
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
            # Nominal ~3.22V, range 2.8V ~ 3.45V per cell
            cell_ocv = 3.20 + 0.0035 * (self.soc - 50.0) + (0.05 * math.tanh((self.soc - 50.0) / 15.0))
            # Battery Terminal Voltage = OCV - I * R_internal
            pack_terminal_v = (cell_ocv * 160.0) - (self.current_a * self.internal_resistance_ohm)
            self.pack_voltage_v = max(420.0, min(560.0, pack_terminal_v))

            # Cell Voltages in mV
            avg_cell_mv = int((self.pack_voltage_v / 160.0) * 1000.0)
            # Micro-dispersion between cells
            self.max_cell_v_mv = avg_cell_mv + 14 + int(random.uniform(-1, 2))
            self.min_cell_v_mv = avg_cell_mv - 12 - int(random.uniform(-1, 2))

            # Thermal dynamics (Joule heating + ambient dissipation)
            heat_gen = (self.current_a ** 2) * self.internal_resistance_ohm * 0.0005
            self.pack_temp_c += (self.ambient_temp_c + heat_gen - self.pack_temp_c) * 0.02
            self.max_cell_temp_c = self.pack_temp_c + 1.2 + random.uniform(-0.1, 0.1)
            self.min_cell_temp_c = self.pack_temp_c - 1.1 + random.uniform(-0.1, 0.1)

            # Dynamic BMS Envelope (Derating curves near SOC boundary)
            if self.soc > 90.0:
                # Taper charge current limit smoothly
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
        # Current in 0.01 A, signed 32-bit:
        self.set_s32(0x1104, int(round(self.current_a * 100.0)))
        self.set_s16(0x1106, int(round(self.pack_temp_c * 10.0)))     # Scale 0.1 °C
        self.set_u16(0x1107, int(round(self.soc)))                    # SOC %
        self.set_u16(0x1108, self.cycle_count)                        # Full Cycles
        self.set_u16(0x1109, int(round(self.charge_max_voltage_v * 10.0)))
        # BP_CHARGE_BMS: positive 32-bit int, Scale 0.01 A
        self.set_s32(0x110A, int(round(self.charge_max_current_a * 100.0)))
        self.set_u16(0x110C, int(round(self.discharge_min_voltage_v * 10.0)))
        # BP_DISCHARGE_BMS: Pylontech spec uses negative 32-bit int, Scale 0.01 A
        self.set_s32(0x110D, -int(round(self.discharge_max_current_a * 100.0)))

        # 4. Circuit Status (0x110F)
        # bit 0: discharge active, bit 1: charge active, bit 6: fan active
        self.set_u16(0x110F, 0x0043 if self.is_awake else 0x0000)

        # 5. Cell Extremes (0x1110..0x111F)
        self.set_u16(0x1110, self.max_cell_v_mv)
        self.set_u16(0x1111, self.min_cell_v_mv)
        self.set_u16(0x1112, self.max_v_cell_no)
        self.set_u16(0x1113, self.min_v_cell_no)
        self.set_s16(0x1114, int(round(self.max_cell_temp_c * 10.0)))
        self.set_s16(0x1115, int(round(self.min_cell_temp_c * 10.0)))
        self.set_u16(0x1116, self.max_temp_cell_no)
        self.set_u16(0x1117, self.min_temp_cell_no)

        # Module Extremes (10 modules, ~51.2V each)
        mod_avg_v = self.pack_voltage_v / 10.0
        self.set_u16(0x1118, int(round((mod_avg_v + 0.35) * 100.0))) # Max Module V
        self.set_u16(0x1119, int(round((mod_avg_v - 0.28) * 100.0))) # Min Module V
        self.set_u16(0x111A, 2)
        self.set_u16(0x111B, 1)
        self.set_s16(0x111C, int(round((self.pack_temp_c + 0.8) * 10.0)))
        self.set_s16(0x111D, int(round((self.pack_temp_c - 0.7) * 10.0)))
        self.set_u16(0x111E, 2)
        self.set_u16(0x111F, 1)

        # 6. SOH & Capacities (0x1120..0x1131)
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
        self.set_u16(0x1131, 0) # Piles in parallel = 0 (prevents duplicate pile channel warnings)
        self.set_u16(0x1132, 0) # Error bits = 0

        # 7. Architecture & Insulation (0x1136..0x1149)
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

async def handle_client(reader, writer):
    peer = writer.get_extra_info('peername')
    # print(f"[BMS ModbusTCP] Connection established from {peer}", flush=True)
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
        # print(f"[BMS ModbusTCP] Client error: {e}", flush=True)
        pass
    finally:
        writer.close()
        await writer.wait_closed()

async def main():
    server = await asyncio.start_server(handle_client, '0.0.0.0', PORT)
    print(f"==================================================================", flush=True)
    print(f"  OpenEMS Virtual BMS Device (Pylontech Powercube M2) Started    ", flush=True)
    print(f"  Listening on Modbus TCP 0.0.0.0:{PORT} (Unit-ID: {UNIT_ID})     ", flush=True)
    print(f"  Nominal: 512.0V, 100kWh, 160 LiFePO4 Cells in Series            ", flush=True)
    print(f"==================================================================", flush=True)
    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())
