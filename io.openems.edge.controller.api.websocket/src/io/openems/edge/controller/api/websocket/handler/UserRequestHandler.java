package io.openems.edge.controller.api.websocket.handler;

import java.util.UUID;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import io.openems.common.jsonrpc.base.GenericJsonrpcResponseSuccess;
import io.openems.common.jsonrpc.base.JsonrpcRequest;
import io.openems.common.jsonrpc.base.JsonrpcResponseSuccess;
import io.openems.common.jsonrpc.request.UpdateUserLanguageRequest;
import io.openems.common.jsonrpc.request.UpdateUserSettingsRequest;
import io.openems.common.utils.JsonUtils;
import io.openems.edge.common.jsonapi.Call;
import io.openems.edge.common.jsonapi.EdgeKeys;
import io.openems.edge.common.jsonapi.JsonApi;
import io.openems.edge.common.jsonapi.JsonApiBuilder;
import io.openems.edge.common.user.UserService;

@Component(property = "entry=" + RootRequestHandler.ENTRY_POINT)
public class UserRequestHandler implements JsonApi {

	@Reference
	private UserService userService;

	@Override
	public void buildJsonApiRoutes(JsonApiBuilder builder) {

		builder.handleRequest(UpdateUserSettingsRequest.METHOD,
				call -> new GenericJsonrpcResponseSuccess(call.getRequest().getId()));

		builder.handleRequest(UpdateUserLanguageRequest.METHOD, call -> {
			final var request = UpdateUserLanguageRequest.from(call.getRequest());
			this.userService.updateLanguage(request.getLanguage());

			return new GenericJsonrpcResponseSuccess(call.getRequest().getId());
		});

		builder.handleRequest("getUserInformation", call -> {
			return handleGetUserInformationRequest(call);
		});

		builder.handleRequest("setUserInformation",
				call -> new GenericJsonrpcResponseSuccess(call.getRequest().getId()));

		builder.handleRequest("registerUser",
				call -> new GenericJsonrpcResponseSuccess(call.getRequest().getId()));

		builder.handleRequest("appCenter", call -> {
			return handleAppCenterRequest(call.getRequest().getId(), call.getRequest().getParams());
		});
	}

	public static JsonrpcResponseSuccess handleGetUserInformationRequest(
			Call<? extends JsonrpcRequest, ?> call) {
		final var user = call.get(EdgeKeys.USER_KEY);
		final var username = user != null && user.getName() != null ? user.getName() : "admin";

		final var userJson = JsonUtils.buildJsonObject() //
				.addProperty("firstname", username) //
				.addProperty("lastname", "") //
				.addProperty("email", username + "@openems.io") //
				.addProperty("phone", "") //
				.add("address", JsonUtils.buildJsonObject() //
						.addProperty("street", "") //
						.addProperty("zip", "") //
						.addProperty("city", "") //
						.addProperty("country", "") //
						.build()) //
				.add("company", JsonUtils.buildJsonObject() //
						.addProperty("name", "") //
						.build()) //
				.build();

		return new GenericJsonrpcResponseSuccess(call.getRequest().getId(), JsonUtils.buildJsonObject() //
				.add("user", userJson) //
				.build());
	}

	public static JsonrpcResponseSuccess handleAppCenterRequest(UUID id, JsonObject params) {
		JsonObject payload = null;
		if (params != null && params.has("payload") && params.get("payload").isJsonObject()) {
			payload = params.getAsJsonObject("payload");
		}
		var subMethod = payload != null && payload.has("method") ? payload.get("method").getAsString() : "";
		var subParams = payload != null && payload.has("params") && payload.get("params").isJsonObject() //
				? payload.getAsJsonObject("params") : new JsonObject();

		return switch (subMethod) {
		case "isAppFree" -> new GenericJsonrpcResponseSuccess(id, JsonUtils.buildJsonObject() //
				.addProperty("isAppFree", true) //
				.build());

		case "getRegisteredKeys" -> new GenericJsonrpcResponseSuccess(id, JsonUtils.buildJsonObject() //
				.add("keys", new JsonArray()) //
				.build());

		case "getPossibleApps" -> new GenericJsonrpcResponseSuccess(id, JsonUtils.buildJsonObject() //
				.add("bundles", new JsonArray()) //
				.build());

		case "isKeyApplicable" -> {
			var key = subParams.has("key") ? subParams.get("key").getAsString() : "";
			yield new GenericJsonrpcResponseSuccess(id, JsonUtils.buildJsonObject() //
					.addProperty("isKeyApplicable", true) //
					.add("additionalInfo", JsonUtils.buildJsonObject() //
							.addProperty("keyId", key) //
							.add("bundles", new JsonArray()) //
							.add("registrations", new JsonArray()) //
							.add("usages", new JsonArray()) //
							.build()) //
					.build());
		}

		case "getInstalledApps" -> new GenericJsonrpcResponseSuccess(id, JsonUtils.buildJsonObject() //
				.add("installedApps", new JsonArray()) //
				.build());

		default -> new GenericJsonrpcResponseSuccess(id);
		};
	}

}
