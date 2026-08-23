export type InteractionSeverity = 'contraindicated' | 'serious' | 'moderate' | 'minor';

export interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  severity: InteractionSeverity;
  description: string;
  recommendation: string;
  clinicalEffects: string[];
  mechanism?: string;
  management?: string;
  references?: string[];
}

export interface Medication {
  id: string;
  name: string;
  genericName?: string;
  dosage?: string;
  activeIngredients: string[];
}

export interface InteractionCheckResult {
  hasInteractions: boolean;
  interactions: DrugInteraction[];
  checkedMedications: Medication[];
  checkedAt: Date;
}

export interface SavedMedication extends Medication {
  userId: string;
  addedAt: Date;
  isCurrentlyTaking: boolean;
}
