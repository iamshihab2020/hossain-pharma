export type AdStatus = 'pending' | 'accepted' | 'rejected';

export interface Advertisement {
  _id: string;
  email: string;
  title: string;
  description: string;
  image: string;
  link?: string;
  adsStatus: AdStatus;
  createdAt: Date;
}

export interface CreateAdPayload {
  email: string;
  title: string;
  description: string;
  image: string;
  link?: string;
  adsStatus?: AdStatus;
}

export interface ApprovedAd extends Advertisement {
  approvedAt?: Date;
}
