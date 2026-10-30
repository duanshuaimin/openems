// @ts-strict-ignore
import { Component, OnInit, ChangeDetectionStrategy } from "@angular/core";
import { FormGroup } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { FormlyFieldConfig } from "@ngx-formly/core";
import { Edge, EdgeConfig, Service, Utils, Websocket } from "../../../../shared/shared";

@Component({
    selector: ComponentUpdateComponent.SELECTOR,
    templateUrl: "./update.component.html",
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false,
})
export class ComponentUpdateComponent implements OnInit {
    private static readonly SELECTOR = "componentUpdate";

    public edge: Edge | null = null;
    public factory: EdgeConfig.Factory | null = null;
    public form: FormGroup | null = null;
    public model = null;
    public fields: FormlyFieldConfig[] | null = null;
    public componentIcon: string | null = null;
    public isLoading: boolean = true;
    public errorMessage: string | null = null;

    private componentId: string | null = null;

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
            this.edge = await this.service.getCurrentEdge();
            const componentId = this.route.snapshot.params["componentId"];
            const config = await this.service.getConfig();
            this.componentId = componentId;
            const component = config.components[componentId];
            if (!component) {
                throw new Error(`Component with ID ${componentId} not found`);
            }

            const [factory, properties] = await this.edge.getFactoryProperties(this.websocket, component.factoryId);
            this.factory = EdgeConfig.localizeFactory(factory, this.service.translate, component.factoryId);
            this.componentIcon = config.getFactoryIcon(this.factory, this.service.translate);
            const factoryKey = component.factoryId.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
            const fields: FormlyFieldConfig[] = [];
            const model = {};

            for (const property of properties) {
                if (property.id === "id") {
                    continue; // ignore Component-ID
                }
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
                const field: FormlyFieldConfig = {
                    key: property_id,
                    type: "input",
                    templateOptions: {
                        label: property.name,
                        description: property.description,
                        required: property.isRequired,
                    },
                };
                // add Property Schema
                if (property.schema) {
                    Utils.deepCopy(property.schema, field);
                }
                fields.push(field);
                if (component.properties[property.id]) {
                    // filter arrays with nested objects
                    if (
                        Array.isArray(component.properties[property.id]) &&
                        component.properties[property.id]?.length > 0 &&
                        component.properties[property.id]?.every((element) => typeof element === "object")
                    ) {
                        // Stringify json for objects nested inside an array
                        model[property_id] = JSON.stringify(component.properties[property.id]);
                    } else {
                        model[property_id] = component.properties[property.id];
                    }
                }
            }
            this.form = new FormGroup({});
            this.fields = fields;
            this.model = model;
        } catch (error: any) {
            console.error("Failed to load component properties:", error);
            this.errorMessage = error?.message || "Failed to load component properties";
            this.service.toast(this.errorMessage, "danger");
        } finally {
            this.isLoading = false;
        }
    }

    public submit() {
        const properties: { name: string; value: any }[] = [];
        for (const controlKey in this.form.controls) {
            const control = this.form.controls[controlKey];
            if (control.dirty) {
                const property_id = controlKey.replace("_", ".");
                properties.push({ name: property_id, value: control.value });
            }
        }
        this.edge
            .updateComponentConfig(this.websocket, this.componentId, properties)
            .then(() => {
                this.form.markAsPristine();
                this.service.toast("Successfully updated " + this.componentId + ".", "success");
            })
            .catch((reason) => {
                this.service.toast("Error updating " + this.componentId + ":" + reason.error.message, "danger");
            });
    }

    public delete() {
        this.edge
            .deleteComponentConfig(this.websocket, this.componentId)
            .then(() => {
                this.form.markAsPristine();
                this.service.toast("Successfully deleted " + this.componentId + ".", "success");
            })
            .catch((reason) => {
                this.service.toast("Error deleting " + this.componentId + ":" + reason.error.message, "danger");
            });
    }
}
