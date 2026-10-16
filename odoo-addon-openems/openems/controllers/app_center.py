from odoo import http
import logging

_logger = logging.getLogger(__name__)


class OpenemsAppCenter(http.Controller):

    @http.route("/openems_app_center/get_installed_apps", auth="user", type="json")
    def get_installed_apps(self, edgeId=None, **kwargs):
        """Returns installed apps on edge."""
        _logger.debug("OpenEMS AppCenter get_installed_apps requested for edgeId: %s", edgeId)
        return {"installedApps": []}

    @http.route("/openems_app_center/get_possible_apps", auth="user", type="json")
    def get_possible_apps(self, edgeId=None, key=None, **kwargs):
        """Returns available/possible apps for edge."""
        _logger.debug("OpenEMS AppCenter get_possible_apps requested for edgeId: %s", edgeId)
        return {"bundles": []}

    @http.route("/openems_app_center/get_registered_key", auth="user", type="json")
    def get_registered_key(self, edgeId=None, **kwargs):
        """Returns registered app center keys."""
        return {"keys": []}

    @http.route("/openems_app_center/is_key_applicable", auth="user", type="json")
    def is_key_applicable(self, edgeId=None, key=None, **kwargs):
        """Validates if an app center key can be used."""
        return {
            "isKeyApplicable": False,
            "additionalInfo": {
                "keyId": key or "",
                "bundles": [],
                "registrations": [],
                "usages": [],
            },
        }

    @http.route("/openems_app_center/add_install_app_instance_history", auth="user", type="json")
    def add_install_app_instance_history(self, **kwargs):
        return {}

    @http.route("/openems_app_center/add_deinstall_app_instance_history", auth="user", type="json")
    def add_deinstall_app_instance_history(self, **kwargs):
        return {}

    @http.route("/openems_app_center/add_register_key_history", auth="user", type="json")
    def add_register_key_history(self, **kwargs):
        return {}

    @http.route("/openems_app_center/add_deregister_key_history", auth="user", type="json")
    def add_deregister_key_history(self, **kwargs):
        return {}
