#!/usr/bin/env python3
"""
Generate and Inject 30 Days of High-Fidelity Historical Timeseries into InfluxDB
for OpenEMS C&I Energy Storage Power Station Demo.
"""

import os
import time
import math
import random
import urllib.request
import urllib.error
from datetime import datetime, timezone

def _load_influx_token():
    if os.environ.get("INFLUX_TOKEN"):
        return os.environ["INFLUX_TOKEN"]
    env_file = "/etc/openems/influx.env"
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("INFLUX_TOKEN="):
                    return line.strip().split("=", 1)[1].strip('"\'')
    return ""

INFLUX_URL = "http://127.0.0.1:8086/api/v2/write?bucket=openems&org=openems&precision=s"
AUTH_TOKEN = _load_influx_token()
DAYS = 30
STEP_SECONDS = 300  # 5-minute resolution

def post_batch(lines):
    if not lines:
        return
    body = "\n".join(lines).encode("utf-8")
    req = urllib.request.Request(
        INFLUX_URL,
        data=body,
        headers={
            "Authorization": f"Token {AUTH_TOKEN}",
            "Content-Type": "text/plain; charset=utf-8"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            pass
    except urllib.error.HTTPError as e:
        print(f"Error posting batch: {e.code} - {e.read().decode('utf-8')[:300]}")
        raise

def simulate_edge(edge_id, edge_tag, capacity_wh, max_power_w, pv_peak_w, load_base_w, load_peak_w):
    print(f"Generating 30-day timeseries for {edge_id} (tag={edge_tag}, Capacity={capacity_wh/1000:.0f}kWh, MaxP={max_power_w/1000:.0f}kW)...")
    
    now = int(time.time())
    # Align now to 5-minute boundary
    end_time = (now // STEP_SECONDS) * STEP_SECONDS
    start_time = end_time - (DAYS * 86400)
    
    total_steps = (end_time - start_time) // STEP_SECONDS
    
    # Cumulative Energy initial counters (in Wh)
    consumption_energy = 150_000_000  # 150 MWh base
    production_energy  = 90_000_000   # 90 MWh base
    grid_buy_energy    = 100_000_000  # 100 MWh base
    grid_sell_energy   = 20_000_000   # 20 MWh base
    ess_charge_energy  = 45_000_000   # 45 MWh base
    ess_discharge_energy = 42_000_000 # 42 MWh base
    
    current_soc = 55.0
    
    # Pre-generate daily weather factors for 32 days
    random.seed(42 + edge_tag)
    daily_weather = []
    for d in range(35):
        r = random.random()
        if r < 0.75:
            daily_weather.append(random.uniform(0.88, 1.0))  # Sunny
        elif r < 0.90:
            daily_weather.append(random.uniform(0.50, 0.75)) # Cloudy
        else:
            daily_weather.append(random.uniform(0.18, 0.35)) # Rainy
            
    lines_batch = []
    batch_count = 0
    total_written = 0
    
    for step in range(total_steps):
        t = start_time + step * STEP_SECONDS
        dt = datetime.fromtimestamp(t, tz=timezone.utc)
        hour = dt.hour + dt.minute / 60.0
        day_of_week = dt.weekday() # 0 = Monday, 6 = Sunday
        is_weekend = (day_of_week >= 5)
        day_idx = (t - start_time) // 86400
        weather = daily_weather[min(day_idx, len(daily_weather) - 1)]
        
        # 1. Solar PV Model (Peak at 12:30, active between 06:15 and 18:45)
        if 6.25 <= hour <= 18.75:
            norm_h = (hour - 6.25) / (18.75 - 6.25)
            pv_curve = math.sin(math.pi * norm_h) ** 1.3
            pv_noise = random.uniform(0.96, 1.04)
            p_pv = int(pv_peak_w * pv_curve * weather * pv_noise)
        else:
            p_pv = 0
            
        # 2. Industrial Load Model
        if is_weekend:
            # Weekend lighter operations
            load_factor = 0.35 + 0.15 * math.sin(math.pi * hour / 24.0)
            p_load = int(load_base_w + (load_peak_w - load_base_w) * load_factor * random.uniform(0.95, 1.05))
        else:
            # Weekday industrial shifts
            if 0.0 <= hour < 6.5:
                # Night shift / baseload
                load_factor = 0.25 + 0.05 * random.uniform(-1, 1)
            elif 6.5 <= hour < 8.5:
                # Morning ramp-up
                ramp = (hour - 6.5) / 2.0
                load_factor = 0.25 + ramp * 0.55
            elif 8.5 <= hour < 11.5:
                # Morning peak manufacturing shift
                load_factor = 0.85 + 0.12 * math.sin(math.pi * (hour - 8.5) / 3.0)
            elif 11.5 <= hour < 13.5:
                # Midday lunch break dip
                load_factor = 0.55 + 0.08 * random.uniform(-1, 1)
            elif 13.5 <= hour < 17.5:
                # Afternoon full production shift
                load_factor = 0.90 + 0.10 * math.sin(math.pi * (hour - 13.5) / 4.0)
            elif 17.5 <= hour < 20.5:
                # Evening overtime shift
                load_factor = 0.70 + 0.10 * math.sin(math.pi * (hour - 17.5) / 3.0)
            else:
                # Evening wind-down to night shift
                ramp = (24.0 - hour) / 3.5
                load_factor = 0.25 + ramp * 0.40
            p_load = int(load_base_w + (load_peak_w - load_base_w) * load_factor * random.uniform(0.97, 1.03))

        # 3. EV Charging Station (120 kW dual DC charger)
        p_evcs = 0
        if not is_weekend:
            if 7.5 <= hour < 9.5:
                # Morning arrival fast charge
                p_evcs = int(random.choice([60000, 90000, 120000]) * random.uniform(0.92, 1.0))
            elif 12.0 <= hour < 13.5:
                # Lunch hour logistics charging
                p_evcs = int(random.choice([40000, 60000, 80000]) * random.uniform(0.95, 1.0))
            elif 17.0 <= hour < 20.0:
                # Evening fleet charging
                p_evcs = int(random.choice([60000, 90000, 120000]) * random.uniform(0.92, 1.0))
        else:
            if 10.0 <= hour < 16.0 and random.random() < 0.4:
                p_evcs = int(random.choice([30000, 60000]) * random.uniform(0.95, 1.0))

        p_consumption = p_load + p_evcs
        
        # 4. ESS Control Strategy (Two-Charge Two-Discharge Diurnal Cycle)
        p_ess = 0  # positive = discharge, negative = charge
        
        # Valley 1: 00:30 - 05:30 -> Charge from valley grid tariff up to 95%
        if 0.5 <= hour < 5.5:
            if current_soc < 94.0:
                p_ess = -int(max_power_w * 0.55 * random.uniform(0.95, 1.0))
            else:
                p_ess = -int(max_power_w * 0.10) if current_soc < 95.0 else 0
                
        # Morning Peak 1: 08:30 - 11:30 -> Discharge to shave factory peak
        elif 8.5 <= hour < 11.5:
            if current_soc > 25.0:
                # Target grid power around 200kW; ESS covers the rest
                needed = p_consumption - p_pv - int(load_base_w * 1.1)
                p_ess = min(max_power_w, max(0, needed))
            else:
                p_ess = 0
                
        # Solar Valley 2: 11:30 - 14:00 -> Charge from solar excess up to 75%
        elif 11.5 <= hour < 14.0:
            if p_pv > p_consumption:
                excess = p_pv - p_consumption
                if current_soc < 80.0:
                    p_ess = -min(max_power_w, excess)
            elif current_soc < 70.0 and weather > 0.8:
                p_ess = -int(max_power_w * 0.35 * random.uniform(0.95, 1.0))
                
        # Evening Peak 2: 18:00 - 21:00 -> Discharge during highest tariff period
        elif 18.0 <= hour < 21.0:
            if current_soc > 18.0:
                needed = p_consumption - int(load_base_w * 0.9)
                p_ess = min(max_power_w, max(0, needed))
            else:
                p_ess = 0
        else:
            # Flat/Rest periods: small self-consumption balancing
            diff = p_consumption - p_pv
            if diff > 0 and current_soc > 40.0:
                p_ess = min(int(max_power_w * 0.15), diff)
            elif diff < 0 and current_soc < 90.0:
                p_ess = max(-int(max_power_w * 0.15), diff)
            else:
                p_ess = 0

        # Update SoC based on p_ess
        # delta_energy = p_ess * (dt / 3600)
        eff = 0.95 if p_ess < 0 else (1.0 / 0.95)
        delta_soc = -(p_ess * (STEP_SECONDS / 3600.0) / capacity_wh) * 100.0 * (0.96 if p_ess < 0 else 1.04)
        current_soc = max(12.0, min(96.0, current_soc + delta_soc))

        # 5. Grid Active Power (Exact physical equation closure)
        # P_grid = P_consumption - P_pv - P_ess
        p_grid = p_consumption - p_pv - p_ess
        
        # 6. Cumulative Energy Integration (Wh)
        hours_delta = STEP_SECONDS / 3600.0
        consumption_energy   += int(p_consumption * hours_delta)
        production_energy    += int(p_pv * hours_delta)
        if p_grid > 0:
            grid_buy_energy  += int(p_grid * hours_delta)
        else:
            grid_sell_energy += int(-p_grid * hours_delta)
        if p_ess > 0:
            ess_discharge_energy += int(p_ess * hours_delta)
        else:
            ess_charge_energy    += int(-p_ess * hours_delta)
            
        soc_int = int(round(current_soc))
        
        # Format Influx Line Protocol
        # Tags: edge=<edge_tag>
        # Fields: integer values with 'i'
        fields = [
            f"_sum/ConsumptionActivePower={p_consumption}i",
            f"_sum/ProductionActivePower={p_pv}i",
            f"_sum/ProductionAcActivePower={p_pv}i",
            f"_sum/EssActivePower={p_ess}i",
            f"_sum/GridActivePower={p_grid}i",
            f"_sum/EssSoc={soc_int}i",
            f"_sum/ConsumptionActiveEnergy={consumption_energy}i",
            f"_sum/ProductionActiveEnergy={production_energy}i",
            f"_sum/ProductionAcActiveEnergy={production_energy}i",
            f"_sum/GridBuyActiveEnergy={grid_buy_energy}i",
            f"_sum/GridSellActiveEnergy={grid_sell_energy}i",
            f"_sum/EssActiveChargeEnergy={ess_charge_energy}i",
            f"_sum/EssActiveDischargeEnergy={ess_discharge_energy}i",
            f"_sum/State=0i",
            f"ess0/ActivePower={p_ess}i",
            f"ess0/Soc={soc_int}i",
            f"ess0/Capacity={capacity_wh}i",
            f"ess0/MaxApparentPower={max_power_w}i",
            f"ess0/AllowedChargePower={-max_power_w}i",
            f"ess0/AllowedDischargePower={max_power_w}i",
            f"ess0/ActiveChargeEnergy={ess_charge_energy}i",
            f"ess0/ActiveDischargeEnergy={ess_discharge_energy}i",
            f"ess0/State=0i",
            f"meter0/ActivePower={p_grid}i",
            f"meter0/ActiveConsumptionEnergy={grid_buy_energy}i",
            f"meter0/ActiveProductionEnergy={grid_sell_energy}i",
            f"meter0/State=0i",
            f"meter1/ActivePower={p_pv}i",
            f"meter1/ActiveProductionEnergy={production_energy}i",
            f"meter1/State=0i",
            f"evcs0/ActivePower={p_evcs}i",
            f"evcs0/Status={(5 if p_evcs > 0 else 1)}i",
            f"evcs0/ChargeState={(1 if p_evcs > 0 else 0)}i",
            f"evcs0/State=0i"
        ]
        
        line = f"data,edge={edge_tag} " + ",".join(fields) + f" {t}"
        lines_batch.append(line)
        
        if len(lines_batch) >= 400:
            post_batch(lines_batch)
            total_written += len(lines_batch)
            lines_batch.clear()
            
    if lines_batch:
        post_batch(lines_batch)
        total_written += len(lines_batch)
        
    print(f"Successfully wrote {total_written} points for {edge_id} into InfluxDB!")

if __name__ == "__main__":
    t0 = time.time()
    # edge0: 500kW / 1000kWh C&I Solar-Storage-EV Microgrid
    simulate_edge("edge0", 0, capacity_wh=1_000_000, max_power_w=500_000, pv_peak_w=400_000, load_base_w=160_000, load_peak_w=580_000)
    # edge1: 1MW / 2MWh Peak Shaving Station
    simulate_edge("edge1", 1, capacity_wh=2_000_000, max_power_w=1_000_000, pv_peak_w=0, load_base_w=350_000, load_peak_w=1_200_000)
    print(f"All demo timeseries data generated in {time.time() - t0:.2f}s!")
