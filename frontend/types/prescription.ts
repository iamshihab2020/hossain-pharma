export type PrescriptionStatus =
  | 'pending'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'expired';

export interface PrescriptionFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: Date;
  url: string;
}

export interface PrescriptionMedication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  quantity: number;
  refillsRemaining: number;
}

export interface Prescription {
  id: string;
  userId: string;
  patientName: string;
  doctorName: string;
  doctorLicense: string;
  issueDate: Date;
  expiryDate: Date;
  status: PrescriptionStatus;
  medications: PrescriptionMedication[];
  files: PrescriptionFile[];
  pharmacistNotes?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrescriptionUploadData {
  patientName: string;
  doctorName: string;
  issueDate: Date;
  files: File[];
}
