export type TestStatus = "pass" | "fail" | "skip";

export interface TestResult {
  label: string;
  status: TestStatus;
  detail?: string;
  txHash?: string;
  ms?: number;
}

export interface TestSection {
  name: string;
  results: TestResult[];
  expectedCount: number;
}

export type ReportFn = (sectionIdx: number, result: TestResult) => void;