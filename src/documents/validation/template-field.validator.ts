import { MappedDocumentData } from '../mappings/document-mapping.types';
import { DocumentTemplateDefinition } from '../templates/document-template.registry';

export interface MissingTemplateField {
  key: string;
  label: string;
  requirement: 'required_before_generation';
}

export function validateTemplateFields(
  definition: DocumentTemplateDefinition,
  mapped: MappedDocumentData,
): { valid: boolean; missingFields: MissingTemplateField[] } {
  for (const policy of definition.fields) {
    if (
      !mapped.fields[policy.key]?.trim() &&
      policy.draftPlaceholder &&
      policy.requirement === 'provided_by_forwarder'
    ) {
      mapped.fields[policy.key] = policy.draftPlaceholder;
    }
  }
  const missingFields = definition.fields
    .filter(
      (policy) =>
        policy.requirement === 'required_before_generation' &&
        !mapped.fields[policy.key]?.trim(),
    )
    .map(({ key, label }) => ({
      key,
      label,
      requirement: 'required_before_generation' as const,
    }));
  if (!mapped.items.length) {
    missingFields.push({
      key: 'items',
      label: 'Goods / shipment items',
      requirement: 'required_before_generation',
    });
  } else {
    definition.requiredItemFields.forEach(({ key, label }) => {
      if (mapped.items.some((item) => !item[key]?.trim()))
        missingFields.push({
          key: `item:${key}`,
          label,
          requirement: 'required_before_generation',
        });
    });
  }
  return { valid: missingFields.length === 0, missingFields };
}
