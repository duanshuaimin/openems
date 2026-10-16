from odoo import http


class OpenemsBackend(http.Controller):
    def _get_user_rec(self, external_uid, fields):
        res_users = http.request.env["res.users"].sudo()
        user_id = None
        # 1. Check if external_uid is a session ID in session_store
        if external_uid and hasattr(http.root, "session_store"):
            try:
                sess = http.root.session_store.get(str(external_uid))
                if sess and getattr(sess, "uid", None):
                    user_id = sess.uid
            except Exception:
                pass

        # 2. Check if current request session has uid
        if not user_id and getattr(http.request, "session", None) and getattr(http.request.session, "uid", None):
            user_id = http.request.session.uid

        # 3. Check context uid
        if not user_id and http.request.env.context.get("uid"):
            user_id = http.request.env.context.get("uid")

        # 4. If user_id found, query by id
        if user_id:
            recs = res_users.search_read([("id", "=", user_id)], fields)
            if recs:
                return recs[0]

        # 5. Search by oauth_uid
        if external_uid:
            recs = res_users.search_read([("oauth_uid", "=", str(external_uid))], fields)
            if recs:
                return recs[0]

            # 6. Search by login
            recs = res_users.search_read([("login", "=", str(external_uid))], fields)
            if recs:
                return recs[0]

            # 7. Search by id if integer
            if str(external_uid).isdigit():
                recs = res_users.search_read([("id", "=", int(external_uid))], fields)
                if recs:
                    return recs[0]

        raise ValueError(f"User not found for identifier [{external_uid}]")

    @http.route("/openems_backend/info", auth="user", type="json")
    def index(self, external_uid=None):
        # Get user
        user_rec = self._get_user_rec(
            external_uid,
            ["login", "name", "groups_id", "global_role", "openems_language", "settings"],
        )

        # Get res group model
        res_groups_model = http.request.env["res.groups"].sudo()

        # Get Manager and Reader group
        manager_group = res_groups_model.env.ref("openems.group_openems_manager")
        reader_group = res_groups_model.env.ref("openems.group_openems_reader")

        manager_group_id = manager_group["id"]
        reader_group_id = reader_group["id"]

        settings = user_rec["settings"] if user_rec.get("settings") else {}

        # Get user attributes
        global_role = user_rec["global_role"]
        if manager_group_id in user_rec["groups_id"]:
            # Manager group
            global_role = "admin"

        has_multiple_edges = False
        if manager_group_id in user_rec["groups_id"] or reader_group_id in user_rec["groups_id"]:
            has_multiple_edges = True
        else:
            device_user_role_model = http.request.env["openems.device_user_role"]
            user_role_ids = device_user_role_model.search_read(
                [("user_id", "=", user_rec["id"])], ["id"], limit=2
            )
            has_multiple_edges = len(user_role_ids) > 1

        return {
            "user": {
                "id": user_rec["id"],
                "login": user_rec["login"],
                "name": user_rec["name"],
                "global_role": global_role,
                "language": user_rec["openems_language"],
                "has_multiple_edges": has_multiple_edges,
                "settings": settings
            },
            "devices": [],
        }

    @http.route("/openems_backend/get_edge_with_role", auth="user", type="json")
    def get_edge_with_role(self, external_uid=None, edge_id: str = None):
        user_rec = self._get_user_rec(external_uid, ["login", "name", "groups_id"])

        # Get res group model
        res_groups_model = http.request.env["res.groups"].sudo()

        # Get Manager and Reader group
        manager_group = res_groups_model.env.ref("openems.group_openems_manager")
        reader_group = res_groups_model.env.ref("openems.group_openems_reader")

        manager_group_id = manager_group["id"]
        reader_group_id = reader_group["id"]

        # get devices for which the user has permissions
        device_model = http.request.env["openems.device"]
        devices = device_model.with_user(user_rec["id"]).search_read(
            [("name", "=", edge_id)],
            ["id", "name", "comment", "producttype", "lastmessage", "first_setup_protocol_date", "openems_sum_state_level", "settings"])

        if len(devices) != 1:
            return {}

        device = devices[0]

        # Get specific Device roles
        device_user_role_model = http.request.env["openems.device_user_role"]
        device_user_roles = device_user_role_model.search_read(
            [("user_id", "=", user_rec["id"]),
             ("device_id", "=", device["id"])], ["id", "role"]
        )

        # Set user role per group
        role = "guest"
        if manager_group_id in user_rec["groups_id"]:
            # Manager group
            role = "admin"
        elif reader_group_id in user_rec["groups_id"]:
            # Reader group
            role = "guest"

        # Set specific user role
        if len(device_user_roles) > 0:
            role = device_user_roles[0]["role"]

        dev = {
            "id": device["id"],
            "name": device["name"],
            "comment": device["comment"],
            "producttype": device["producttype"],
            "role": role,
            "lastmessage": device["lastmessage"],
            "openems_sum_state_level": device["openems_sum_state_level"]
        }
        if device.get("settings"):
            dev["settings"] = device["settings"]

        if device["first_setup_protocol_date"]:
            dev["first_setup_protocol_date"] = device["first_setup_protocol_date"]

        return dev

    @http.route("/openems_backend/get_edges", auth="user", type="json")
    def get_edges(self, external_uid=None, limit=10, page=0, query=None, searchParams=None):
        # Get user
        user_rec = self._get_user_rec(external_uid, ["login", "name", "groups_id", "global_role"])

        # Get res group model
        res_groups_model = http.request.env["res.groups"].sudo()

        # Get Manager and Reader group
        manager_group = res_groups_model.env.ref("openems.group_openems_manager")
        reader_group = res_groups_model.env.ref("openems.group_openems_reader")

        manager_group_id = manager_group["id"]
        reader_group_id = reader_group["id"]

        # Get specific Device roles
        device_user_role_model = http.request.env["openems.device_user_role"]
        user_role_ids = device_user_role_model.search_read(
            [("user_id", "=", user_rec["id"])], ["id", "role"]
        )

        domains = []
        logical_operators = []
        additional_domains = []
        order = ""
        if query:
            logical_operators.extend(['|', '|'])
            domains = [
                ("name", "ilike", query),
                ("comment", "ilike", query),
                ("producttype", "ilike", query)]

        if searchParams:
            if searchParams.get("producttype"):
                additional_domains.append(
                    ("producttype", "in", searchParams.get("producttype")))

            if searchParams.get("sumState"):
                sum_states = list(map(lambda s: s.lower(), searchParams.get("sumState")))
                additional_domains.append(
                    ("openems_sum_state_level", "in", sum_states))

            if searchParams.get("orderState"):

                def map_field(input):
                    lookup = {"id": "name_number", "comment": "comment", "sumState": "openems_sum_state_level"}
                    field = lookup.get(input)

                    if not field:
                        raise ValueError("{input} is not supported")
                    return field
                
                order_state = list(map(lambda s: (map_field(s["field"]), s["sortOrder"]), searchParams.get("orderState")))
                
                for index, item in enumerate(order_state):
                    order += item[0] + " " + item[1]

                    if index < (len(order_state) - 1):
                        order += ","

            if "isOnline" in searchParams:
                additional_domains.append(
                    ("openems_is_connected", "=", searchParams.get("isOnline")))

            if len(additional_domains) > 1:
                for _ in range(len(additional_domains) - 1):
                    logical_operators.insert(0, '&')

        # insert 'and' if both are not 'None'
        if query and searchParams:
            logical_operators.insert(0, '&')

        domains.extend(additional_domains)
        logical_operators.extend(domains)

        # Get Devices
        device_model = http.request.env["openems.device"]
        devices = device_model.with_user(user_rec["id"]).search_read(
            logical_operators,
            ["id", "name", "user_role_ids", "comment", "producttype",
                "lastmessage", "first_setup_protocol_date", "openems_sum_state_level", "settings"],
            order=order,
            limit=limit, offset=(page * limit)
        )
        devs = []
        for device_rec in devices:
            # Set user role per group
            role = "guest"
            if manager_group_id in user_rec["groups_id"]:
                # Manager group
                role = "admin"
            elif reader_group_id in user_rec["groups_id"]:
                # Reader group
                role = "guest"

            # Set specific user role
            for device_role_id in device_rec["user_role_ids"]:
                for user_role_id in user_role_ids:
                    if device_role_id == user_role_id["id"]:
                        role = user_role_id["role"]

            # Prepare result
            dev = {
                "id": device_rec["id"],
                "name": device_rec["name"],
                "comment": device_rec["comment"],
                "producttype": device_rec["producttype"],
                "role": role,
                "lastmessage": device_rec["lastmessage"],
                "openems_sum_state_level": device_rec["openems_sum_state_level"]
            }
            
            if device_rec.get("settings"):
                dev["settings"] = device_rec["settings"]


            if device_rec["first_setup_protocol_date"]:
                dev["first_setup_protocol_date"] = device_rec[
                    "first_setup_protocol_date"
                ]

            devs.append(dev)

        return {
            "devices": devs,
        }

    @http.route("/openems_backend/set_user_settings", auth="user", type="json")
    def set_user_settings(self, userId=None, external_uid=None, settings=None, **kwargs):
        """Update user settings in res.users."""
        uid_to_find = userId or external_uid
        user_rec = self._get_user_rec(uid_to_find, ["id", "login", "settings", "openems_language"])
        user = http.request.env["res.users"].sudo().browse(user_rec["id"])

        vals = {}
        if settings is not None:
            vals["settings"] = settings
            if isinstance(settings, dict):
                lang = settings.get("language")
                if lang:
                    lang_map = {
                        "de": "DE", "en": "EN", "zh": "ZH", "es": "ES",
                        "fr": "FR", "cz": "CZ", "nl": "NL", "hu": "HU", "ja": "JA"
                    }
                    mapped_lang = lang_map.get(lang.lower())
                    if mapped_lang:
                        vals["openems_language"] = mapped_lang

        if vals:
            user.write(vals)
        return {}

    @http.route("/openems_backend/set_edge_settings", auth="user", type="json")
    def set_edge_settings(self, edgeId=None, edge_id=None, settings=None, **kwargs):
        """Update edge settings in openems.device."""
        target_edge = edgeId or edge_id
        if not target_edge:
            raise ValueError("edgeId is required")
        device = http.request.env["openems.device"].sudo().search([("name", "=", str(target_edge))], limit=1)
        if not device and str(target_edge).isdigit():
            device = http.request.env["openems.device"].sudo().browse(int(target_edge))
        if not device:
            raise ValueError(f"Device not found for [{target_edge}]")

        if settings is not None:
            device.write({"settings": settings})
        return {}
