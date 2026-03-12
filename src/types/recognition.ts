export interface HtrModel {
  htrId: number;
  name: string;
  description?: string;
  provider: string;
  nrOfTokens: number;
  nrOfLines: number;
  nrOfWords: number;
  cerOnTrainSet?: number;
  cerOnTestSet?: number;
}

export interface RecognitionResult {
  jobId: string;
  status: string;
}
