// @ts-strict-ignore
import { Component, OnInit, ChangeDetectionStrategy } from "@angular/core";
import { FormGroup } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { FormlyFieldConfig } from "@ngx-formly/core";
import { Edge, EdgeConfig, Service, Utils, Websocket } from "../../../../shared/shared";

@Component({
    selector: ComponentInstallComponent.SELECTOR,
    templateUrl: "./install.component.html",
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false,
})
export class ComponentInstallComponent implements OnInit {
    private static readonly SELECTOR = "componentInstall";

    public edge: Edge | null = null;
    public factory: EdgeConfig.Factory | null = null;
    public form = null;
    public model = null;
    public fields: FormlyFieldConfig[] | null = null;
    public componentIcon: string | null = null;
    public isLoading: boolean = true;
    public errorMessage: string | null = null;

    private factoryId: string | null = null;

    constructor(
        private route: ActivatedRoute,
        protected utils: Utils,
        private websocket: Websocket,
        private service: Service,
    ) {}

    async ngOnInit() {
        this.isLoading = true;
        this.errorMessage = null;
        try {
            this.factoryId = this.route.snapshot.params["factoryId"];
            this.edge = await this.service.getCurrentEdge();
            const config = await this.service.getConfig();

            const [factory, properties] = await this.edge.getFactoryProperties(this.websocket, this.factoryId);
            this.factory = EdgeConfig.localizeFactory(factory, this.service.translate, this.factoryId);
            this.componentIcon = config.getFactoryIcon(this.factory, this.service.translate);

            const factoryKey = this.factoryId.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
            const fields: FormlyFieldConfig[] = [];
            const model = {};
            for (const property of properties) {
                const property_id = property.id.replace(".", "_");
                const propKey = property.id.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();

                // Localize property label
                const specificNameKey = `SETTINGS.FACTORIES.${factoryKey}.PROPERTY.${propKey}.NAME`;
                const specificName = this.service.translate.instant(specificNameKey);
                if (specificName && specificName !== specificNameKey) {
                    property.name = specificName;
                } else {
                    const commonNameKey = `SETTINGS.COMMON_PROPERTY.${propKey}.NAME`;
                    const commonName = this.service.translate.instant(commonNameKey);
                    if (commonName && commonName !== commonNameKey) {
                        property.name = commonName;
                    }
                }

                // Localize property description
                const specificDescKey = `SETTINGS.FACTORIES.${factoryKey}.PROPERTY.${propKey}.DESCRIPTION`;
                const specificDesc = this.service.translate.instant(specificDescKey);
                if (specificDesc && specificDesc !== specificDescKey) {
                    property.description = specificDesc;
                } else {
                    const commonDescKey = `SETTINGS.COMMON_PROPERTY.${propKey}.DESCRIPTION`;
                    const commonDesc = this.service.translate.instant(commonDescKey);
                    if (commonDesc && commonDesc !== commonDescKey) {
                        property.description = commonDesc;
                    }
                }

                let defaultValue = property.defaultValue;
                // if the type is an array and there is no defaultValue then set the defaultValue to an empty array
                if (property.schema?.["type"] === "repeat" && defaultValue === null) {
                    defaultValue = [];
                }
                const field: FormlyFieldConfig = {
                    key: property_id,
                    type: "input",
                    templateOptions: {
                        label: property.name,
                        required: defaultValue === null,
                        description: property.description,
                    },
                };
                // add Property Schema
                if (property.schema) {
                    Utils.deepCopy(property.schema, field);
                }
                fields.push(field);
                if (defaultValue != null) {
                    model[property_id] = defaultValue;

                    // Set the next free Component-ID as defaultValue
                    if (property_id == "id" && property.schema?.["type"] !== "repeat") {
                        const thisMatch = defaultValue.match(/^(\D+)(\d+)$/);
                        if (thisMatch) {
                            const thisPrefix = thisMatch[1];
                            let highestSuffix = Number.parseInt(thisMatch[2]);
                            if (config?.components) {
                                for (const componentId of Object.keys(config.components)) {
                                    const componentMatch = componentId.match(/^(\D+)(\d+)$/);
                                    if (componentMatch) {
                                        const componentPrefix = componentMatch[1];
                                        if (componentPrefix === thisPrefix) {
                                            const componentSuffix = Number.parseInt(componentMatch[2]);
                                            highestSuffix = Math.max(highestSuffix, componentSuffix + 1);
                                        }
                                    }
                                }
                            }
                            model[property_id] = thisPrefix + highestSuffix;
                        }
                    }
                }
            }
            this.form = new FormGroup({});
            this.fields = fields;
            this.model = model;
        } catch (error: any) {
            console.error("Failed to load factory properties:", error);
            this.errorMessage = error?.message || "Failed to load component factory properties";
            this.service.toast(this.errorMessage, "danger");
        } finally {
            this.isLoading = false;
        }
    }

    public submit() {
        if (!this.form.valid) {
            this.service.toast("Please fill mandatory fields!", "danger");
            return;
        }
        const properties: { name: string; value: any }[] = [];
        for (const controlKey in this.form.controls) {
            const control = this.form.controls[controlKey];
            if (control.value === null) {
                // ignore 'null' values
                continue;
            }
            const property_id = controlKey.replace("_", ".");
            properties.push({ name: property_id, value: control.value });
        }

        this.edge
            .createComponentConfig(this.websocket, this.factoryId, properties)
            .then((response) => {
                this.form.markAsPristine();
                this.service.toast("Successfully created in instance of " + this.factoryId + ".", "success");
            })
            .catch((reason) => {
                this.service.toast(
                    "Error creating an instance of " + this.factoryId + ":" + reason.error.message,
                    "danger",
                );
            });
    }
}
