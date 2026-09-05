export type VehicleType = 'Crane' | 'JCB' | 'Truck';
export type VehicleStatus = 'Available' | 'Working' | 'Maintenance' | 'Inactive';
export type EmiStatus = 'No EMI' | 'EMI Applicable';
export type EmployeeRole = 'Driver' | 'Operator' | 'Helper' | 'Other';
export type RateType = 'Hourly' | 'Daily' | 'Weekly' | 'Monthly' | 'Couple of Dates';
export type RateMasterRateType = 'Hourly' | 'Daily' | 'Both' | 'Weekly' | 'Monthly';
export type RateMasterStatus = 'Active' | 'Inactive' | 'Closed';
export type BillStatus = 'Paid' | 'Pending' | 'Partially Paid';
export type InvoiceStatus = 'Draft' | 'Generated' | 'Paid' | 'Partially Paid' | 'Pending' | 'Cancelled';
export type PaymentMode = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Other';
export type AttendanceStatus = 'Present' | 'Absent' | 'Holiday';
export type MaintenanceType = string;

export interface MaintenanceTypeConfig {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type EmiStatus2 = 'Upcoming' | 'Due' | 'Paid' | 'Overdue';
export type ContractStatus = 'Active' | 'Completed' | 'Expired' | 'Cancelled';
export type InvoiceType = 'Cash' | 'GST' | 'MONTHLY_CONTRACT';

export interface Vehicle {
  id: string;
  serial_number: string;
  registration_number: string;
  model: string | null;
  type: VehicleType;
  capacity: string | null;
  tons: number | null;
  emi_status: EmiStatus;
  emi_amount: number | null;
  emi_due_date: string | null;
  emi_end_date: string | null;
  hourly_rate: number | null;
  daily_rate: number | null;
  fitness_expiry_date: string | null;
  status: VehicleStatus;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: string;
  name: string;
  role: EmployeeRole;
  phone: string | null;
  salary: number | null;
  license_number: string | null;
  license_expiry: string | null;
  advance_salary: number | null;
  eye_test_amount: number | null;
  eye_test_date: string | null;
  eye_test_expiry_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Rate {
  id: string;
  vehicle_type: 'Crane' | 'JCB' | 'Both';
  rate_type: RateType;
  hour_1_rate: number;
  hour_2_rate: number;
  hour_3_rate: number;
  hour_4_rate: number;
  hour_5_rate: number;
  daily_rate: number;
  weekly_rate: number;
  monthly_rate: number;
  effective_from: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RateMaster {
  id: string;
  vehicle_category: string;
  vehicle_type: VehicleType;
  capacity_tons: string | null;
  rate_type: RateMasterRateType;
  first_hour_rate: number | null;
  second_hour_rate: number | null;
  third_hour_rate: number | null;
  fourth_hour_rate: number | null;
  fifth_hour_rate: number | null;
  weekly_rate: number | null;
  daily_rate: number;
  monthly_rate: number | null;
  batha: number;
  minimum_hours: number | null;
  minimum_charge: number | null;
  effective_from: string;
  effective_to: string | null;
  status: RateMasterStatus;
  version_number: number;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  billing_details: string | null;
  state: string | null;
  state_code: string | null;
  payment_terms: string | null;
  shipping_address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MonthlyContract {
  id: string;
  company_name: string;
  address: string | null;
  billing_details: string | null;
  vehicle_id: string | null;
  start_date: string;
  end_date: string | null;
  budget: number;
  total_monthly_amount: number;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
  discount_enabled: boolean;
  discount_percent: number;
  discount_amount: number;
  final_payable_amount: number;
}

export interface Trip {
  id: string;
  trip_number: string;
  trip_date: string;
  vehicle_id: string | null;
  driver_id: string | null;
  customer_id: string | null;
  place_of_work: string;
  rate_type: RateType;
  in_time: string | null;
  out_time: string | null;
  opening_hour_meter: number | null;
  closing_hour_meter: number | null;
  total_hours: number;
  rental_amount: number;
  batha: number;
  total_amount: number;
  bill_status: BillStatus;
  payment_mode: PaymentMode | null;
  payment_date: string | null;
  remarks: string | null;
  is_cancelled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  rate_master_id: string | null;
  rate_version: number | null;
  capacity_tons: string | null;
  first_hour_rate: number | null;
  second_hour_rate: number | null;
  third_hour_rate_snapshot: number | null;
  fourth_hour_rate_snapshot: number | null;
  fifth_hour_rate_snapshot: number | null;
  weekly_rate_snapshot: number | null;
  daily_rate_snapshot: number | null;
  monthly_rate_snapshot: number | null;
  batha_snapshot: number | null;
  up_transportation_enabled: boolean;
  up_transportation_amount: number;
  down_transportation_enabled: boolean;
  down_transportation_amount: number;
  invoice_id: string | null;
  invoice_status: 'Pending' | 'Invoiced' | null;
  invoice_number: string | null;
  invoiced_at: string | null;
}

export interface DieselEntry {
  id: string;
  diesel_date: string;
  pump_name: string | null;
  vehicle_id: string | null;
  quantity_liters: number;
  rate_per_liter: number;
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  payment_status: BillStatus;
  remarks: string | null;
  is_cancelled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  attendance_date: string;
  employee_id: string;
  status: AttendanceStatus;
  created_at: string;
  updated_at: string;
  is_cancelled: boolean;
}

export interface MaintenanceRecord {
  id: string;
  maintenance_date: string;
  vehicle_id: string | null;
  maintenance_type: MaintenanceType;
  amount: number;
  paid_amount: number;
  balance: number;
  remark: string | null;
  description: string | null;
  is_cancelled: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmiRecord {
  id: string;
  vehicle_id: string | null;
  emi_amount: number;
  due_date: string;
  end_date: string | null;
  status: EmiStatus2;
  paid_date: string | null;
  payment_mode: PaymentMode | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: InvoiceType;
  customer_id: string | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_gstin: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  trip_id: string | null;
  trip_date: string | null;
  vehicle_id: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  place_of_work: string | null;
  opening_hour_meter: number | null;
  closing_hour_meter: number | null;
  total_hours: number | null;
  rate_type: string | null;
  description: string | null;
  hours: number | null;
  rate: number | null;
  taxable_amount: number;
  cgst_percent: number;
  sgst_percent: number;
  igst_percent: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_gst: number;
  grand_total: number;
  batha: number;
  payment_status: BillStatus;
  payment_mode: PaymentMode | null;
  payment_reference: string | null;
  is_cancelled: boolean;
  created_at: string;
  updated_at: string;
  financial_year: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  consignee_gstin: string | null;
  consignee_state: string | null;
  consignee_state_code: string | null;
  destination: string | null;
  motor_vehicle_numbers: string | null;
  terms_of_payment: string | null;
  delivery_note: string | null;
  reference_no: string | null;
  buyer_order_no: string | null;
  dispatch_doc_no: string | null;
  delivery_note_date: string | null;
  amount_received: number;
  balance_amount: number;
  invoice_status: InvoiceStatus;
  amount_in_words: string | null;
  declaration: string | null;
  remarks: string | null;
  up_transportation_enabled: boolean;
  up_transportation_amount: number;
  down_transportation_enabled: boolean;
  down_transportation_amount: number;
  created_by_name: string | null;
  email_status: string | null;
  email_sent_at: string | null;
  email_sent_to: string | null;
  email_error: string | null;
  discount_enabled: boolean;
  discount_percent: number;
  discount_amount: number;
  final_payable_amount: number;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  trip_entry_id: string | null;
  sl_no: number;
  description: string;
  hsn_sac: string;
  quantity: number;
  rate: number;
  unit: string;
  amount: number;
  batha: number;
  calculation_details: string | null;
  created_at: string;
  updated_at: string;
  trip?: Pick<Trip,
    'id' | 'rate_type' | 'total_hours' | 'rental_amount' | 'trip_date' | 'place_of_work' |
    'capacity_tons' | 'first_hour_rate' | 'second_hour_rate' |
    'weekly_rate_snapshot' | 'daily_rate_snapshot' | 'monthly_rate_snapshot'
  > & {
    vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'type' | 'capacity'> | null;
  } | null;
}

export interface InvoicePayment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_mode: PaymentMode | null;
  reference: string | null;
  remarks: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceSettings {
  id: string;
  hsn_sac: string;
  default_payment_terms: string;
  declaration: string;
  authorized_signatory: string | null;
  terms_of_delivery: string | null;
  cgst_percent: number;
  sgst_percent: number;
  igst_percent: number;
  add_gst_by_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompanySettings {
  id: string;
  company_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  logo_url: string | null;
  bank_details: string | null;
  diesel_rate: number;
  invoice_prefix: string;
  invoice_start_number: number;
  cgst_percent: number;
  sgst_percent: number;
  igst_percent: number;
  gst_enabled: boolean;
  language: 'en' | 'te';
  state: string | null;
  state_code: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_branch: string | null;
  bank_ifsc: string | null;
  authorized_signatory: string | null;
  signature_path: string | null;
  stamp_path: string | null;
  pan: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripSession {
  id: string;
  trip_id: string;
  session_number: number;
  in_time: string | null;
  out_time: string | null;
  opening_hour_meter: number | null;
  closing_hour_meter: number | null;
  remarks: string | null;
  duration_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceVehicle {
  id: string;
  invoice_id: string;
  vehicle_id: string | null;
  vehicle_number: string | null;
  vehicle_type: string | null;
  capacity: string | null;
  driver_id: string | null;
  driver_name: string | null;
  place_of_work: string | null;
  rate_type: string | null;
  total_hours: number;
  rental_amount: number;
  batha: number;
  vehicle_total: number;
  rate_master_id: string | null;
  rate_version: number | null;
  capacity_tons: string | null;
  first_hour_rate: number | null;
  second_hour_rate: number | null;
  third_hour_rate_snapshot: number | null;
  fourth_hour_rate_snapshot: number | null;
  fifth_hour_rate_snapshot: number | null;
  weekly_rate_snapshot: number | null;
  daily_rate_snapshot: number | null;
  monthly_rate_snapshot: number | null;
  batha_snapshot: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceVehicleSession {
  id: string;
  invoice_vehicle_id: string;
  session_number: number;
  in_time: string | null;
  out_time: string | null;
  opening_hour_meter: number | null;
  closing_hour_meter: number | null;
  duration_minutes: number;
  remarks: string | null;
  rate_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface TripWithRelations extends Trip {
  vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'model' | 'type' | 'capacity' | 'hourly_rate' | 'daily_rate'> | null;
  driver?: Pick<Employee, 'id' | 'name' | 'role' | 'phone' | 'license_number' | 'license_expiry' | 'salary'> | null;
  customer?: Pick<Customer, 'id' | 'name' | 'address' | 'gstin'> | null;
  sessions?: TripSession[] | null;
}

export interface DieselWithRelations extends DieselEntry {
  vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'type'> | null;
}

export interface DieselDistribution {
  id: string;
  distribution_date: string;
  vehicle_id: string | null;
  purchase_id: string | null;
  quantity_liters: number;
  rate_per_liter: number;
  amount: number;
  remarks: string | null;
  is_cancelled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DieselDistributionWithRelations extends DieselDistribution {
  vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'type'> | null;
}

export interface MaintenanceWithRelations extends MaintenanceRecord {
  vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'type'> | null;
}

export interface EmiWithRelations extends EmiRecord {
  vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'model'> | null;
}

export interface InvoiceWithRelations extends Invoice {
  customer?: Pick<Customer, 'id' | 'name' | 'address' | 'gstin' | 'state' | 'state_code' | 'phone' | 'email' | 'shipping_address'> | null;
  trip?: Pick<Trip, 'id' | 'trip_number' | 'place_of_work'> | null;
  vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'type'> | null;
  items?: InvoiceItem[] | null;
  payments?: InvoicePayment[] | null;
  invoiceVehicles?: (InvoiceVehicle & {
    vehicle?: Pick<Vehicle, 'id' | 'registration_number' | 'type' | 'capacity'> | null;
    driver?: Pick<Employee, 'id' | 'name' | 'role'> | null;
    sessions?: InvoiceVehicleSession[] | null;
  })[] | null;
}

export interface AttendanceWithEmployee extends AttendanceRecord {
  employee: Pick<Employee, 'id' | 'name' | 'role' | 'salary' | 'advance_salary'>;
}

export type AdvanceStatus = 'Outstanding' | 'Partially Recovered' | 'Fully Recovered';
export type AdvancePaymentMode = 'Cash' | 'Bank Transfer' | 'UPI' | 'Other';

export interface SalaryAdvance {
  id: string;
  employee_id: string | null;
  advance_date: string;
  advance_reference: string;
  advance_amount: number;
  reason: string | null;
  payment_mode: AdvancePaymentMode | null;
  reference_number: string | null;
  remarks: string | null;
  status: AdvanceStatus;
  created_at: string;
  updated_at: string;
}

export interface SalaryAdvanceRecovery {
  id: string;
  salary_advance_id: string;
  employee_id: string | null;
  recovery_date: string;
  salary_month: string | null;
  recovery_amount: number;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalaryAdvanceWithRelations extends SalaryAdvance {
  employee?: Pick<Employee, 'id' | 'name' | 'role' | 'salary'> | null;
  recoveries?: SalaryAdvanceRecovery[] | null;
}

export type UserRole = 'admin' | 'manager' | 'operator';

export interface Profile {
  id: string;
  auth_user_id: string;
  username: string;
  display_name: string | null;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InvoiceReminder {
  id: string;
  invoice_id: string;
  customer_id: string | null;
  reminder_stage: number;
  scheduled_at: string;
  sent_at: string | null;
  status: 'pending' | 'sent' | 'failed' | 'cancelled' | 'missing_email';
  recipient_email: string | null;
  subject: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderSettings {
  id: string;
  enabled: boolean;
  day1_enabled: boolean;
  day10_enabled: boolean;
  day20_enabled: boolean;
  day1_subject: string;
  day1_body: string;
  day10_subject: string;
  day10_body: string;
  day20_subject: string;
  day20_body: string;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PageEntry {
  id: string;
  path: string;
  label_key: string;
  label: string;
  section: string;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RolePage {
  id: string;
  role_id: string;
  page_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  created_at: string;
  updated_at: string;
}

export type QuotationStatus = 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired' | 'Converted';

export interface Quotation {
  id: string;
  quotation_number: string;
  quotation_date: string;
  valid_until: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_gstin: string | null;
  reference_no: string | null;
  subject: string | null;
  reference_subject: string | null;
  site_location: string | null;
  other_charges_json: { description: string; amount: number }[] | null;
  subtotal: number;
  up_transportation_enabled: boolean;
  up_transportation_description: string | null;
  up_transportation_amount: number;
  down_transportation_enabled: boolean;
  down_transportation_description: string | null;
  down_transportation_amount: number;
  other_charges_description: string | null;
  other_charges_amount: number;
  gst_enabled: boolean;
  gst_percent: number;
  gst_amount: number;
  grand_total: number;
  terms_and_conditions: string;
  payment_terms: string;
  status: QuotationStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  quotation_amount: number;
  service_amount_enabled: boolean;
  customer?: Pick<Customer, 'id' | 'name' | 'email' | 'phone'> | null;
}

export interface QuotationEquipment {
  id: string;
  quotation_id: string;
  vehicle_type: string;
  capacity_tons: string | null;
  vehicle_number: string | null;
  rate_type: RateType;
  quantity: number;
  rate: number;
  first_hour_rate: number | null;
  second_hour_rate: number | null;
  daily_rate: number | null;
  minimum_hours: number | null;
  minimum_charge: number | null;
  batha: number;
  amount: number;
  rate_master_id: string | null;
  rate_master_rate: number | null;
  is_custom_rate: boolean;
  is_manual_rate: boolean;
  sort_order: number;
  from_date: string | null;
  to_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationEmailSettings {
  id: string;
  email_subject: string;
  email_body: string;
  cc_email: string | null;
  bcc_email: string | null;
  attach_pdf: boolean;
  email_signature: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationFormatSettings {
  id: string;
  quotation_title: string;
  terms_and_conditions: string;
  signature_text: string;
  show_gst: boolean;
  default_payment_terms: string | null;
  default_validity_days: number;
  show_1hr_rate: boolean;
  show_2hr_rate: boolean;
  show_batha: boolean;
  show_transport: boolean;
  date_format: string;
  created_at: string;
  updated_at: string;
}

export interface QuotationEmailHistory {
  id: string;
  quotation_id: string;
  quotation_number: string | null;
  customer_name: string | null;
  recipient_email: string;
  subject: string;
  status: string;
  attachment_name: string | null;
  error_message: string | null;
  sent_by: string | null;
  sent_at: string;
}
