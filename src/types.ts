export type Customer = {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
  phone: string;
  contact: string;
  contactPhone: string;
  address: string;
  source: string;
  status: string;
  history: string;
  needs: string;
  created_at: string;
  deleted_at?: string;
};
export type Point = {
  frequency: number;
  value: number | null;
  noResponse: boolean;
  masked: boolean;
};
export type Exam = {
  id?: string;
  date: string;
  right: Point[];
  left: Point[];
  boneRight: Point[];
  boneLeft: Point[];
  uclRight?: Point[];
  uclLeft?: Point[];
  speech: string;
  other: string;
  conclusion: string;
};
export type Follow = {
  id: string;
  customer_id: string;
  name: string;
  phone: string;
  due: string;
  type: string;
  note: string;
  completed: number;
  result: string;
};
export type Detail = {
  exams: Exam[];
  fittings: any[];
  repairs: any[];
  followups: Follow[];
  attachments: any[];
  audit: any[];
};
