package io.openems.edge.simulator.ess.symmetric.reacting;

import org.osgi.service.event.EventHandler;

import io.openems.common.channel.Unit;
import io.openems.common.types.OpenemsType;
import io.openems.edge.common.channel.Doc;
import io.openems.edge.common.component.OpenemsComponent;
import io.openems.edge.common.modbusslave.ModbusSlave;
import io.openems.edge.common.startstop.StartStoppable;
import io.openems.edge.ess.api.ManagedSymmetricEss;
import io.openems.edge.ess.api.SymmetricEss;
import io.openems.edge.timedata.api.TimedataProvider;

public interface SimulatorEssSymmetricReacting extends ManagedSymmetricEss, SymmetricEss, OpenemsComponent,
		TimedataProvider, EventHandler, StartStoppable, ModbusSlave {

	public enum ChannelId implements io.openems.edge.common.channel.ChannelId {
		ACTIVE_POWER_L1(Doc.of(OpenemsType.INTEGER).unit(Unit.WATT)), //
		ACTIVE_POWER_L2(Doc.of(OpenemsType.INTEGER).unit(Unit.WATT)), //
		ACTIVE_POWER_L3(Doc.of(OpenemsType.INTEGER).unit(Unit.WATT)), //
		VOLTAGE(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIVOLT)), //
		VOLTAGE_L1(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIVOLT)), //
		VOLTAGE_L2(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIVOLT)), //
		VOLTAGE_L3(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIVOLT)), //
		CURRENT(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIAMPERE)), //
		CURRENT_L1(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIAMPERE)), //
		CURRENT_L2(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIAMPERE)), //
		CURRENT_L3(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIAMPERE)), //
		DC_VOLTAGE(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIVOLT)), //
		DC_CURRENT(Doc.of(OpenemsType.INTEGER).unit(Unit.MILLIAMPERE));

		private final Doc doc;

		private ChannelId(Doc doc) {
			this.doc = doc;
		}

		@Override
		public Doc doc() {
			return this.doc;
		}
	}
}
