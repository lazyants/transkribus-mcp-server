export interface Job {
  jobId: number;
  docId: number;
  pageNr: number;
  type: string;
  state: string;
  success: boolean;
  description: string;
  createTime: number;
  startTime?: number;
  endTime?: number;
  userId: number;
  userName: string;
}
