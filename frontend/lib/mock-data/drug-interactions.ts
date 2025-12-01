import { DrugInteraction, Medication } from '@/types/drug-interaction';

export const mockMedications: Medication[] = [
  {
    id: 'med-1',
    name: 'Aspirin',
    genericName: 'Acetylsalicylic Acid',
    dosage: '325mg',
    activeIngredients: ['Acetylsalicylic Acid'],
  },
  {
    id: 'med-2',
    name: 'Warfarin',
    genericName: 'Warfarin Sodium',
    dosage: '5mg',
    activeIngredients: ['Warfarin Sodium'],
  },
  {
    id: 'med-3',
    name: 'Ibuprofen',
    genericName: 'Ibuprofen',
    dosage: '400mg',
    activeIngredients: ['Ibuprofen'],
  },
  {
    id: 'med-4',
    name: 'Lisinopril',
    genericName: 'Lisinopril',
    dosage: '10mg',
    activeIngredients: ['Lisinopril'],
  },
  {
    id: 'med-5',
    name: 'Metformin',
    genericName: 'Metformin HCl',
    dosage: '500mg',
    activeIngredients: ['Metformin Hydrochloride'],
  },
  {
    id: 'med-6',
    name: 'Amoxicillin',
    genericName: 'Amoxicillin',
    dosage: '500mg',
    activeIngredients: ['Amoxicillin'],
  },
  {
    id: 'med-7',
    name: 'Atorvastatin',
    genericName: 'Atorvastatin Calcium',
    dosage: '20mg',
    activeIngredients: ['Atorvastatin Calcium'],
  },
  {
    id: 'med-8',
    name: 'Omeprazole',
    genericName: 'Omeprazole',
    dosage: '20mg',
    activeIngredients: ['Omeprazole'],
  },
];

export const mockInteractions: DrugInteraction[] = [
  {
    id: 'int-1',
    drug1: 'Aspirin',
    drug2: 'Warfarin',
    severity: 'serious',
    description: 'Both aspirin and warfarin can increase the risk of bleeding. Taking them together may significantly increase this risk.',
    recommendation: 'Consult your doctor before combining these medications. Your doctor may need to adjust dosages or monitor you more closely.',
    clinicalEffects: [
      'Increased risk of bleeding',
      'Prolonged bleeding time',
      'Risk of hemorrhage',
      'Gastrointestinal bleeding',
    ],
    mechanism: 'Both drugs inhibit platelet function and reduce blood clotting through different mechanisms, leading to additive anticoagulant effects.',
    management: 'Use alternative pain relievers such as acetaminophen. If combination is necessary, close monitoring of INR and bleeding signs is required.',
  },
  {
    id: 'int-2',
    drug1: 'Ibuprofen',
    drug2: 'Lisinopril',
    severity: 'moderate',
    description: 'NSAIDs like ibuprofen may reduce the blood pressure-lowering effects of ACE inhibitors like lisinopril.',
    recommendation: 'Monitor your blood pressure regularly. Your doctor may need to adjust your lisinopril dose if you take ibuprofen frequently.',
    clinicalEffects: [
      'Reduced antihypertensive effect',
      'Increased blood pressure',
      'Potential kidney function impairment',
    ],
    mechanism: 'NSAIDs inhibit prostaglandin synthesis, which can counteract the vasodilating effects of ACE inhibitors.',
    management: 'Consider using acetaminophen for pain relief instead. If NSAID is necessary, use the lowest effective dose for the shortest duration.',
  },
  {
    id: 'int-3',
    drug1: 'Metformin',
    drug2: 'Amoxicillin',
    severity: 'minor',
    description: 'Amoxicillin may slightly affect metformin absorption, but this interaction is generally not clinically significant.',
    recommendation: 'No special precautions are usually needed. Take medications as prescribed.',
    clinicalEffects: [
      'Minor changes in blood sugar levels',
      'Slight variation in metformin effectiveness',
    ],
  },
  {
    id: 'int-4',
    drug1: 'Atorvastatin',
    drug2: 'Omeprazole',
    severity: 'minor',
    description: 'Omeprazole may slightly reduce the absorption of atorvastatin, but this is usually not clinically significant.',
    recommendation: 'Continue taking both medications as prescribed. No dose adjustment is typically necessary.',
    clinicalEffects: [
      'Minor reduction in atorvastatin levels',
      'Minimal impact on cholesterol control',
    ],
  },
  {
    id: 'int-5',
    drug1: 'Aspirin',
    drug2: 'Ibuprofen',
    severity: 'moderate',
    description: 'Taking ibuprofen with aspirin may reduce the cardioprotective effects of aspirin and increase gastrointestinal side effects.',
    recommendation: 'If you take aspirin for heart protection, take it at least 2 hours before or 8 hours after ibuprofen. Consult your doctor for alternatives.',
    clinicalEffects: [
      'Reduced cardioprotective effect of aspirin',
      'Increased risk of stomach ulcers',
      'Increased bleeding risk',
    ],
    mechanism: 'Ibuprofen can compete with aspirin for binding to platelet COX-1, potentially blocking aspirin\'s antiplatelet effects.',
    management: 'Use acetaminophen instead of ibuprofen, or time the doses appropriately. Consider alternative NSAIDs if needed.',
  },
];

export const checkDrugInteractions = (medications: Medication[]): DrugInteraction[] => {
  const interactions: DrugInteraction[] = [];

  for (let i = 0; i < medications.length; i++) {
    for (let j = i + 1; j < medications.length; j++) {
      const interaction = mockInteractions.find(
        (int) =>
          (int.drug1 === medications[i].name && int.drug2 === medications[j].name) ||
          (int.drug1 === medications[j].name && int.drug2 === medications[i].name)
      );

      if (interaction) {
        interactions.push(interaction);
      }
    }
  }

  return interactions.sort((a, b) => {
    const severityOrder = { contraindicated: 0, serious: 1, moderate: 2, minor: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
};

export const searchMedications = (query: string): Medication[] => {
  const lowerQuery = query.toLowerCase();
  return mockMedications.filter(
    (med) =>
      med.name.toLowerCase().includes(lowerQuery) ||
      med.genericName?.toLowerCase().includes(lowerQuery)
  );
};
