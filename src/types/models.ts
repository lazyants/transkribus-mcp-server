export interface Model {
  modelId: number;
  name: string;
  type: string;
  description?: string;
  provider: string;
  isPublic: boolean;
}

export interface ModelTrainData {
  docId: number;
  pageId: number;
  pageNr: number;
  nrOfLines: number;
  nrOfWords: number;
}
