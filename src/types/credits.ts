export interface CreditPackage {
  creditId: number;
  type: string;
  nrOfCredits: number;
  balance: number;
  userId: number;
  expires?: number;
}

export interface CreditTransaction {
  transactionId: number;
  creditId: number;
  nrOfCredits: number;
  type: string;
  timestamp: number;
}

export interface CreditProduct {
  productId: string;
  name: string;
  nrOfCredits: number;
  price: number;
  currency: string;
}
