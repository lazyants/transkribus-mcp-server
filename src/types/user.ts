export interface User {
  userId: number;
  userName: string;
  email: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  affiliation?: string;
  isActive: boolean;
  created: number;
}

export interface UserStats {
  nrOfCollections: number;
  nrOfDocuments: number;
  nrOfPages: number;
  nrOfTranscripts: number;
  nrOfNewTranscripts: number;
  nrOfReleasedTranscripts: number;
}
