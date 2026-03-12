export interface Collection {
  colId: number;
  colName: string;
  description?: string;
  nrOfDocuments: number;
  role: string;
}

export interface Document {
  docId: number;
  title: string;
  nrOfPages: number;
  uploadTimestamp: number;
  collectionList?: { colList: Collection[] };
}

export interface Page {
  pageId: number;
  pageNr: number;
  imgFileName: string;
  url: string;
  tsList?: { transcripts: Transcript[] };
}

export interface Transcript {
  tsId: number;
  pageId: number;
  pageNr: number;
  status: string;
  timestamp: number;
  userName: string;
  nrOfLines: number;
  nrOfWords: number;
}
