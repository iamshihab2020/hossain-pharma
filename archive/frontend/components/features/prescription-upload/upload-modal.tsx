'use client';

import { useState } from 'react';
import { Upload, Camera, FileText, X, Check, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { motion } from 'framer-motion';

interface PrescriptionUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrescriptionUploadModal({
  open,
  onOpenChange,
}: PrescriptionUploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [patientName, setPatientName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);

    // Simulate upload
    await new Promise((resolve) => setTimeout(resolve, 2000));

    setUploading(false);
    setUploaded(true);

    // Reset after 2 seconds
    setTimeout(() => {
      setFiles([]);
      setPatientName('');
      setDoctorName('');
      setUploaded(false);
      onOpenChange(false);
    }, 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" aria-describedby="prescription-upload-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" aria-hidden="true" />
            Upload Prescription
          </DialogTitle>
          <DialogDescription id="prescription-upload-description">
            Upload your prescription to order medicines. Our licensed pharmacists will
            verify it within 2 hours.
          </DialogDescription>
        </DialogHeader>

        {!uploaded ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <Tabs defaultValue="upload" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="upload">
                  <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
                  Upload File
                </TabsTrigger>
                <TabsTrigger value="camera" disabled>
                  <Camera className="w-4 h-4 mr-2" aria-hidden="true" />
                  Take Photo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="patient-name">Patient Name</Label>
                  <Input
                    id="patient-name"
                    placeholder="Enter patient name"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="doctor-name">Doctor Name</Label>
                  <Input
                    id="doctor-name"
                    placeholder="Enter doctor name"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="prescription-file">Prescription File</Label>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary transition-colors">
                    <input
                      id="prescription-file"
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <label
                      htmlFor="prescription-file"
                      className="cursor-pointer flex flex-col items-center"
                    >
                      <Upload className="w-10 h-10 text-muted-foreground mb-2" aria-hidden="true" />
                      <span className="text-sm font-medium">
                        Click to upload or drag and drop
                      </span>
                      <span className="text-xs text-muted-foreground mt-1">
                        JPG, PNG or PDF (Max 5MB each)
                      </span>
                    </label>
                  </div>

                  {files.length > 0 && (
                    <div className="space-y-2 mt-4">
                      {files.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 bg-muted rounded"
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4" aria-hidden="true" />
                            <span className="text-sm">{file.name}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(index)}
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-2 p-3 bg-success-light/50 rounded-lg">
                  <Lock className="w-4 h-4 text-success mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <p className="text-xs text-success-foreground">
                    Your prescription is encrypted and HIPAA compliant. Only licensed
                    pharmacists can access it for verification.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="camera">
                <div className="text-center py-8 text-muted-foreground">
                  Camera feature coming soon
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!patientName || !doctorName || files.length === 0 || uploading}
                className="flex-1"
              >
                {uploading ? 'Uploading...' : 'Upload Prescription'}
              </Button>
            </div>
          </form>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-8"
          >
            <div className="w-16 h-16 bg-success text-success-foreground rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Prescription Uploaded!</h3>
            <p className="text-muted-foreground">
              Our pharmacist will verify your prescription within 2 hours.
              You'll receive a notification once it's approved.
            </p>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
}
