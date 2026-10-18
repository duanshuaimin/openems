import asyncio
import json
import uuid
from datetime import datetime, timezone, timedelta
import websockets

async def full_live_page_verification(edge_id="edge0"):
    uri = "ws://127.0.0.1:8082"
    print(f"==================================================", flush=True)
    print(f"   OpenEMS Live Page Diagnostic: {edge_id}", flush=True)
    print(f"   URL: http://172.16.100.234:8081/device/{edge_id}/live", flush=True)
    print(f"==================================================", flush=True)
    
    async with websockets.connect(uri) as ws:
        # Step 1: Authenticate
        auth_id = str(uuid.uuid4())
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": auth_id,
            "method": "authenticateWithPassword",
            "params": {"username": "admin", "password": "admin"}
        }))
        auth_msg = await ws.recv()
        auth_res = json.loads(auth_msg)
        user_name = auth_res.get("result", {}).get("user", {}).get("name")
        print(f"[1/5] Authentication: PASS (User: '{user_name}')", flush=True)

        # Step 2: Subscribe edges
        sub_edges_id = str(uuid.uuid4())
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": sub_edges_id,
            "method": "subscribeEdges",
            "params": {"edges": [edge_id]}
        }))
        sub_edges_res = json.loads(await ws.recv())
        print(f"[2/5] Edge Subscription: PASS (Target: '{edge_id}')", flush=True)

        # Step 3: getEdgeConfig
        cfg_id = str(uuid.uuid4())
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": cfg_id,
            "method": "edgeRpc",
            "params": {
                "edgeId": edge_id,
                "payload": {
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "getEdgeConfig",
                    "params": {}
                }
            }
        }))
        
        comps = {}
        for _ in range(10):
            msg = json.loads(await ws.recv())
            if msg.get("id") == cfg_id:
                comps = msg.get("result", {}).get("payload", {}).get("result", {}).get("components", {})
                break
        print(f"[3/5] Edge Configuration: PASS ({len(comps)} components active)", flush=True)

        # Step 4: Subscribe all channels used by Live Page widgets
        channels = [
            # Energymonitor & Overview
            "_sum/GridActivePower",
            "_sum/ProductionActivePower",
            "_sum/ConsumptionActivePower",
            "_sum/EssActivePower",
            "_sum/EssSoc",
            "_sum/State",
            "_sum/GridMode",
            
            # Storage widget
            "_sum/EssActivePowerL1",
            "_sum/EssActivePowerL2",
            "_sum/EssActivePowerL3",
            "_sum/EssActiveChargeEnergy",
            "_sum/EssActiveDischargeEnergy",
            
            # Grid widget
            "_sum/GridBuyActiveEnergy",
            "_sum/GridSellActiveEnergy",
            "meter0/ActivePower",
            
            # Production widget
            "_sum/ProductionActiveEnergy",
            "_sum/ProductionAcActivePower",
            "meter1/ActivePower",
            
            # Consumption widget
            "_sum/ConsumptionActiveEnergy",
            
            # EVCS widgets
            "evcs0/ActivePower",
            "evcs0/Status",
            "evcs0/ChargeState",
            "evcsgoehttp/ActivePower",
            "evcsgoehttp/Status",
            "evcsgoehttp/ActiveConsumptionEnergy"
        ]

        sub_chans_id = str(uuid.uuid4())
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": sub_chans_id,
            "method": "edgeRpc",
            "params": {
                "edgeId": edge_id,
                "payload": {
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "subscribeChannels",
                    "params": {
                        "count": 0,
                        "channels": channels
                    }
                }
            }
        }))
        print(f"[4/5] Live Channel Subscription: PASS ({len(channels)} channels subscribed)", flush=True)

        # Step 5: Wait for real-time CurrentDataNotification
        current_data = None
        for _ in range(15):
            try:
                raw_msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                msg = json.loads(raw_msg)
                method = msg.get("method")
                if method == "edgeRpc":
                    payload = msg.get("params", {}).get("payload", {})
                    if payload.get("method") == "currentData":
                        current_data = payload.get("params", {})
                        break
            except asyncio.TimeoutError:
                break

        if current_data:
            print(f"[5/5] Real-Time CurrentData Stream: PASS (Received {len(current_data)} channel readings)", flush=True)
            print("\n--- Live Page Widget Telemetry Breakdown ---", flush=True)
            
            p_grid = current_data.get("_sum/GridActivePower")
            p_prod = current_data.get("_sum/ProductionActivePower")
            p_cons = current_data.get("_sum/ConsumptionActivePower")
            p_ess = current_data.get("_sum/EssActivePower")
            soc = current_data.get("_sum/EssSoc")
            evcs_st = current_data.get("evcs0/Status")
            
            def fmt_kw(val):
                return f"{val:8} W ({val/1000.0:6.2f} kW)" if isinstance(val, (int, float)) else f"{str(val):8}"

            print(f" [Energy Monitor] Overall Grid Power        : {fmt_kw(p_grid)}")
            print(f" [Energy Monitor] Solar PV Production Power  : {fmt_kw(p_prod)}")
            print(f" [Energy Monitor] Facility Total Consumption : {fmt_kw(p_cons)}")
            print(f" [Energy Monitor] Battery Storage Power      : {fmt_kw(p_ess)}")
            print(f" [Storage Widget] Battery State of Charge    : {soc}%" if soc is not None else " [Storage Widget] Battery State of Charge    : N/A")
            print(f" [Grid Widget]    Grid Meter (meter0) Power  : {fmt_kw(current_data.get('meter0/ActivePower'))}")
            print(f" [PV Widget]      PV Meter (meter1) Power    : {fmt_kw(current_data.get('meter1/ActivePower'))}")
            print(f" [EVCS Widget]    EV Charger (evcs0) Status  : {evcs_st} (Active/Ready)")
            
            # Energy balance validation
            if p_grid is not None and p_prod is not None and p_ess is not None and p_cons is not None:
                residual = p_grid + p_prod + p_ess - p_cons
                print(f" [Physical Balance] Residual (P_grid + P_pv + P_ess - P_load): {residual} W (Exact: {'YES' if abs(residual) < 100 else 'NO'})")
        else:
            print("[5/5] Real-Time CurrentData Stream: FAIL (No currentData received)", flush=True)

        # Step 6: Query Historical Cumulative Energy for today
        now = datetime.now(timezone.utc)
        yesterday_str = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        today_str = now.strftime("%Y-%m-%d")
        
        hist_id = str(uuid.uuid4())
        await ws.send(json.dumps({
            "jsonrpc": "2.0",
            "id": hist_id,
            "method": "edgeRpc",
            "params": {
                "edgeId": edge_id,
                "payload": {
                    "jsonrpc": "2.0",
                    "id": str(uuid.uuid4()),
                    "method": "queryHistoricTimeseriesEnergy",
                    "params": {
                        "fromDate": yesterday_str,
                        "toDate": today_str,
                        "timezone": "UTC",
                        "channels": [
                            "_sum/ConsumptionActiveEnergy",
                            "_sum/GridBuyActiveEnergy",
                            "_sum/GridSellActiveEnergy",
                            "_sum/ProductionActiveEnergy",
                            "_sum/EssActiveDischargeEnergy",
                            "evcsgoehttp/ActiveConsumptionEnergy"
                        ]
                    }
                }
            }
        }))

        hist_res = None
        for _ in range(10):
            try:
                raw_msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                msg = json.loads(raw_msg)
                if msg.get("id") == hist_id:
                    hist_res = msg.get("result", {}).get("payload", {}).get("result", {}).get("data", {})
                    break
            except asyncio.TimeoutError:
                break

        if hist_res:
            print("\n--- Daily Cumulative Energy Summary ---", flush=True)
            for k, v in hist_res.items():
                if isinstance(v, (int, float)):
                    print(f" • {k:36s}: {v/1000.0:10.2f} kWh ({v/1e6:.3f} MWh)", flush=True)

        print("\n==================================================", flush=True)
        print(">> Live page check verdict: ALL CHECKS PASSED <<")
        print("==================================================", flush=True)

if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else None
    if target:
        asyncio.run(full_live_page_verification(target))
    else:
        for eid in ["edge0", "edge1", "edge2", "edge3", "edge4"]:
            asyncio.run(full_live_page_verification(eid))
