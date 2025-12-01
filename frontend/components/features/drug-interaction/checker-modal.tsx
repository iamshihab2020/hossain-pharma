'use client';

import { useState } from 'react';
import { AlertTriangle, Plus, X, Search, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Medication } from '@/types/drug-interaction';
import { checkDrugInteractions, searchMedications } from '@/lib/mock-data/drug-interactions';
import { motion, AnimatePresence } from 'framer-motion';

interface DrugInteractionCheckerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const severityColors = {
  contraindicated: 'bg-danger text-danger-foreground',
  serious: 'bg-warning text-warning-foreground',
  moderate: 'bg-yellow-500 text-white',
  minor: 'bg-success text-success-foreground',
};

const severityIcons = {
  contraindicated: '🔴',
  serious: '🟠',
  moderate: '🟡',
  minor: '🟢',
};

export function DrugInteractionChecker({
  open,
  onOpenChange,
}: DrugInteractionCheckerProps) {
  const [selectedMeds, setSelectedMeds] = useState<Medication[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Medication[]>([]);
  const [showResults, setShowResults] = useState(false);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.length > 1) {
      const results = searchMedications(query);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const addMedication = (med: Medication) => {
    if (!selectedMeds.find((m) => m.id === med.id)) {
      setSelectedMeds([...selectedMeds, med]);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeMedication = (medId: string) => {
    setSelectedMeds(selectedMeds.filter((m) => m.id !== medId));
    setShowResults(false);
  };

  const checkInteractions = () => {
    setShowResults(true);
  };

  const interactions = showResults ? checkDrugInteractions(selectedMeds) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto" aria-describedby="drug-checker-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" aria-hidden="true" />
            Drug Interaction Checker
          </DialogTitle>
          <DialogDescription id="drug-checker-description">
            Check if your medications have any dangerous interactions. This tool is
            for informational purposes only and not a substitute for professional
            medical advice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Search and Add Medications */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search for a medication..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10"
                aria-label="Search medications"
              />
            </div>

            {searchResults.length > 0 && (
              <Card className="p-2">
                <div className="space-y-1">
                  {searchResults.slice(0, 5).map((med) => (
                    <button
                      key={med.id}
                      onClick={() => addMedication(med)}
                      className="w-full text-left px-3 py-2 hover:bg-muted rounded text-sm"
                    >
                      <div className="font-medium">{med.name}</div>
                      {med.genericName && (
                        <div className="text-xs text-muted-foreground">
                          {med.genericName}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </div>

          {/* Selected Medications */}
          {selectedMeds.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                Selected Medications ({selectedMeds.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {selectedMeds.map((med) => (
                  <Badge
                    key={med.id}
                    variant="secondary"
                    className="px-3 py-1.5 gap-2"
                  >
                    <span>{med.name}</span>
                    <button
                      onClick={() => removeMedication(med.id)}
                      className="hover:text-destructive"
                      aria-label={`Remove ${med.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Check Button */}
          {selectedMeds.length >= 2 && !showResults && (
            <Button onClick={checkInteractions} className="w-full">
              Check for Interactions
            </Button>
          )}

          {/* Results */}
          <AnimatePresence>
            {showResults && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Interaction Results</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowResults(false)}
                  >
                    Check Again
                  </Button>
                </div>

                {interactions.length === 0 ? (
                  <Card className="p-6 text-center">
                    <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" aria-hidden="true" />
                    <h4 className="font-semibold mb-2">No Interactions Found</h4>
                    <p className="text-sm text-muted-foreground">
                      Based on our database, these medications do not have known
                      interactions. Always consult your doctor or pharmacist.
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {interactions.map((interaction) => (
                      <Card
                        key={interaction.id}
                        className="p-4 border-l-4"
                        style={{
                          borderLeftColor:
                            interaction.severity === 'serious'
                              ? 'hsl(38 92% 50%)'
                              : interaction.severity === 'moderate'
                              ? 'hsl(48 96% 53%)'
                              : 'hsl(158 64% 52%)',
                        }}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg" aria-hidden="true">
                                {severityIcons[interaction.severity]}
                              </span>
                              <h4 className="font-semibold">
                                {interaction.drug1} + {interaction.drug2}
                              </h4>
                            </div>
                            <Badge
                              className={severityColors[interaction.severity]}
                            >
                              {interaction.severity.toUpperCase()}
                            </Badge>
                          </div>
                        </div>

                        <p className="text-sm mb-3">{interaction.description}</p>

                        <div className="bg-muted p-3 rounded-md">
                          <p className="text-sm font-medium mb-1">
                            Recommendation:
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {interaction.recommendation}
                          </p>
                        </div>

                        {interaction.clinicalEffects &&
                          interaction.clinicalEffects.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium mb-1">
                                Clinical Effects:
                              </p>
                              <ul className="text-xs text-muted-foreground space-y-0.5">
                                {interaction.clinicalEffects.map((effect, i) => (
                                  <li key={i}>• {effect}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                      </Card>
                    ))}
                  </div>
                )}

                <div className="bg-warning-light p-4 rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    <strong>Disclaimer:</strong> This interaction checker is for
                    informational purposes only. Always consult your healthcare
                    provider or pharmacist before starting, stopping, or changing any
                    medications.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
