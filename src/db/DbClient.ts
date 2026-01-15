export type QueryResult = {
  columns: string[];
  rows: any[];
  rowsAffected?: number[];
};

export interface DbClient {
  query(sql: string): Promise<QueryResult>;
  close(): Promise<void>;
}
