export interface TranskribusSession {
  sessionId: string;
  userId: number;
  userName: string;
  email: string;
}

export interface TranskribusError {
  message: string;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  trpList: T[];
  total: number;
  index: number;
  nValues: number;
}
