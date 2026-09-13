'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import type { CatalogFeature, CatalogModule, CatalogProduct } from '@/lib/domain/catalogue/catalogue';
import {
  updateCatalogFeatureAction,
  updateCatalogModuleAction,
  updateCatalogProductAction,
  type FormState,
} from '@/app/(platform)/platform/catalog/families/[familyKey]/actions';

const INITIAL: FormState = { error: null, updated: false };

/** Browse -> inspect -> edit-in-sheet, rather than a permanent form beside the page (section 22). */

export function EditProductSheet({ product }: { product: CatalogProduct }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateCatalogProductAction, INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          Edit Product
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {product.label}</SheetTitle>
          <SheetDescription>
            Presentation only. The key ({product.key}) is locked — the seven Products are fixed.
          </SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="familyKey" value={product.key} />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="label">Label</FieldLabel>
            <TextInput id="label" name="label" required maxLength={120} defaultValue={product.label} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <TextArea id="description" name="description" rows={3} defaultValue={product.description} />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="lifecycle">Lifecycle</FieldLabel>
              <SelectInput id="lifecycle" name="lifecycle" defaultValue={product.lifecycle}>
                <option value="experimental">Experimental</option>
                <option value="beta">Beta</option>
                <option value="stable">Stable</option>
                <option value="deprecated">Deprecated</option>
              </SelectInput>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel htmlFor="saleStatus">Sale state</FieldLabel>
              <SelectInput id="saleStatus" name="saleStatus" defaultValue={product.saleStatus}>
                <option value="active">Active</option>
                <option value="unlisted">Unlisted</option>
                <option value="archived">Archived</option>
              </SelectInput>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="displayOrder">Display order</FieldLabel>
            <TextInput id="displayOrder" name="displayOrder" type="number" min={0} defaultValue={product.displayOrder} className="w-28" />
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            {state.updated ? <Hint role="status">Saved.</Hint> : null}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function EditModuleSheet({ module, familyKey }: { module: CatalogModule; familyKey: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateCatalogModuleAction, INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          Configure module metadata
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {module.label}</SheetTitle>
          <SheetDescription>Presentation metadata for this Module.</SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="familyKey" value={familyKey} />
          <input type="hidden" name="moduleId" value={module.id} />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`module-label-${module.id}`}>Label</FieldLabel>
            <TextInput id={`module-label-${module.id}`} name="label" required maxLength={120} defaultValue={module.label} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`module-description-${module.id}`}>Description</FieldLabel>
            <TextArea id={`module-description-${module.id}`} name="description" rows={3} defaultValue={module.description} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`module-order-${module.id}`}>Display order</FieldLabel>
            <TextInput id={`module-order-${module.id}`} name="displayOrder" type="number" min={0} defaultValue={module.displayOrder} className="w-28" />
          </div>
          <ErrorText role="alert">{state.error}</ErrorText>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            {state.updated ? <Hint role="status">Saved.</Hint> : null}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const IMPLEMENTATION_OPTIONS: CatalogFeature['implementationState'][] = ['planned', 'partial', 'available'];
const PACKAGING_OPTIONS: CatalogFeature['packagingDefault'][] = ['core', 'included', 'optional', 'add_on'];

export function FeatureSheet({
  feature,
  familyKey,
  dependsOn,
  requiredBy,
  runtimeMappings,
  grantingPlans,
  trigger,
}: {
  feature: CatalogFeature;
  familyKey: string;
  dependsOn: CatalogFeature[];
  requiredBy: CatalogFeature[];
  runtimeMappings: { mappingKind: string; mappingValue: string; note: string }[];
  grantingPlans: { key: string; label: string }[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateCatalogFeatureAction, INITIAL);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{feature.label}</SheetTitle>
          <SheetDescription>{feature.description || 'No description yet.'}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-4">
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="familyKey" value={familyKey} />
            <input type="hidden" name="featureId" value={feature.id} />

            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Identity</p>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`feat-label-${feature.id}`}>Label</FieldLabel>
              <TextInput id={`feat-label-${feature.id}`} name="label" required maxLength={160} defaultValue={feature.label} />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`feat-description-${feature.id}`}>Description</FieldLabel>
              <TextArea id={`feat-description-${feature.id}`} name="description" rows={2} defaultValue={feature.description} />
            </div>

            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <FieldLabel htmlFor={`feat-lifecycle-${feature.id}`}>Lifecycle</FieldLabel>
                <SelectInput id={`feat-lifecycle-${feature.id}`} name="lifecycle" defaultValue={feature.lifecycle}>
                  <option value="experimental">Experimental</option>
                  <option value="beta">Beta</option>
                  <option value="stable">Stable</option>
                  <option value="deprecated">Deprecated</option>
                </SelectInput>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <FieldLabel htmlFor={`feat-implementation-${feature.id}`}>Implementation</FieldLabel>
                <SelectInput id={`feat-implementation-${feature.id}`} name="implementationState" defaultValue={feature.implementationState}>
                  {IMPLEMENTATION_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <FieldLabel htmlFor={`feat-packaging-${feature.id}`}>Packaging default</FieldLabel>
                <SelectInput id={`feat-packaging-${feature.id}`} name="packagingDefault" defaultValue={feature.packagingDefault}>
                  {PACKAGING_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <FieldLabel htmlFor={`feat-sale-${feature.id}`}>Sale state</FieldLabel>
                <SelectInput id={`feat-sale-${feature.id}`} name="saleStatus" defaultValue={feature.saleStatus}>
                  <option value="active">Active</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="archived">Archived</option>
                </SelectInput>
              </div>
            </div>

            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Metering &amp; AI</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="metered" defaultChecked={feature.metered} /> Metered
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="aiPowered" defaultChecked={feature.aiPowered} /> AI-powered
            </label>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`feat-meters-${feature.id}`}>Meter ids (comma-separated)</FieldLabel>
              <TextInput id={`feat-meters-${feature.id}`} name="meterIds" defaultValue={feature.meterIds.join(', ')} />
            </div>

            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider requirements</p>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`feat-caps-${feature.id}`}>Abstract capabilities (comma-separated)</FieldLabel>
              <TextInput
                id={`feat-caps-${feature.id}`}
                name="providerCapabilities"
                placeholder="speech.transcription, ai.inference"
                defaultValue={feature.providerCapabilities.join(', ')}
              />
              <Hint weight="subtle">
                Abstract capabilities only — never a vendor name. Actual provider resolution is a later slice.
              </Hint>
            </div>

            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`feat-order-${feature.id}`}>Display order</FieldLabel>
              <TextInput id={`feat-order-${feature.id}`} name="displayOrder" type="number" min={0} defaultValue={feature.displayOrder} className="w-28" />
            </div>

            <ErrorText role="alert">{state.error}</ErrorText>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              {state.updated ? <Hint role="status">Saved.</Hint> : null}
            </div>
          </form>

          {dependsOn.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requires</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {dependsOn.map((dep) => (
                  <li key={dep.id}>{dep.label}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {requiredBy.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Required by</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {requiredBy.map((dep) => (
                  <li key={dep.id}>{dep.label}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime mappings</p>
            <Hint weight="subtle" className="mt-1">
              Development-owned. Changing what backs a Feature is a code change, not a catalogue edit.
            </Hint>
            {runtimeMappings.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                This Feature is in the catalogue but is not currently backed by a runtime capability.
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {runtimeMappings.map((mapping, index) => (
                  <li key={index} className="font-mono text-xs">
                    {mapping.mappingKind}: {mapping.mappingValue}
                    {mapping.note ? <span className="ml-2 font-sans text-muted-foreground">{mapping.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plans granting this Feature</p>
            {grantingPlans.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">No Plan currently grants this Feature.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {grantingPlans.map((plan) => (
                  <li key={plan.key}>{plan.label}</li>
                ))}
              </ul>
            )}
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Advanced</summary>
            <div className="mt-1 font-mono">
              id: {feature.id}
              <br />
              key: {feature.key}
              <br />
              module_id: {feature.moduleId}
            </div>
          </details>
        </div>
      </SheetContent>
    </Sheet>
  );
}
