package io.openems.edge.simulator.ess.symmetric.reacting;

import static io.openems.edge.common.channel.ChannelUtils.setValue;
import static io.openems.edge.common.event.EdgeEventConstants.TOPIC_CYCLE_AFTER_PROCESS_IMAGE;
import static org.osgi.service.component.annotations.ConfigurationPolicy.REQUIRE;
import static org.osgi.service.component.annotations.ReferenceCardinality.OPTIONAL;
import static org.osgi.service.component.annotations.ReferencePolicy.DYNAMIC;
import static org.osgi.service.component.annotations.ReferencePolicyOption.GREEDY;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;

import org.osgi.service.component.ComponentContext;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;
import org.osgi.service.event.propertytypes.EventTopics;
import org.osgi.service.metatype.annotations.Designate;

import io.openems.common.channel.AccessMode;
import io.openems.common.exceptions.OpenemsException;
import io.openems.edge.common.component.AbstractOpenemsComponent;
import io.openems.edge.common.component.ComponentManager;
import io.openems.edge.common.component.OpenemsComponent;
import io.openems.edge.common.modbusslave.ModbusSlave;
import io.openems.edge.common.modbusslave.ModbusSlaveNatureTable;
import io.openems.edge.common.modbusslave.ModbusSlaveTable;
import io.openems.edge.common.startstop.StartStop;
import io.openems.edge.common.startstop.StartStoppable;
import io.openems.edge.ess.api.ManagedSymmetricEss;
import io.openems.edge.ess.api.SymmetricEss;
import io.openems.edge.ess.power.api.Power;
import io.openems.edge.timedata.api.Timedata;
import io.openems.edge.timedata.api.TimedataProvider;
import io.openems.edge.timedata.api.utils.CalculateEnergyFromPower;

@Designate(ocd = Config.class, factory = true)
@Component(//
		name = "Simulator.EssSymmetric.Reacting", //
		immediate = true, //
		configurationPolicy = REQUIRE)
@EventTopics({ //
		TOPIC_CYCLE_AFTER_PROCESS_IMAGE })
public class SimulatorEssSymmetricReactingImpl extends AbstractOpenemsComponent
		implements SimulatorEssSymmetricReacting, ManagedSymmetricEss, SymmetricEss, OpenemsComponent, TimedataProvider,
		EventHandler, StartStoppable, ModbusSlave {

	private final CalculateEnergyFromPower calculateChargeEnergy = new CalculateEnergyFromPower(this,
			SymmetricEss.ChannelId.ACTIVE_CHARGE_ENERGY);
	private final CalculateEnergyFromPower calculateDischargeEnergy = new CalculateEnergyFromPower(this,
			SymmetricEss.ChannelId.ACTIVE_DISCHARGE_ENERGY);

	@Reference
	private Power power;

	@Reference
	private ComponentManager componentManager;

	@Reference(policy = DYNAMIC, policyOption = GREEDY, cardinality = OPTIONAL)
	private volatile Timedata timedata = null;

	/** Current Energy in the battery [Wms], based on SoC. */
	private long energy = 0;
	private Config config;

	public SimulatorEssSymmetricReactingImpl() {
		super(//
				OpenemsComponent.ChannelId.values(), //
				SymmetricEss.ChannelId.values(), //
				ManagedSymmetricEss.ChannelId.values(), //
				StartStoppable.ChannelId.values(), //
				SimulatorEssSymmetricReacting.ChannelId.values() //
		);
	}

	@Activate
	private void activate(ComponentContext context, Config config) throws IOException {
		super.activate(context, config.id(), config.alias(), config.enabled());

		this.config = config;
		this.energy = (long) ((double) config.capacity() /* [Wh] */ * 3600 /* [Wsec] */ * 1000 /* [Wmsec] */
				/ 100 * this.config.initialSoc() /* [current SoC] */);
		this._setSoc(config.initialSoc());
		this._setMaxApparentPower(config.maxApparentPower());
		setValue(this, ManagedSymmetricEss.ChannelId.ALLOWED_CHARGE_POWER,
				calculateAllowedChargePower(config.initialSoc(), config.maxChargePower()) * -1);
		setValue(this, ManagedSymmetricEss.ChannelId.ALLOWED_DISCHARGE_POWER,
				calculateAllowedDischargePower(config.initialSoc(), config.maxDischargePower()));
		setValue(this, SymmetricEss.ChannelId.GRID_MODE, config.gridMode());
		this._setCapacity(config.capacity());
		this.calculateChargeEnergy.setBaseEnergyManually(1_468_970L);
		this.calculateDischargeEnergy.setBaseEnergyManually(1_468_970L);
		this.updateSimulatedChannels();
	}

	@Override
	@Deactivate
	protected void deactivate() {
		super.deactivate();
	}

	@Override
	public void handleEvent(Event event) {
		if (!this.isEnabled()) {
			return;
		}
		switch (event.getTopic()) {
		case TOPIC_CYCLE_AFTER_PROCESS_IMAGE -> {
			this.calculateEnergy();
			this.updateSimulatedChannels();
		}
		}
	}

	@Override
	public String debugLog() {
		return "SoC:" + this.getSoc().asString() //
				+ "|L:" + this.getActivePower().asString() //
				+ "|Allowed:" + this.getAllowedChargePower().asStringWithoutUnit() + ";"
				+ this.getAllowedDischargePower().asString();
	}

	@Override
	public Power getPower() {
		return this.power;
	}

	private Instant lastTimestamp = null;

	@Override
	public void applyPower(int activePower, int reactivePower) throws OpenemsException {
		/*
		 * calculate State of charge
		 */
		var now = Instant.now(this.componentManager.getClock());
		final int soc;
		if (this.lastTimestamp == null) {
			// initial run
			soc = this.config.initialSoc();

		} else {
			// calculate duration since last value
			var duration /* [msec] */ = Duration.between(this.lastTimestamp, now).toMillis();

			// calculate energy since last run in [Wh]
			var energy /* [Wmsec] */ = this.getActivePower().orElse(0) /* [W] */ * duration /* [msec] */;

			// Adding the energy to the initial energy.
			this.energy -= energy;

			var calculatedSoc = this.energy //
					/ (this.config.capacity() * 3600. /* [Wsec] */ * 1000 /* [Wmsec] */) //
					* 100 /* [SoC] */;

			if (calculatedSoc > 100) {
				soc = 100;
			} else if (calculatedSoc < 0) {
				soc = 0;
			} else {
				soc = (int) Math.round(calculatedSoc);
			}

			this._setSoc(soc);
		}
		this.lastTimestamp = now;

		/*
		 * Apply Active/Reactive power to simulated channels
		 */
		if (soc == 0 && activePower > 0) {
			activePower = 0;
		}
		if (soc == 100 && activePower < 0) {
			activePower = 0;
		}
		this._setActivePower(activePower);
		if (soc == 0 && reactivePower > 0) {
			reactivePower = 0;
		}
		if (soc == 100 && reactivePower < 0) {
			reactivePower = 0;
		}
		this._setReactivePower(reactivePower);

		this.updateSimulatedChannels();
		/*
		 * Set AllowedCharge / Discharge based on SoC with derating zone: - Charge: full
		 * below 95%, linear derating 95–100%, hard 0 at 100% - Discharge: full above
		 * 5%, linear derating 0–5%, hard 0 at 0%
		 */
		setValue(this, ManagedSymmetricEss.ChannelId.ALLOWED_CHARGE_POWER,
				calculateAllowedChargePower(soc, this.config.maxChargePower()) * -1);
		setValue(this, ManagedSymmetricEss.ChannelId.ALLOWED_DISCHARGE_POWER,
				calculateAllowedDischargePower(soc, this.config.maxDischargePower()));
	}

	private void updateSimulatedChannels() {
		var activePower = this.getActivePower().orElse(0);
		var soc = this.getSoc().orElse(this.config != null ? this.config.initialSoc() : 50);

		int minCellV = (int) Math.round(3150 + soc * 2.6);
		int maxCellV = minCellV + 20;
		this._setMinCellVoltage(minCellV);
		this._setMaxCellVoltage(maxCellV);

		// Populate 3-phase AC Voltage (230,000 mV), Currents (mA), and ActivePower per phase
		int pPhase = activePower / 3;
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.ACTIVE_POWER_L1, pPhase);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.ACTIVE_POWER_L2, pPhase);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.ACTIVE_POWER_L3, activePower - pPhase * 2);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.VOLTAGE, 230000);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.VOLTAGE_L1, 230000);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.VOLTAGE_L2, 230000);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.VOLTAGE_L3, 230000);

		int iPhase = (int) Math.round((Math.abs((double) pPhase) / 230.0) * 1000.0);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.CURRENT_L1, iPhase);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.CURRENT_L2, iPhase);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.CURRENT_L3, iPhase);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.CURRENT, iPhase * 3);

		// DC Battery side voltage (e.g. 740V = 740,000 mV) and DC current
		int dcV = (int) Math.round(740000 + (soc - 50.0) * 1200);
		int dcI = dcV > 0 ? (int) Math.round((-activePower / (dcV / 1000.0)) * 1000.0) : 0;
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.DC_VOLTAGE, dcV);
		setValue(this, SimulatorEssSymmetricReacting.ChannelId.DC_CURRENT, dcI);
	}

	@Override
	public int getPowerPrecision() {
		return 1;
	}

	@Override
	public ModbusSlaveTable getModbusSlaveTable(AccessMode accessMode) {
		return new ModbusSlaveTable(//
				OpenemsComponent.getModbusSlaveNatureTable(accessMode), //
				SymmetricEss.getModbusSlaveNatureTable(accessMode), //
				ManagedSymmetricEss.getModbusSlaveNatureTable(accessMode), //
				StartStoppable.getModbusSlaveNatureTable(accessMode), //
				ModbusSlaveNatureTable.of(SimulatorEssSymmetricReactingImpl.class, accessMode, 100) //
						.build());
	}

	/**
	 * Calculate the Energy values from ActivePower.
	 */
	private void calculateEnergy() {
		// Calculate Energy
		var activePower = this.getActivePower().get();
		if (activePower == null) {
			// Not available
			this.calculateChargeEnergy.update(null);
			this.calculateDischargeEnergy.update(null);
		} else if (activePower > 0) {
			// Buy-From-Grid
			this.calculateChargeEnergy.update(0);
			this.calculateDischargeEnergy.update(activePower);
		} else {
			// Sell-To-Grid
			this.calculateChargeEnergy.update(activePower * -1);
			this.calculateDischargeEnergy.update(0);
		}
	}

	@Override
	public Timedata getTimedata() {
		return this.timedata;
	}

	@Override
	public void setStartStop(StartStop value) {
		this._setStartStop(value);
	}

	/**
	 * Calculates allowed charge power with a linear derating from 95% to 100% SoC.
	 *
	 * @param soc            the current SoC [%]
	 * @param maxChargePower the maximum charge power [W], positive value
	 * @return allowed charge power as a positive value [W]
	 */
	private static int calculateAllowedChargePower(float soc, int maxChargePower) {
		if (soc >= 100) {
			return 0;
		}
		if (soc > 95) {
			return Math.round(maxChargePower * (100 - soc) / 5f);
		}
		return maxChargePower;
	}

	/**
	 * Calculates allowed discharge power with a linear derating from 5% to 0% SoC.
	 *
	 * @param soc               the current SoC [%]
	 * @param maxDischargePower the maximum discharge power [W], positive value
	 * @return allowed discharge power as a positive value [W]
	 */
	private static int calculateAllowedDischargePower(float soc, int maxDischargePower) {
		if (soc <= 0) {
			return 0;
		}
		if (soc < 5) {
			return Math.round(maxDischargePower * soc / 5f);
		}
		return maxDischargePower;
	}
}
