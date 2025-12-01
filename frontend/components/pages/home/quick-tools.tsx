'use client';

import { useState } from 'react';
import { FileText, AlertTriangle, MapPin, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PrescriptionUploadModal } from '@/components/features/prescription-upload/upload-modal';
import { DrugInteractionChecker } from '@/components/features/drug-interaction/checker-modal';

const tools = [
  {
    icon: <FileText className="w-8 h-8" aria-hidden="true" />,
    title: 'Upload Prescription',
    description: 'Upload your prescription for quick ordering',
    color: 'text-trust',
    modal: 'prescription',
  },
  {
    icon: <AlertTriangle className="w-8 h-8" aria-hidden="true" />,
    title: 'Drug Interaction Checker',
    description: 'Check if your medications interact',
    color: 'text-warning',
    modal: 'drugChecker',
  },
  {
    icon: <MapPin className="w-8 h-8" aria-hidden="true" />,
    title: 'Find Nearby Pharmacy',
    description: 'Locate pharmacies near your location',
    color: 'text-health',
    modal: null,
  },
  {
    icon: <Search className="w-8 h-8" aria-hidden="true" />,
    title: 'Symptom Search',
    description: 'Find medicines based on symptoms',
    color: 'text-purple-500',
    modal: null,
  },
];

export function QuickTools() {
  const [prescriptionOpen, setPrescriptionOpen] = useState(false);
  const [drugCheckerOpen, setDrugCheckerOpen] = useState(false);

  const handleToolClick = (modal: string | null) => {
    if (modal === 'prescription') setPrescriptionOpen(true);
    if (modal === 'drugChecker') setDrugCheckerOpen(true);
  };

  return (
    <>
      <section className="py-12 bg-muted/30" aria-labelledby="quick-tools-heading">
        <div className="container">
          <div className="text-center mb-8">
            <h2 id="quick-tools-heading" className="text-3xl font-bold mb-2">
              Quick Access Tools
            </h2>
            <p className="text-muted-foreground">
              Essential healthcare tools at your fingertips
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {tools.map((tool) => (
              <Card
                key={tool.title}
                className="p-6 hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => handleToolClick(tool.modal)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleToolClick(tool.modal);
                  }
                }}
              >
                <div className={`${tool.color} mb-3 group-hover:scale-110 transition-transform`}>
                  {tool.icon}
                </div>
                <h3 className="font-semibold mb-2">{tool.title}</h3>
                <p className="text-sm text-muted-foreground">{tool.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <PrescriptionUploadModal open={prescriptionOpen} onOpenChange={setPrescriptionOpen} />
      <DrugInteractionChecker open={drugCheckerOpen} onOpenChange={setDrugCheckerOpen} />
    </>
  );
}
