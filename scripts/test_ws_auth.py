import asyncio
import json
import uuid
import websockets

async def test_backend_auth():
    uri = "ws://127.0.0.1:8082"
    async with websockets.connect(uri) as ws:
        # Step 1: authenticateWithPassword
        req_id_1 = str(uuid.uuid4())
        auth_req = {
            "jsonrpc": "2.0",
            "id": req_id_1,
            "method": "authenticateWithPassword",
            "params": {
                "username": "admin",
                "password": "admin"
            }
        }
        await ws.send(json.dumps(auth_req))
        auth_resp_raw = await ws.recv()
        print("Auth Response:", auth_resp_raw)
        auth_resp = json.loads(auth_resp_raw)
        assert "result" in auth_resp, f"Auth failed: {auth_resp_raw}"
        token = auth_resp["result"]["token"]
        print("Obtained Token (session_id):", token)

        # Step 2: Query getEdges
        req_id_2 = str(uuid.uuid4())
        edges_req = {
            "jsonrpc": "2.0",
            "id": req_id_2,
            "method": "getEdges",
            "params": {
                "page": 0,
                "limit": 10
            }
        }
        await ws.send(json.dumps(edges_req))
        edges_resp_raw = await ws.recv()
        print("Edges Response:", edges_resp_raw)
        edges_resp = json.loads(edges_resp_raw)
        assert "result" in edges_resp, f"GetEdges failed: {edges_resp_raw}"
        devices = edges_resp["result"]["edges"]
        print(f"Success! User admin has {len(devices)} device(s):", [d["id"] for d in devices])
        print("Device details:", json.dumps(devices, indent=2))

asyncio.run(test_backend_auth())
