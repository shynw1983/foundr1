create extension if not exists pgcrypto;

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  external_id text,
  company_id uuid,
  address text,
  owner_name text,
  customer_display_names jsonb not null default '{}'::jsonb,
  business_hours jsonb not null default '{}'::jsonb,
  reservation_note text not null default '',
  payroll_cycle_type text not null default 'month_end',
  payroll_closing_day integer not null default 31,
  prescribed_monthly_work_minutes integer,
  social_insurance_prefecture text not null default '福岡県',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table stores add column if not exists external_id text;
alter table stores add column if not exists company_id uuid;
alter table stores add column if not exists customer_display_names jsonb not null default '{}'::jsonb;
alter table stores add column if not exists business_hours jsonb not null default '{}'::jsonb;
alter table stores add column if not exists reservation_note text not null default '';
alter table stores add column if not exists payroll_cycle_type text not null default 'month_end';
alter table stores add column if not exists payroll_closing_day integer not null default 31;
alter table stores add column if not exists prescribed_monthly_work_minutes integer;
alter table stores add column if not exists social_insurance_prefecture text not null default '福岡県';
alter table stores add column if not exists weather_location_name text;
alter table stores add column if not exists weather_latitude numeric(10, 6);
alter table stores add column if not exists weather_longitude numeric(10, 6);
alter table stores add column if not exists attendance_location_enabled boolean not null default false;
alter table stores add column if not exists attendance_latitude numeric(10, 6);
alter table stores add column if not exists attendance_longitude numeric(10, 6);
alter table stores add column if not exists attendance_radius_meters integer not null default 100;
alter table stores add column if not exists attendance_accuracy_threshold_meters integer not null default 100;
alter table stores add column if not exists shift_first_half_submission_deadline_day integer not null default 25;
alter table stores add column if not exists shift_second_half_submission_deadline_day integer not null default 10;
alter table stores add column if not exists shift_submission_deadline_time time not null default '23:59';

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  legal_name text,
  representative_name text,
  invoice_registration_number text,
  receipt_purpose_text text not null default 'テイクアウト飲食代',
  receipt_tax_rate numeric(5, 2) not null default 8,
  address text,
  phone text,
  privacy_contact_name text,
  privacy_contact_email text,
  privacy_contact_phone text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table companies add column if not exists representative_name text;
alter table companies add column if not exists receipt_purpose_text text not null default 'テイクアウト飲食代';
alter table companies add column if not exists receipt_tax_rate numeric(5, 2) not null default 8;
alter table companies add column if not exists privacy_contact_name text;
alter table companies add column if not exists privacy_contact_email text;
alter table companies add column if not exists privacy_contact_phone text;

alter table stores drop constraint if exists stores_company_id_fkey;
alter table stores
  add constraint stores_company_id_fkey
  foreign key (company_id) references companies(id) on delete set null;

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  brand_type text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists brand_site_sections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  page_key text not null,
  section_key text not null,
  section_type text not null default 'content',
  title text not null default '',
  subtitle text not null default '',
  body text not null default '',
  image_url text not null default '',
  image_alt text not null default '',
  action_label text not null default '',
  action_url text not null default '',
  tags jsonb not null default '[]'::jsonb,
  fields jsonb not null default '{}'::jsonb,
  title_display_names jsonb not null default '{}'::jsonb,
  subtitle_display_names jsonb not null default '{}'::jsonb,
  body_display_names jsonb not null default '{}'::jsonb,
  action_label_display_names jsonb not null default '{}'::jsonb,
  tag_display_names jsonb not null default '{}'::jsonb,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, page_key, section_key)
);

alter table brand_site_sections add column if not exists image_alt text not null default '';
alter table brand_site_sections add column if not exists title_display_names jsonb not null default '{}'::jsonb;
alter table brand_site_sections add column if not exists subtitle_display_names jsonb not null default '{}'::jsonb;
alter table brand_site_sections add column if not exists body_display_names jsonb not null default '{}'::jsonb;
alter table brand_site_sections add column if not exists action_label_display_names jsonb not null default '{}'::jsonb;
alter table brand_site_sections add column if not exists tag_display_names jsonb not null default '{}'::jsonb;

create table if not exists brand_site_section_revisions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references brand_site_sections(id) on delete set null,
  brand_id uuid not null references brands(id) on delete cascade,
  page_key text not null,
  section_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  submitted_by uuid references employees(id) on delete set null,
  reviewed_by uuid references employees(id) on delete set null,
  review_note text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table brand_site_section_revisions add column if not exists review_note text not null default '';

create table if not exists store_brands (
  store_id uuid not null references stores(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  pos_pricing_mode text not null default 'fixed',
  pos_weight_unit text not null default 'g',
  pos_weight_unit_price numeric(12, 2),
  primary key (store_id, brand_id)
);

alter table store_brands add column if not exists pos_pricing_mode text not null default 'fixed';
alter table store_brands add column if not exists pos_weight_unit text not null default 'g';
alter table store_brands add column if not exists pos_weight_unit_price numeric(12, 2);

update store_brands
set
  pos_pricing_mode = 'weight',
  pos_weight_unit = 'g',
  pos_weight_unit_price = coalesce(pos_weight_unit_price, 4)
from brands
where brands.id = store_brands.brand_id
  and brands.name = 'まぁ麻'
  and store_brands.pos_pricing_mode = 'fixed';

create table if not exists store_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  provider text not null default 'komoju',
  account_name text not null default '',
  secret_key text not null default '',
  secret_key_env_name text not null default '',
  webhook_secret text not null default '',
  webhook_secret_env_name text not null default '',
  payment_types text[] not null default '{}',
  payment_types_env_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_store_payment_accounts_store_provider
  on store_payment_accounts(store_id, provider, is_active);

alter table store_payment_accounts add column if not exists payment_types_env_name text not null default '';

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  login_id text unique,
  email text unique,
  gender text not null default 'unspecified',
  name_kana text,
  address text,
  birth_date date,
  my_number text,
  employee_number text,
  hire_date date,
  resignation_date date,
  resignation_reason text,
  business_type text,
  is_foreign_national boolean not null default false,
  employee_type text not null default 'part_time',
  lark_open_id text,
  lark_user_id text,
  password_hash text,
  password_must_change boolean not null default false,
  privacy_consent_reset_required boolean not null default false,
  password_changed_at timestamptz,
  role text not null,
  status text not null default 'active',
  session_version integer not null default 1,
  last_seen_at timestamptz,
  ui_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table employees add column if not exists last_seen_at timestamptz;
alter table employees add column if not exists ui_preferences jsonb not null default '{}'::jsonb;
alter table employees add column if not exists lark_open_id text;
alter table employees add column if not exists lark_user_id text;
alter table employees add column if not exists password_must_change boolean not null default false;
alter table employees add column if not exists privacy_consent_reset_required boolean not null default false;
alter table employees add column if not exists password_changed_at timestamptz;
update employees
set password_must_change = true
where role in ('store_manager', 'staff')
  and password_hash is not null
  and password_changed_at is null
  and password_must_change = false;
alter table employees add column if not exists session_version integer not null default 1;
alter table employees add column if not exists staff_category text not null default 'working';
alter table employees add column if not exists payroll_subject text not null default 'none';
alter table employees add column if not exists gender text not null default 'unspecified';
alter table employees add column if not exists name_kana text;
alter table employees add column if not exists address text;
alter table employees add column if not exists birth_date date;
alter table employees add column if not exists my_number text;
alter table employees add column if not exists employee_number text;
alter table employees add column if not exists hire_date date;
alter table employees add column if not exists resignation_date date;
alter table employees add column if not exists resignation_reason text;
alter table employees add column if not exists business_type text;
alter table employees add column if not exists is_foreign_national boolean not null default false;
alter table employees add column if not exists employee_type text not null default 'part_time';
alter table employees add column if not exists payroll_bank_code text;
alter table employees add column if not exists payroll_bank_name text;
alter table employees add column if not exists payroll_branch_code text;
alter table employees add column if not exists payroll_branch_name text;
alter table employees add column if not exists payroll_account_type text not null default 'ordinary';
alter table employees add column if not exists payroll_account_number text;
alter table employees add column if not exists payroll_account_holder_kana text;
update employees
set staff_category = 'device',
    payroll_subject = 'none'
where role = 'store_terminal'
  and staff_category <> 'device';

create table if not exists employee_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  session_version integer not null,
  surface text not null default 'os',
  user_agent text not null default '',
  ip_address text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz,
  revoked_reason text
);

create index if not exists employee_sessions_employee_active_idx
  on employee_sessions(employee_id, session_version, expires_at, last_seen_at)
  where revoked_at is null;

create table if not exists store_terminal_login_requests (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  status text not null default 'pending',
  terminal_employee_id uuid references employees(id) on delete set null,
  store_id uuid references stores(id) on delete set null,
  requested_user_agent text not null default '',
  requested_ip_address text not null default '',
  approved_by uuid references employees(id) on delete set null,
  approved_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_terminal_login_requests_status_idx
  on store_terminal_login_requests(status, expires_at);

alter table stores add column if not exists default_procurement_staff_id uuid;
alter table stores drop constraint if exists stores_default_procurement_staff_id_fkey;
alter table stores
  add constraint stores_default_procurement_staff_id_fkey
  foreign key (default_procurement_staff_id) references employees(id) on delete set null;

create table if not exists os_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_employee_id uuid references employees(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists os_audit_logs_created_at_idx on os_audit_logs (created_at desc);
create index if not exists os_audit_logs_actor_idx on os_audit_logs (actor_employee_id, created_at desc);

create table if not exists role_permissions (
  role text not null,
  permission_key text not null,
  is_enabled boolean not null default true,
  updated_by uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (role, permission_key)
);

create index if not exists role_permissions_permission_idx on role_permissions (permission_key);

create table if not exists feedback_reports (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'os',
  module text not null default '',
  category text not null default 'bug',
  severity text not null default 'normal',
  status text not null default 'open',
  title text not null default '',
  description text not null default '',
  expected_result text not null default '',
  page_url text not null default '',
  screenshot_url text not null default '',
  reported_by uuid references employees(id) on delete set null,
  store_id uuid references stores(id) on delete set null,
  brand_id uuid references brands(id) on delete set null,
  user_agent text not null default '',
  viewport_width integer,
  viewport_height integer,
  language text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  admin_note text not null default '',
  handled_by uuid references employees(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table feedback_reports add column if not exists source text not null default 'os';
alter table feedback_reports add column if not exists module text not null default '';
alter table feedback_reports add column if not exists category text not null default 'bug';
alter table feedback_reports add column if not exists severity text not null default 'normal';
alter table feedback_reports add column if not exists status text not null default 'open';
alter table feedback_reports add column if not exists title text not null default '';
alter table feedback_reports add column if not exists description text not null default '';
alter table feedback_reports add column if not exists expected_result text not null default '';
alter table feedback_reports add column if not exists page_url text not null default '';
alter table feedback_reports add column if not exists screenshot_url text not null default '';
alter table feedback_reports add column if not exists reported_by uuid references employees(id) on delete set null;
alter table feedback_reports add column if not exists store_id uuid references stores(id) on delete set null;
alter table feedback_reports add column if not exists brand_id uuid references brands(id) on delete set null;
alter table feedback_reports add column if not exists user_agent text not null default '';
alter table feedback_reports add column if not exists viewport_width integer;
alter table feedback_reports add column if not exists viewport_height integer;
alter table feedback_reports add column if not exists language text not null default '';
alter table feedback_reports add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table feedback_reports add column if not exists admin_note text not null default '';
alter table feedback_reports add column if not exists handled_by uuid references employees(id) on delete set null;
alter table feedback_reports add column if not exists handled_at timestamptz;
alter table feedback_reports add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_feedback_reports_source_status_created
  on feedback_reports(source, status, created_at desc);
create index if not exists idx_feedback_reports_store_status_created
  on feedback_reports(store_id, status, created_at desc);
create index if not exists idx_feedback_reports_reported_by_created
  on feedback_reports(reported_by, created_at desc);

create table if not exists module_settings (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null default 'global',
  module_key text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_key, module_key)
);

create table if not exists employee_scopes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  scope_type text not null,
  store_id uuid references stores(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  supplier_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists employee_work_stores (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  employee_number text,
  hire_date date,
  resignation_date date,
  resignation_reason text,
  business_type text,
  employee_type text not null default 'part_time',
  payroll_enabled boolean not null default true,
  employment_type text not null default 'hourly',
  hourly_wage numeric,
  monthly_salary numeric,
  prescribed_monthly_work_minutes integer,
  commute_allowance_per_workday numeric not null default 0,
  commute_allowance_monthly_cap numeric,
  apply_social_insurance boolean not null default false,
  social_insurance_standard_monthly_amount numeric(12, 2),
  social_insurance_deduction_from date,
  apply_employment_insurance boolean not null default false,
  employment_insurance_deduction_from date,
  apply_labor_insurance boolean not null default false,
  apply_income_tax boolean not null default false,
  apply_resident_tax boolean not null default false,
  resident_tax_year integer,
  resident_tax_june_amount numeric(12, 2),
  resident_tax_monthly_amount numeric(12, 2),
  created_at timestamptz not null default now(),
  unique (employee_id, store_id)
);

alter table employee_work_stores add column if not exists payroll_enabled boolean not null default true;
alter table employee_work_stores add column if not exists employee_number text;
alter table employee_work_stores add column if not exists hire_date date;
alter table employee_work_stores add column if not exists resignation_date date;
alter table employee_work_stores add column if not exists resignation_reason text;
alter table employee_work_stores add column if not exists business_type text;
alter table employee_work_stores add column if not exists employee_type text not null default 'part_time';
alter table employee_work_stores add column if not exists employment_type text not null default 'hourly';
alter table employee_work_stores add column if not exists hourly_wage numeric;
alter table employee_work_stores add column if not exists monthly_salary numeric;
alter table employee_work_stores add column if not exists prescribed_monthly_work_minutes integer;
alter table employee_work_stores add column if not exists commute_allowance_per_workday numeric not null default 0;
alter table employee_work_stores add column if not exists commute_allowance_monthly_cap numeric;
alter table employee_work_stores add column if not exists apply_social_insurance boolean not null default false;
alter table employee_work_stores add column if not exists social_insurance_standard_monthly_amount numeric(12, 2);
alter table employee_work_stores add column if not exists social_insurance_deduction_from date;
alter table employee_work_stores add column if not exists apply_employment_insurance boolean not null default false;
alter table employee_work_stores add column if not exists employment_insurance_deduction_from date;
alter table employee_work_stores add column if not exists apply_labor_insurance boolean not null default false;
alter table employee_work_stores add column if not exists apply_income_tax boolean not null default false;
alter table employee_work_stores add column if not exists income_tax_category text not null default 'none';
alter table employee_work_stores add column if not exists dependent_count integer not null default 0;
alter table employee_work_stores add column if not exists apply_resident_tax boolean not null default false;
alter table employee_work_stores add column if not exists resident_tax_year integer;
alter table employee_work_stores add column if not exists resident_tax_june_amount numeric(12, 2);
alter table employee_work_stores add column if not exists resident_tax_monthly_amount numeric(12, 2);

create table if not exists payroll_statutory_alert_dismissals (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  alert_key text not null,
  target_year integer not null,
  dismissed_by uuid references employees(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  unique (store_id, alert_key, target_year)
);

create index if not exists payroll_statutory_alert_dismissals_lookup_idx
  on payroll_statutory_alert_dismissals(alert_key, target_year, store_id);

create table if not exists privacy_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  version text not null,
  title text not null default '個人情報および個人番号の取扱いに関する通知書・同意書',
  body text not null default '',
  effective_date date not null default current_date,
  is_active boolean not null default true,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, version)
);

create unique index if not exists privacy_documents_one_active_per_company_idx
  on privacy_documents(company_id)
  where is_active;

create table if not exists privacy_consents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  document_id uuid not null references privacy_documents(id) on delete restrict,
  document_version text not null,
  document_title text not null default '',
  document_body text not null default '',
  company_legal_name_snapshot text not null default '',
  employee_name_snapshot text not null default '',
  agreed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (employee_id, company_id, document_id)
);

create index if not exists privacy_consents_employee_company_idx
  on privacy_consents(employee_id, company_id, agreed_at desc);

alter table privacy_consents add column if not exists document_title text not null default '';
alter table privacy_consents add column if not exists document_body text not null default '';
alter table privacy_consents add column if not exists company_legal_name_snapshot text not null default '';

insert into privacy_documents (company_id, version, body)
select companies.id, 'v1.0', ''
from companies
where companies.status = 'active'
on conflict do nothing;

insert into employee_work_stores (employee_id, store_id)
select distinct employee_id, store_id
from employee_scopes
where scope_type = 'store'
  and store_id is not null
on conflict do nothing;

update employee_work_stores
set
  employee_number = coalesce(employee_work_stores.employee_number, employees.employee_number),
  hire_date = coalesce(employee_work_stores.hire_date, employees.hire_date),
  resignation_date = coalesce(employee_work_stores.resignation_date, employees.resignation_date),
  resignation_reason = coalesce(employee_work_stores.resignation_reason, employees.resignation_reason),
  business_type = coalesce(employee_work_stores.business_type, employees.business_type)
from employees
where employees.id = employee_work_stores.employee_id;

create table if not exists timecard_store_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  workday_change_time time not null default '05:00',
  rounding_minutes integer not null default 15,
  clock_in_rounding text not null default 'ceil',
  clock_out_rounding text not null default 'floor',
  break_start_rounding text not null default 'floor',
  break_end_rounding text not null default 'ceil',
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id)
);

create table if not exists timecard_employee_settings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  employment_type text not null default 'hourly',
  hourly_wage numeric(12, 2),
  monthly_salary numeric(12, 2),
  prescribed_monthly_work_minutes integer,
  commute_allowance_per_workday numeric(12, 2) not null default 0,
  commute_allowance_monthly_cap numeric(12, 2),
  apply_social_insurance boolean not null default false,
  apply_employment_insurance boolean not null default false,
  apply_labor_insurance boolean not null default false,
  apply_income_tax boolean not null default false,
  apply_resident_tax boolean not null default false,
  payroll_enabled boolean not null default true,
  valid_from date not null default '1970-01-01',
  valid_to date,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table timecard_employee_settings add column if not exists commute_allowance_monthly_cap numeric(12, 2);
alter table timecard_employee_settings add column if not exists prescribed_monthly_work_minutes integer;
alter table timecard_employee_settings add column if not exists apply_social_insurance boolean not null default false;
alter table timecard_employee_settings add column if not exists social_insurance_standard_monthly_amount numeric(12, 2);
alter table timecard_employee_settings add column if not exists social_insurance_deduction_from date;
alter table timecard_employee_settings add column if not exists apply_employment_insurance boolean not null default false;
alter table timecard_employee_settings add column if not exists employment_insurance_deduction_from date;
alter table timecard_employee_settings add column if not exists apply_labor_insurance boolean not null default false;
alter table timecard_employee_settings add column if not exists apply_income_tax boolean not null default false;
alter table timecard_employee_settings add column if not exists income_tax_category text not null default 'none';
alter table timecard_employee_settings add column if not exists dependent_count integer not null default 0;
alter table timecard_employee_settings add column if not exists apply_resident_tax boolean not null default false;

create table if not exists employee_work_store_payroll_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  payroll_enabled boolean not null default true,
  employment_type text not null default 'hourly',
  hourly_wage numeric(12, 2),
  monthly_salary numeric(12, 2),
  prescribed_monthly_work_minutes integer,
  commute_allowance_per_workday numeric(12, 2) not null default 0,
  commute_allowance_monthly_cap numeric(12, 2),
  apply_social_insurance boolean not null default false,
  social_insurance_standard_monthly_amount numeric(12, 2),
  social_insurance_deduction_from date,
  apply_employment_insurance boolean not null default false,
  employment_insurance_deduction_from date,
  apply_labor_insurance boolean not null default false,
  apply_income_tax boolean not null default false,
  apply_resident_tax boolean not null default false,
  resident_tax_year integer,
  resident_tax_june_amount numeric(12, 2),
  resident_tax_monthly_amount numeric(12, 2),
  wage_valid_from date not null default '1970-01-01',
  commute_valid_from date not null default '1970-01-01',
  valid_from date not null default current_date,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table employee_work_store_payroll_history add column if not exists commute_allowance_monthly_cap numeric(12, 2);
alter table employee_work_store_payroll_history add column if not exists prescribed_monthly_work_minutes integer;
alter table employee_work_store_payroll_history add column if not exists apply_social_insurance boolean not null default false;
alter table employee_work_store_payroll_history add column if not exists social_insurance_standard_monthly_amount numeric(12, 2);
alter table employee_work_store_payroll_history add column if not exists social_insurance_deduction_from date;
alter table employee_work_store_payroll_history add column if not exists apply_employment_insurance boolean not null default false;
alter table employee_work_store_payroll_history add column if not exists employment_insurance_deduction_from date;
alter table employee_work_store_payroll_history add column if not exists apply_labor_insurance boolean not null default false;
alter table employee_work_store_payroll_history add column if not exists apply_income_tax boolean not null default false;
alter table employee_work_store_payroll_history add column if not exists income_tax_category text not null default 'none';
alter table employee_work_store_payroll_history add column if not exists dependent_count integer not null default 0;
alter table employee_work_store_payroll_history add column if not exists apply_resident_tax boolean not null default false;
alter table employee_work_store_payroll_history add column if not exists resident_tax_year integer;
alter table employee_work_store_payroll_history add column if not exists resident_tax_june_amount numeric(12, 2);
alter table employee_work_store_payroll_history add column if not exists resident_tax_monthly_amount numeric(12, 2);
alter table employee_work_store_payroll_history add column if not exists wage_valid_from date not null default '1970-01-01';
alter table employee_work_store_payroll_history add column if not exists commute_valid_from date not null default '1970-01-01';
update employee_work_store_payroll_history
set
  wage_valid_from = valid_from,
  commute_valid_from = valid_from
where wage_valid_from = '1970-01-01'
  and commute_valid_from = '1970-01-01'
  and valid_from <> '1970-01-01';
create index if not exists idx_employee_work_store_payroll_history_lookup
  on employee_work_store_payroll_history(employee_id, store_id, valid_from desc);
create index if not exists idx_employee_work_store_payroll_history_wage_lookup
  on employee_work_store_payroll_history(employee_id, store_id, wage_valid_from desc);
create index if not exists idx_employee_work_store_payroll_history_commute_lookup
  on employee_work_store_payroll_history(employee_id, store_id, commute_valid_from desc);
alter table employee_work_store_payroll_history
  drop constraint if exists employee_work_store_payroll_history_employee_id_store_id_valid_from_key;
create unique index if not exists employee_work_store_payroll_history_effective_idx
  on employee_work_store_payroll_history(employee_id, store_id, wage_valid_from, commute_valid_from);

create table if not exists employee_lifecycle_cases (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  case_type text not null,
  title text not null,
  status text not null default 'open',
  store_id uuid references stores(id) on delete set null,
  started_at date,
  completed_at timestamptz,
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table employee_lifecycle_cases add column if not exists case_type text not null default 'onboarding';
alter table employee_lifecycle_cases add column if not exists title text not null default '';
alter table employee_lifecycle_cases add column if not exists status text not null default 'open';
alter table employee_lifecycle_cases add column if not exists store_id uuid references stores(id) on delete set null;
alter table employee_lifecycle_cases add column if not exists started_at date;
alter table employee_lifecycle_cases add column if not exists completed_at timestamptz;
alter table employee_lifecycle_cases add column if not exists created_by uuid references employees(id) on delete set null;
alter table employee_lifecycle_cases add column if not exists updated_by uuid references employees(id) on delete set null;

drop index if exists employee_lifecycle_cases_open_type_idx;
create unique index if not exists employee_lifecycle_cases_open_type_store_idx
  on employee_lifecycle_cases(employee_id, case_type, store_id)
  where status <> 'archived' and store_id is not null;
create unique index if not exists employee_lifecycle_cases_open_type_no_store_idx
  on employee_lifecycle_cases(employee_id, case_type)
  where status <> 'archived' and store_id is null;

create table if not exists employee_lifecycle_tasks (
  id uuid primary key default gen_random_uuid(),
  lifecycle_case_id uuid not null references employee_lifecycle_cases(id) on delete cascade,
  task_key text not null,
  title text not null,
  description text not null default '',
  status text not null default 'todo',
  assignee_employee_id uuid references employees(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  completed_by uuid references employees(id) on delete set null,
  note text not null default '',
  required_document_types jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lifecycle_case_id, task_key)
);

alter table employee_lifecycle_tasks add column if not exists task_key text not null default '';
alter table employee_lifecycle_tasks add column if not exists description text not null default '';
alter table employee_lifecycle_tasks add column if not exists status text not null default 'todo';
alter table employee_lifecycle_tasks add column if not exists assignee_employee_id uuid references employees(id) on delete set null;
alter table employee_lifecycle_tasks add column if not exists due_date date;
alter table employee_lifecycle_tasks add column if not exists completed_at timestamptz;
alter table employee_lifecycle_tasks add column if not exists completed_by uuid references employees(id) on delete set null;
alter table employee_lifecycle_tasks add column if not exists note text not null default '';
alter table employee_lifecycle_tasks add column if not exists required_document_types jsonb not null default '[]'::jsonb;
alter table employee_lifecycle_tasks add column if not exists sort_order integer not null default 0;

create index if not exists employee_lifecycle_tasks_case_order_idx
  on employee_lifecycle_tasks(lifecycle_case_id, sort_order);

create table if not exists employee_lifecycle_documents (
  id uuid primary key default gen_random_uuid(),
  lifecycle_case_id uuid not null references employee_lifecycle_cases(id) on delete cascade,
  lifecycle_task_id uuid references employee_lifecycle_tasks(id) on delete set null,
  document_type text not null default 'other',
  file_name text not null default '',
  file_url text not null,
  file_size_bytes integer,
  content_type text,
  uploaded_by uuid references employees(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  note text not null default ''
);

alter table employee_lifecycle_documents add column if not exists lifecycle_task_id uuid references employee_lifecycle_tasks(id) on delete set null;
alter table employee_lifecycle_documents add column if not exists document_type text not null default 'other';
alter table employee_lifecycle_documents add column if not exists file_name text not null default '';
alter table employee_lifecycle_documents add column if not exists file_size_bytes integer;
alter table employee_lifecycle_documents add column if not exists content_type text;
alter table employee_lifecycle_documents add column if not exists uploaded_by uuid references employees(id) on delete set null;
alter table employee_lifecycle_documents add column if not exists note text not null default '';

create index if not exists employee_lifecycle_documents_case_idx
  on employee_lifecycle_documents(lifecycle_case_id, uploaded_at desc);

update employee_work_stores
set
  payroll_enabled = coalesce(latest_settings.payroll_enabled, employee_work_stores.payroll_enabled),
  employment_type = coalesce(latest_settings.employment_type, employee_work_stores.employment_type),
  hourly_wage = coalesce(employee_work_stores.hourly_wage, latest_settings.hourly_wage),
  monthly_salary = coalesce(employee_work_stores.monthly_salary, latest_settings.monthly_salary),
  prescribed_monthly_work_minutes = coalesce(employee_work_stores.prescribed_monthly_work_minutes, latest_settings.prescribed_monthly_work_minutes),
  commute_allowance_per_workday = coalesce(nullif(employee_work_stores.commute_allowance_per_workday, 0), latest_settings.commute_allowance_per_workday, 0),
  commute_allowance_monthly_cap = coalesce(employee_work_stores.commute_allowance_monthly_cap, latest_settings.commute_allowance_monthly_cap),
  apply_social_insurance = coalesce(latest_settings.apply_social_insurance, employee_work_stores.apply_social_insurance),
  social_insurance_standard_monthly_amount = coalesce(latest_settings.social_insurance_standard_monthly_amount, employee_work_stores.social_insurance_standard_monthly_amount),
  social_insurance_deduction_from = coalesce(latest_settings.social_insurance_deduction_from, employee_work_stores.social_insurance_deduction_from),
  apply_employment_insurance = coalesce(latest_settings.apply_employment_insurance, employee_work_stores.apply_employment_insurance),
  employment_insurance_deduction_from = coalesce(latest_settings.employment_insurance_deduction_from, employee_work_stores.employment_insurance_deduction_from),
  apply_labor_insurance = coalesce(latest_settings.apply_labor_insurance, employee_work_stores.apply_labor_insurance),
  apply_income_tax = coalesce(latest_settings.apply_income_tax, employee_work_stores.apply_income_tax),
  income_tax_category = coalesce(latest_settings.income_tax_category, employee_work_stores.income_tax_category),
  dependent_count = coalesce(latest_settings.dependent_count, employee_work_stores.dependent_count),
  apply_resident_tax = coalesce(latest_settings.apply_resident_tax, employee_work_stores.apply_resident_tax)
from (
  select distinct on (employee_id)
    employee_id,
    employment_type,
    hourly_wage,
    monthly_salary,
    prescribed_monthly_work_minutes,
    commute_allowance_per_workday,
    commute_allowance_monthly_cap,
    apply_social_insurance,
    social_insurance_standard_monthly_amount,
    social_insurance_deduction_from,
    apply_employment_insurance,
    employment_insurance_deduction_from,
    apply_labor_insurance,
    apply_income_tax,
    income_tax_category,
    dependent_count,
    apply_resident_tax,
    payroll_enabled
  from timecard_employee_settings
  order by employee_id, valid_from desc, created_at desc
) latest_settings
where latest_settings.employee_id = employee_work_stores.employee_id;

create table if not exists withholding_tax_tables (
  id uuid primary key default gen_random_uuid(),
  tax_year integer not null,
  table_type text not null default 'monthly',
  title text not null,
  source_file_name text,
  effective_from date not null,
  is_active boolean not null default true,
  uploaded_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tax_year, table_type)
);

create table if not exists withholding_tax_table_rows (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references withholding_tax_tables(id) on delete cascade,
  salary_min integer not null,
  salary_max integer,
  kou_tax_0 integer,
  kou_tax_1 integer,
  kou_tax_2 integer,
  kou_tax_3 integer,
  kou_tax_4 integer,
  kou_tax_5 integer,
  kou_tax_6 integer,
  kou_tax_7 integer,
  otsu_tax integer,
  otsu_rate numeric(8, 5),
  formula_note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists withholding_tax_table_rows_lookup_idx
  on withholding_tax_table_rows(table_id, salary_min, salary_max);

create table if not exists social_insurance_tables (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null,
  title text not null,
  source_file_name text,
  effective_from date not null,
  child_support_effective_from date,
  is_active boolean not null default true,
  uploaded_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table employment_insurance_rate_tables drop constraint if exists employment_insurance_rate_tables_fiscal_year_key;
create index if not exists employment_insurance_rate_tables_year_idx
  on employment_insurance_rate_tables(fiscal_year, created_at desc);

create table if not exists social_insurance_table_rows (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references social_insurance_tables(id) on delete cascade,
  prefecture text not null,
  grade text not null,
  standard_monthly_amount integer not null,
  reward_min integer,
  reward_max integer,
  health_rate_without_care numeric(8, 5),
  health_rate_with_care numeric(8, 5),
  child_support_rate numeric(8, 5),
  pension_rate numeric(8, 5),
  health_half_without_care numeric(12, 2),
  health_half_with_care numeric(12, 2),
  child_support_half numeric(12, 2),
  pension_half numeric(12, 2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists social_insurance_rows_lookup_idx
  on social_insurance_table_rows(table_id, prefecture, standard_monthly_amount);

create table if not exists employment_insurance_rate_tables (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null,
  title text not null,
  source_file_name text,
  effective_from date not null,
  effective_to date not null,
  is_active boolean not null default true,
  uploaded_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (fiscal_year)
);

create table if not exists employment_insurance_rate_rows (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references employment_insurance_rate_tables(id) on delete cascade,
  business_type text not null,
  employee_rate numeric(8, 5) not null,
  employer_rate numeric(8, 5),
  benefit_rate numeric(8, 5),
  two_projects_rate numeric(8, 5),
  total_rate numeric(8, 5),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists employment_insurance_rate_rows_lookup_idx
  on employment_insurance_rate_rows(table_id, business_type);

create table if not exists timecard_punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  punch_type text not null,
  punched_at timestamptz not null default now(),
  source text not null default 'store',
  note text,
  mobile_latitude numeric(10, 6),
  mobile_longitude numeric(10, 6),
  mobile_accuracy_meters numeric(10, 2),
  store_latitude numeric(10, 6),
  store_longitude numeric(10, 6),
  distance_from_store_meters numeric(10, 2),
  location_verdict text,
  user_agent text,
  ip_address text,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table timecard_punches add column if not exists mobile_latitude numeric(10, 6);
alter table timecard_punches add column if not exists mobile_longitude numeric(10, 6);
alter table timecard_punches add column if not exists mobile_accuracy_meters numeric(10, 2);
alter table timecard_punches add column if not exists store_latitude numeric(10, 6);
alter table timecard_punches add column if not exists store_longitude numeric(10, 6);
alter table timecard_punches add column if not exists distance_from_store_meters numeric(10, 2);
alter table timecard_punches add column if not exists location_verdict text;
alter table timecard_punches add column if not exists user_agent text;
alter table timecard_punches add column if not exists ip_address text;

create table if not exists timecard_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  work_date date not null,
  scheduled_start time,
  scheduled_end time,
  break_minutes integer not null default 0,
  note text,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists timecard_shift_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  request_type text not null,
  status text not null default 'open',
  target_shift_id uuid references timecard_shifts(id) on delete set null,
  work_date date,
  title text not null default '',
  note text,
  reviewed_by uuid references employees(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table timecard_shift_requests add column if not exists target_shift_id uuid references timecard_shifts(id) on delete set null;
alter table timecard_shift_requests add column if not exists review_note text;

create table if not exists timecard_shift_request_windows (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references timecard_shift_requests(id) on delete cascade,
  work_date date not null,
  available_start time,
  available_end time,
  preference text not null default 'available',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists timecard_shift_request_candidates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references timecard_shift_requests(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  status text not null default 'applied',
  note text,
  approved_by uuid references employees(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, employee_id)
);

create table if not exists timecard_shift_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references timecard_shift_requests(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists timecard_shift_publications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  schedule_month text not null,
  note text,
  published_by uuid references employees(id) on delete set null,
  published_at timestamptz not null default now()
);

create table if not exists timecard_payroll_confirmations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  payroll_month text not null,
  period_start date not null,
  period_end date not null,
  payroll_rows jsonb not null default '[]'::jsonb,
  payroll_totals jsonb not null default '{}'::jsonb,
  confirmed_by uuid references employees(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, payroll_month)
);

create index if not exists idx_timecard_payroll_confirmations_store_month
  on timecard_payroll_confirmations(store_id, payroll_month);

create table if not exists payroll_payment_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  payroll_confirmation_id uuid references timecard_payroll_confirmations(id) on delete set null,
  payroll_month text not null,
  payment_date date not null,
  bank_provider text not null default 'zengin',
  transfer_type text not null default 'salary',
  company_name text not null default '',
  debit_bank_code text not null default '',
  debit_bank_name text not null default '',
  debit_branch_code text not null default '',
  debit_branch_name text not null default '',
  debit_account_type text not null default 'ordinary',
  debit_account_number text not null default '',
  debit_account_holder_kana text not null default '',
  total_amount numeric(12, 0) not null default 0,
  transfer_count integer not null default 0,
  file_format text not null default 'zengin',
  file_name text not null default '',
  file_sha256 text not null default '',
  status text not null default 'exported',
  bank_receipt_number text,
  bank_result_note text not null default '',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table payroll_payment_batches add column if not exists payroll_confirmation_id uuid references timecard_payroll_confirmations(id) on delete set null;
alter table payroll_payment_batches add column if not exists transfer_type text not null default 'salary';
alter table payroll_payment_batches add column if not exists debit_bank_code text not null default '';
alter table payroll_payment_batches add column if not exists debit_bank_name text not null default '';
alter table payroll_payment_batches add column if not exists debit_branch_code text not null default '';
alter table payroll_payment_batches add column if not exists debit_branch_name text not null default '';
alter table payroll_payment_batches add column if not exists debit_account_type text not null default 'ordinary';
alter table payroll_payment_batches add column if not exists debit_account_number text not null default '';
alter table payroll_payment_batches add column if not exists debit_account_holder_kana text not null default '';
alter table payroll_payment_batches add column if not exists file_sha256 text not null default '';
alter table payroll_payment_batches add column if not exists bank_receipt_number text;
alter table payroll_payment_batches add column if not exists bank_result_note text not null default '';

create index if not exists payroll_payment_batches_store_month_idx
  on payroll_payment_batches(store_id, payroll_month, created_at desc);

create table if not exists payroll_payment_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references payroll_payment_batches(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  employee_name text not null default '',
  employee_name_kana text,
  bank_code text not null default '',
  bank_name text not null default '',
  branch_code text not null default '',
  branch_name text not null default '',
  account_type text not null default 'ordinary',
  account_number text not null default '',
  account_holder_kana text not null default '',
  transfer_amount numeric(12, 0) not null default 0,
  row_alerts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table payroll_payment_batch_items add column if not exists employee_name_kana text;
alter table payroll_payment_batch_items add column if not exists bank_name text not null default '';
alter table payroll_payment_batch_items add column if not exists branch_name text not null default '';
alter table payroll_payment_batch_items add column if not exists row_alerts jsonb not null default '[]'::jsonb;

create index if not exists payroll_payment_batch_items_batch_idx
  on payroll_payment_batch_items(batch_id);

create table if not exists payroll_allowance_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null check (rule_type in ('fixed_monthly', 'one_person_busy_hourly')),
  store_id uuid references stores(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  amount numeric(12, 2) not null default 0,
  include_in_premium_base boolean not null default true,
  valid_from date not null default '1970-01-01',
  valid_to date,
  is_enabled boolean not null default true,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table payroll_allowance_rules add column if not exists include_in_premium_base boolean not null default true;
alter table payroll_allowance_rules add column if not exists valid_to date;
alter table payroll_allowance_rules add column if not exists is_enabled boolean not null default true;

create table if not exists payroll_allowance_rule_windows (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references payroll_allowance_rules(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now()
);

create index if not exists payroll_allowance_rules_lookup_idx
  on payroll_allowance_rules(store_id, employee_id, rule_type, valid_from, valid_to, is_enabled);

create index if not exists payroll_allowance_rule_windows_rule_idx
  on payroll_allowance_rule_windows(rule_id, weekday);

create table if not exists timecard_workload_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  include_management boolean not null default true,
  min_order_load_score numeric(8, 2) not null default 1,
  amount_score_multiplier numeric(8, 2) not null default 1,
  high_load_order_threshold integer not null default 8,
  high_load_score_threshold numeric(8, 2) not null default 8,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id)
);

alter table timecard_workload_settings add column if not exists min_order_load_score numeric(8, 2) not null default 1;
alter table timecard_workload_settings add column if not exists amount_score_multiplier numeric(8, 2) not null default 1;
alter table timecard_workload_settings add column if not exists high_load_order_threshold integer not null default 8;
alter table timecard_workload_settings add column if not exists high_load_score_threshold numeric(8, 2) not null default 8;
alter table timecard_workload_settings add column if not exists order_very_idle_max integer not null default 4;
alter table timecard_workload_settings add column if not exists order_normal_max integer not null default 8;
alter table timecard_workload_settings add column if not exists order_busy_max integer not null default 12;
alter table timecard_workload_settings add column if not exists order_high_max integer not null default 15;
alter table timecard_workload_settings add column if not exists sales_very_idle_max integer not null default 4999;
alter table timecard_workload_settings add column if not exists sales_normal_max integer not null default 9999;
alter table timecard_workload_settings add column if not exists sales_busy_max integer not null default 14999;
alter table timecard_workload_settings add column if not exists sales_high_max integer not null default 19999;
alter table timecard_workload_settings add column if not exists score_very_idle numeric(8, 2) not null default 20;
alter table timecard_workload_settings add column if not exists score_normal numeric(8, 2) not null default 60;
alter table timecard_workload_settings add column if not exists score_busy numeric(8, 2) not null default 90;
alter table timecard_workload_settings add column if not exists score_high numeric(8, 2) not null default 120;
alter table timecard_workload_settings add column if not exists score_extreme numeric(8, 2) not null default 150;
alter table timecard_workload_settings add column if not exists peak_weight numeric(8, 2) not null default 60;
alter table timecard_workload_settings add column if not exists average_weight numeric(8, 2) not null default 30;
alter table timecard_workload_settings add column if not exists one_person_weight numeric(8, 2) not null default 10;
alter table timecard_workload_settings add column if not exists one_person_rate_score_cap numeric(8, 2) not null default 30;

create table if not exists sales_analysis_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  very_idle_rate_max numeric(8, 2) not null default 0.6,
  normal_rate_max numeric(8, 2) not null default 1.1,
  busy_rate_max numeric(8, 2) not null default 1.5,
  high_rate_max numeric(8, 2) not null default 2,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id)
);

alter table sales_analysis_settings add column if not exists very_idle_rate_max numeric(8, 2) not null default 0.6;
alter table sales_analysis_settings add column if not exists normal_rate_max numeric(8, 2) not null default 1.1;
alter table sales_analysis_settings add column if not exists busy_rate_max numeric(8, 2) not null default 1.5;
alter table sales_analysis_settings add column if not exists high_rate_max numeric(8, 2) not null default 2;

create table if not exists analytics_expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  category text not null default 'misc',
  account_title text not null default '',
  sub_account_title text not null default '',
  name text not null default '',
  amount numeric(12, 2) not null default 0,
  tax_rate text not null default '',
  tax_mode text not null default '',
  tax_amount numeric(12, 2) not null default 0,
  vendor_name text not null default '',
  transaction_date date,
  transaction_time time,
  expense_receipt_id uuid,
  start_month text not null default '2026-01',
  end_month text,
  note text not null default '',
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table analytics_expenses add column if not exists category text not null default 'misc';
alter table analytics_expenses add column if not exists account_title text not null default '';
alter table analytics_expenses add column if not exists sub_account_title text not null default '';
alter table analytics_expenses add column if not exists name text not null default '';
alter table analytics_expenses add column if not exists amount numeric(12, 2) not null default 0;
alter table analytics_expenses add column if not exists tax_rate text not null default '';
alter table analytics_expenses add column if not exists tax_mode text not null default '';
alter table analytics_expenses add column if not exists tax_amount numeric(12, 2) not null default 0;
alter table analytics_expenses add column if not exists vendor_name text not null default '';
alter table analytics_expenses add column if not exists transaction_date date;
alter table analytics_expenses add column if not exists transaction_time time;
alter table analytics_expenses add column if not exists expense_receipt_id uuid;
alter table analytics_expenses add column if not exists start_month text not null default '2026-01';
alter table analytics_expenses add column if not exists end_month text;
alter table analytics_expenses add column if not exists note text not null default '';
alter table analytics_expenses add column if not exists created_by uuid references employees(id) on delete set null;
alter table analytics_expenses add column if not exists updated_by uuid references employees(id) on delete set null;
create index if not exists analytics_expenses_store_month_idx on analytics_expenses (store_id, start_month, end_month);

create table if not exists expense_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  receipt_photo_url text not null default '',
  receipt_ocr_result_id uuid,
  vendor_name text not null default '',
  company_name text not null default '',
  brand_name text not null default '',
  location_name text not null default '',
  purchase_date date,
  purchase_time time,
  category text not null default 'misc',
  account_title text not null default '',
  subtotal numeric(12, 2),
  tax numeric(12, 2),
  total numeric(12, 2) not null default 0,
  note text not null default '',
  status text not null default 'draft',
  confirmed_at timestamptz,
  confirmed_by uuid references employees(id) on delete set null,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table expense_receipts add column if not exists receipt_photo_url text not null default '';
alter table expense_receipts add column if not exists receipt_ocr_result_id uuid;
alter table expense_receipts add column if not exists vendor_name text not null default '';
alter table expense_receipts add column if not exists company_name text not null default '';
alter table expense_receipts add column if not exists brand_name text not null default '';
alter table expense_receipts add column if not exists location_name text not null default '';
alter table expense_receipts add column if not exists purchase_date date;
alter table expense_receipts add column if not exists purchase_time time;
alter table expense_receipts add column if not exists category text not null default 'misc';
alter table expense_receipts add column if not exists account_title text not null default '';
alter table expense_receipts add column if not exists subtotal numeric(12, 2);
alter table expense_receipts add column if not exists tax numeric(12, 2);
alter table expense_receipts add column if not exists total numeric(12, 2) not null default 0;
alter table expense_receipts add column if not exists note text not null default '';
alter table expense_receipts add column if not exists status text not null default 'draft';
alter table expense_receipts add column if not exists confirmed_at timestamptz;
alter table expense_receipts add column if not exists confirmed_by uuid references employees(id) on delete set null;
alter table expense_receipts add column if not exists created_by uuid references employees(id) on delete set null;
create index if not exists expense_receipts_store_date_idx on expense_receipts (store_id, purchase_date desc);

create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references product_categories(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_brand_name text,
  manufacturer text,
  category text not null,
  subcategory text,
  unit text not null,
  reference_price numeric(12, 2),
  origin_countries text[] not null default '{}',
  package_quantity numeric(12, 3),
  package_quantity_unit text,
  product_family_name text,
  variant_name text,
  is_default_variant boolean not null default false,
  variant_sort_order integer not null default 0,
  spec_note text,
  japanese_note text,
  photo_url text,
  brand_scope text not null default 'unset',
  is_key_item boolean not null default false,
  is_price_sensitive boolean not null default false,
  is_imported boolean not null default false,
  import_origin_country text,
  import_currency text not null default 'CNY',
  import_original_price numeric(12, 2),
  import_exchange_rate numeric(12, 6) not null default 1,
  import_price_jpy numeric(12, 2),
  import_freight_rate_original_per_kg numeric(12, 2) not null default 20,
  import_freight_rate_jpy_per_kg numeric(12, 2) not null default 0,
  import_weight_strategy text not null default 'standard_1kg',
  import_weight_kg numeric(12, 3) not null default 1,
  import_freight_cost_jpy numeric(12, 2) not null default 0,
  import_tax_cost_jpy numeric(12, 2) not null default 0,
  import_other_cost_jpy numeric(12, 2) not null default 0,
  storage_type text,
  usage_type text not null default 'ingredient',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products add column if not exists spec_note text;
alter table products add column if not exists photo_url text;
alter table products add column if not exists storage_type text;
alter table products add column if not exists subcategory text;
alter table products add column if not exists origin_countries text[] not null default '{}';
alter table products add column if not exists package_quantity numeric(12, 3);
alter table products add column if not exists package_quantity_unit text;
alter table products add column if not exists product_family_name text;
alter table products add column if not exists variant_name text;
alter table products add column if not exists is_default_variant boolean not null default false;
alter table products add column if not exists variant_sort_order integer not null default 0;
alter table products add column if not exists product_brand_name text;
alter table products add column if not exists manufacturer text;
alter table products add column if not exists japanese_note text;
alter table products add column if not exists brand_scope text not null default 'unset';
alter table products add column if not exists usage_type text not null default 'ingredient';
alter table products add column if not exists is_imported boolean not null default false;
alter table products add column if not exists import_origin_country text;
alter table products add column if not exists import_currency text not null default 'CNY';
alter table products add column if not exists import_original_price numeric(12, 2);
alter table products add column if not exists import_exchange_rate numeric(12, 6) not null default 1;
alter table products add column if not exists import_price_jpy numeric(12, 2);
alter table products add column if not exists import_freight_rate_original_per_kg numeric(12, 2) not null default 20;
alter table products add column if not exists import_freight_rate_jpy_per_kg numeric(12, 2) not null default 0;
alter table products add column if not exists import_weight_strategy text not null default 'standard_1kg';
alter table products add column if not exists import_weight_kg numeric(12, 3) not null default 1;
alter table products add column if not exists import_freight_cost_jpy numeric(12, 2) not null default 0;
alter table products add column if not exists import_tax_cost_jpy numeric(12, 2) not null default 0;
alter table products add column if not exists import_other_cost_jpy numeric(12, 2) not null default 0;
alter table products drop constraint if exists products_name_key;

create table if not exists product_brand_usages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  usage_note text,
  default_order_quantity text,
  spec_note text,
  priority text not null default 'medium',
  is_orderable boolean not null default true,
  sort_order integer not null default 0,
  unique (product_id, brand_id)
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  channel_type text not null,
  reliability text,
  address text,
  phone text,
  contact_person text,
  business_hours text,
  order_url text,
  contact_note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists supplier_locations (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  name text not null,
  location_type text not null,
  area text,
  address text,
  opening_hours text,
  purchase_method text,
  supports_delivery boolean not null default false,
  supports_urgent_purchase boolean not null default false,
  note text,
  unique (supplier_id, name)
);

create table if not exists product_supplier_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  preferred_location_id uuid references supplier_locations(id) on delete set null,
  role text not null,
  reference_price numeric(12, 2),
  min_order_quantity text,
  lead_time text,
  purchase_url text,
  note text,
  is_active boolean not null default true,
  unique (product_id, supplier_id, role)
);

alter table product_supplier_options add column if not exists purchase_url text;

create table if not exists field_notes (
  id uuid primary key default gen_random_uuid(),
  note_type text not null default 'idea',
  title text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text,
  supplier_location text,
  product_name text,
  observed_price numeric(12, 2),
  photo_url text,
  note text,
  status text not null default 'open',
  recorded_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table field_notes add column if not exists note_type text not null default 'idea';
alter table field_notes add column if not exists title text not null default '';
alter table field_notes add column if not exists supplier_id uuid references suppliers(id) on delete set null;
alter table field_notes add column if not exists supplier_name text;
alter table field_notes add column if not exists supplier_location text;
alter table field_notes add column if not exists product_name text;
alter table field_notes add column if not exists observed_price numeric(12, 2);
alter table field_notes add column if not exists photo_url text;
alter table field_notes add column if not exists note text;
alter table field_notes add column if not exists status text not null default 'open';
alter table field_notes add column if not exists recorded_by uuid references employees(id);

create table if not exists field_note_comments (
  id uuid primary key default gen_random_uuid(),
  field_note_id uuid not null references field_notes(id) on delete cascade,
  comment text not null,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create table if not exists product_comparisons (
  id uuid primary key default gen_random_uuid(),
  base_product_id uuid references products(id) on delete set null,
  candidate_product_name text not null,
  candidate_supplier_id uuid references suppliers(id) on delete set null,
  candidate_supplier_name text,
  candidate_origin text,
  candidate_purchase_url text,
  candidate_price numeric(12, 2) not null default 0,
  candidate_original_price numeric(12, 2) not null default 0,
  candidate_currency text not null default 'JPY',
  exchange_rate numeric(12, 6) not null default 1,
  candidate_quantity numeric(12, 3) not null default 1,
  candidate_unit text not null default 'g',
  candidate_weight_kg numeric(12, 3) not null default 0,
  import_quantity numeric(12, 3) not null default 1,
  freight_rate_per_kg numeric(12, 2) not null default 0,
  freight_rate_original_per_kg numeric(12, 2) not null default 0,
  base_price numeric(12, 2) not null default 0,
  base_quantity numeric(12, 3) not null default 1,
  base_unit text not null default 'g',
  is_imported boolean not null default false,
  freight_cost numeric(12, 2) not null default 0,
  tax_cost numeric(12, 2) not null default 0,
  other_cost numeric(12, 2) not null default 0,
  photo_url text,
  note text,
  created_by uuid references employees(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_comparisons add column if not exists base_product_id uuid references products(id) on delete set null;
alter table product_comparisons add column if not exists candidate_product_name text not null default '';
alter table product_comparisons add column if not exists candidate_supplier_id uuid references suppliers(id) on delete set null;
alter table product_comparisons add column if not exists candidate_supplier_name text;
alter table product_comparisons add column if not exists candidate_origin text;
alter table product_comparisons add column if not exists candidate_purchase_url text;
alter table product_comparisons add column if not exists candidate_price numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists candidate_original_price numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists candidate_currency text not null default 'JPY';
alter table product_comparisons add column if not exists exchange_rate numeric(12, 6) not null default 1;
alter table product_comparisons add column if not exists candidate_quantity numeric(12, 3) not null default 1;
alter table product_comparisons add column if not exists candidate_unit text not null default 'g';
alter table product_comparisons add column if not exists candidate_weight_kg numeric(12, 3) not null default 0;
alter table product_comparisons add column if not exists import_quantity numeric(12, 3) not null default 1;
alter table product_comparisons add column if not exists freight_rate_per_kg numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists freight_rate_original_per_kg numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists base_price numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists base_quantity numeric(12, 3) not null default 1;
alter table product_comparisons add column if not exists base_unit text not null default 'g';
alter table product_comparisons add column if not exists is_imported boolean not null default false;
alter table product_comparisons add column if not exists freight_cost numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists tax_cost numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists other_cost numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists photo_url text;
alter table product_comparisons add column if not exists note text;
alter table product_comparisons add column if not exists created_by uuid references employees(id);
alter table product_comparisons add column if not exists archived_at timestamptz;

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  store_id uuid not null references stores(id),
  brand_id uuid references brands(id),
  requested_by uuid references employees(id),
  assigned_to uuid references employees(id),
  deadline_label text,
  deadline_at timestamptz,
  requested_item_count integer not null default 0,
  priority text not null default 'medium',
  status text not null default 'submitted',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid references products(id),
  brand_id uuid references brands(id),
  temporary_product_name text not null default '',
  temporary_product_unit text not null default '個',
  requested_quantity numeric(12, 2) not null,
  requested_unit text not null,
  note text,
  status text not null default 'requested'
);

alter table purchase_order_items alter column product_id drop not null;
alter table purchase_order_items add column if not exists brand_id uuid references brands(id);
alter table purchase_order_items add column if not exists temporary_product_name text not null default '';
alter table purchase_order_items add column if not exists temporary_product_unit text not null default '個';
alter table purchase_order_items add column if not exists actual_quantity numeric(12, 2);
alter table purchase_order_items add column if not exists actual_price numeric(12, 2);
alter table purchase_order_items add column if not exists procurement_note text;
alter table purchase_order_items add column if not exists price_exception_note text;
alter table purchase_order_items add column if not exists selected_supplier_id uuid references suppliers(id);
alter table purchase_order_items add column if not exists store_feedback_confirmed_at timestamptz;
alter table purchase_order_items add column if not exists store_feedback_confirmed_by uuid references employees(id);
alter table purchase_order_items drop column if exists receipt_photo_url;

alter table purchase_orders add column if not exists requested_by uuid references employees(id);
alter table purchase_orders add column if not exists assigned_to uuid references employees(id);
alter table purchase_orders drop column if exists expected_arrival_date;
alter table purchase_orders drop column if exists online_order_status;
alter table suppliers add column if not exists address text;
alter table suppliers add column if not exists phone text;
alter table suppliers add column if not exists contact_person text;
alter table suppliers add column if not exists business_hours text;
alter table suppliers add column if not exists business_hours_settings jsonb not null default '{}'::jsonb;
alter table suppliers add column if not exists order_url text;
alter table supplier_locations add column if not exists phone text;
alter table supplier_locations add column if not exists opening_hours_settings jsonb not null default '{}'::jsonb;

create table if not exists procurement_staff_unavailable_slots (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  unavailable_date date not null,
  slot text not null check (slot in ('morning', 'afternoon', 'evening')),
  note text not null default '',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, unavailable_date, slot)
);

create table if not exists purchase_order_supplier_fulfillments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text not null,
  expected_arrival_date date,
  online_order_status text not null default 'not_started',
  receipt_photo_url text,
  supplier_location_id uuid references supplier_locations(id) on delete set null,
  receipt_confirmed_at timestamptz,
  receipt_confirmed_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, supplier_name)
);

alter table purchase_order_supplier_fulfillments add column if not exists supplier_id uuid references suppliers(id) on delete set null;
alter table purchase_order_supplier_fulfillments add column if not exists supplier_name text not null default '';
alter table purchase_order_supplier_fulfillments add column if not exists expected_arrival_date date;
alter table purchase_order_supplier_fulfillments add column if not exists online_order_status text not null default 'not_started';
alter table purchase_order_supplier_fulfillments add column if not exists receipt_photo_url text;
alter table purchase_order_supplier_fulfillments add column if not exists supplier_location_id uuid references supplier_locations(id) on delete set null;
alter table purchase_order_supplier_fulfillments add column if not exists receipt_confirmed_at timestamptz;
alter table purchase_order_supplier_fulfillments add column if not exists receipt_confirmed_by uuid references employees(id);

create table if not exists os_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_employee_id uuid not null references employees(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  href text,
  lark_sent_at timestamptz,
  lark_error text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table os_notifications add column if not exists lark_sent_at timestamptz;
alter table os_notifications add column if not exists lark_error text;

create table if not exists external_service_usage_events (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  metric_key text not null,
  quantity numeric(14, 3) not null default 1,
  unit text not null default 'count',
  source text not null default 'app',
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

create table if not exists external_service_alert_rules (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  metric_key text not null,
  limit_value numeric(14, 3) not null,
  warn_ratio numeric(5, 3) not null default 0.7,
  critical_ratio numeric(5, 3) not null default 0.85,
  is_enabled boolean not null default true,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service_key, metric_key)
);

create table if not exists external_service_alert_events (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  metric_key text not null,
  period_key text not null,
  alert_level text not null,
  usage_value numeric(14, 3) not null,
  limit_value numeric(14, 3) not null,
  notification_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique(service_key, metric_key, period_key, alert_level)
);

create table if not exists web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_success_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_actuals (
  id uuid primary key default gen_random_uuid(),
  purchase_order_item_id uuid not null references purchase_order_items(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  supplier_location_id uuid references supplier_locations(id),
  actual_quantity numeric(12, 2),
  actual_unit text,
  actual_price numeric(12, 2),
  price_is_exception boolean not null default false,
  note text,
  recorded_by uuid references employees(id),
  recorded_at timestamptz not null default now()
);

alter table purchase_actuals add column if not exists actual_price numeric(12, 2);
alter table purchase_actuals add column if not exists supplier_location_id uuid references supplier_locations(id);
alter table purchase_actuals drop column if exists receipt_photo_url;

create table if not exists delivery_batches (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  batch_no integer not null,
  status text not null default 'in_delivery',
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  store_confirmed_at timestamptz,
  store_confirmed_by uuid references employees(id),
  unique (purchase_order_id, batch_no)
);

alter table delivery_batches add column if not exists store_confirmed_at timestamptz;
alter table delivery_batches add column if not exists store_confirmed_by uuid references employees(id);
alter table delivery_batches add column if not exists delivered_at timestamptz;

create table if not exists delivery_batch_items (
  delivery_batch_id uuid not null references delivery_batches(id) on delete cascade,
  purchase_order_item_id uuid not null references purchase_order_items(id) on delete cascade,
  primary key (delivery_batch_id, purchase_order_item_id),
  unique (purchase_order_item_id)
);

create table if not exists purchase_exceptions (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  purchase_order_item_id uuid references purchase_order_items(id) on delete cascade,
  exception_type text not null,
  message text not null,
  resolution_note text,
  needs_store_confirmation boolean not null default false,
  affects_operation boolean not null default false,
  follow_up_at timestamptz,
  status text not null default 'open',
  resolved_by uuid references employees(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table purchase_exceptions add column if not exists resolved_by uuid references employees(id);
alter table purchase_exceptions add column if not exists resolved_at timestamptz;

create table if not exists price_records (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  supplier_location_id uuid references supplier_locations(id),
  price numeric(12, 2) not null,
  unit text not null,
  source text not null default 'manual',
  receipt_note text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references employees(id)
);

create table if not exists receipt_ocr_results (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid,
  store_id uuid references stores(id) on delete set null,
  supplier_name text not null default '',
  receipt_photo_url text not null default '',
  uploaded_file_name text not null default '',
  usage_type text not null default 'unclassified',
  payment_type text not null default 'company',
  reimbursement_status text not null default 'none',
  status text not null default 'draft',
  model text not null default '',
  raw_result jsonb not null default '{}'::jsonb,
  vendor_name text not null default '',
  company_name text not null default '',
  brand_name text not null default '',
  location_name text not null default '',
  purchase_date date,
  purchase_time time,
  subtotal numeric(12, 2),
  tax numeric(12, 2),
  total numeric(12, 2),
  error_message text not null default '',
  confirmed_at timestamptz,
  confirmed_by uuid references employees(id) on delete set null,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table receipt_ocr_results add column if not exists source_type text not null default 'unknown';
alter table receipt_ocr_results add column if not exists source_id uuid;
alter table receipt_ocr_results add column if not exists store_id uuid references stores(id) on delete set null;
alter table receipt_ocr_results add column if not exists supplier_name text not null default '';
alter table receipt_ocr_results add column if not exists receipt_photo_url text not null default '';
alter table receipt_ocr_results add column if not exists uploaded_file_name text not null default '';
alter table receipt_ocr_results add column if not exists usage_type text not null default 'unclassified';
alter table receipt_ocr_results add column if not exists payment_type text not null default 'company';
alter table receipt_ocr_results add column if not exists reimbursement_status text not null default 'none';
alter table receipt_ocr_results add column if not exists status text not null default 'draft';
alter table receipt_ocr_results add column if not exists model text not null default '';
alter table receipt_ocr_results add column if not exists raw_result jsonb not null default '{}'::jsonb;
alter table receipt_ocr_results add column if not exists vendor_name text not null default '';
alter table receipt_ocr_results add column if not exists company_name text not null default '';
alter table receipt_ocr_results add column if not exists brand_name text not null default '';
alter table receipt_ocr_results add column if not exists location_name text not null default '';
alter table receipt_ocr_results add column if not exists supplier_id uuid references suppliers(id) on delete set null;
alter table receipt_ocr_results add column if not exists supplier_location_id uuid references supplier_locations(id) on delete set null;
alter table receipt_ocr_results add column if not exists supplier_match_status text not null default 'unmatched';
alter table receipt_ocr_results add column if not exists purchase_date date;
alter table receipt_ocr_results add column if not exists purchase_time time;
alter table receipt_ocr_results add column if not exists subtotal numeric(12, 2);
alter table receipt_ocr_results add column if not exists tax numeric(12, 2);
alter table receipt_ocr_results add column if not exists total numeric(12, 2);
alter table receipt_ocr_results add column if not exists error_message text not null default '';
alter table receipt_ocr_results add column if not exists confirmed_at timestamptz;
alter table receipt_ocr_results add column if not exists confirmed_by uuid references employees(id) on delete set null;
alter table receipt_ocr_results add column if not exists created_by uuid references employees(id) on delete set null;
create index if not exists receipt_ocr_results_source_idx on receipt_ocr_results (source_type, source_id);
create index if not exists receipt_ocr_results_store_date_idx on receipt_ocr_results (store_id, purchase_date desc);
create index if not exists receipt_ocr_results_usage_idx on receipt_ocr_results (usage_type, payment_type, status, created_at desc);
create index if not exists receipt_ocr_results_supplier_idx on receipt_ocr_results (supplier_id, supplier_location_id, supplier_match_status);

create table if not exists receipt_ocr_items (
  id uuid primary key default gen_random_uuid(),
  receipt_ocr_result_id uuid not null references receipt_ocr_results(id) on delete cascade,
  line_index integer not null default 0,
  raw_name text not null default '',
  normalized_name text not null default '',
  quantity numeric(12, 3),
  unit text not null default '',
  unit_price numeric(12, 2),
  tax_rate text not null default '',
  tax_mode text not null default '',
  category text not null default '',
  account_title text not null default '',
  amount numeric(12, 2),
  matched_product_id uuid references products(id) on delete set null,
  match_status text not null default 'unmatched',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table receipt_ocr_items add column if not exists normalized_name text not null default '';
alter table receipt_ocr_items add column if not exists quantity numeric(12, 3);
alter table receipt_ocr_items add column if not exists unit text not null default '';
alter table receipt_ocr_items add column if not exists unit_price numeric(12, 2);
alter table receipt_ocr_items add column if not exists tax_rate text not null default '';
alter table receipt_ocr_items add column if not exists tax_mode text not null default '';
alter table receipt_ocr_items add column if not exists category text not null default '';
alter table receipt_ocr_items add column if not exists account_title text not null default '';
alter table receipt_ocr_items add column if not exists amount numeric(12, 2);
alter table receipt_ocr_items add column if not exists matched_product_id uuid references products(id) on delete set null;
alter table receipt_ocr_items add column if not exists match_status text not null default 'unmatched';
alter table receipt_ocr_items add column if not exists purchase_actual_id uuid references purchase_actuals(id) on delete set null;
alter table receipt_ocr_items add column if not exists reconciliation_status text not null default 'unmatched';
alter table receipt_ocr_items add column if not exists reconciliation_note text not null default '';
create index if not exists receipt_ocr_items_result_idx on receipt_ocr_items (receipt_ocr_result_id);
create index if not exists receipt_ocr_items_match_idx on receipt_ocr_items (match_status, normalized_name);
create index if not exists receipt_ocr_items_purchase_actual_idx on receipt_ocr_items (purchase_actual_id, reconciliation_status);

create table if not exists product_match_dictionary (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null default '',
  raw_name text not null,
  normalized_name text not null,
  product_id uuid not null references products(id) on delete cascade,
  category text not null default '',
  unit text not null default '',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_name, normalized_name)
);

create table if not exists product_candidates (
  id uuid primary key default gen_random_uuid(),
  receipt_ocr_item_id uuid references receipt_ocr_items(id) on delete set null,
  raw_name text not null,
  normalized_name text not null,
  suggested_name text not null,
  category text not null default '未分類',
  subcategory text not null default '未分類',
  unit text not null default '個',
  reference_price numeric(12, 2),
  supplier_name text not null default '',
  status text not null default 'pending',
  product_id uuid references products(id) on delete set null,
  reviewed_by uuid references employees(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name, supplier_name, status)
);

create index if not exists product_candidates_status_idx on product_candidates (status, created_at desc);

create table if not exists procedure_books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default '未分類',
  summary text,
  status text not null default 'draft',
  brand_id uuid references brands(id) on delete set null,
  version_number integer not null default 1,
  published_at timestamptz,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table procedure_books add column if not exists category text not null default '未分類';
alter table procedure_books add column if not exists summary text;
alter table procedure_books add column if not exists status text not null default 'draft';
alter table procedure_books add column if not exists brand_id uuid references brands(id) on delete set null;
alter table procedure_books add column if not exists version_number integer not null default 1;
alter table procedure_books add column if not exists published_at timestamptz;
alter table procedure_books add column if not exists created_by uuid references employees(id) on delete set null;

create table if not exists menu_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  name text not null,
  source_type text not null default 'manual',
  source_url text,
  status text not null default 'active',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  external_id text,
  name text not null,
  note text not null default '',
  is_tapioca_free boolean not null default false,
  has_whip_by_default boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, store_id, name)
);

create table if not exists menu_catalog_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  menu_source_id uuid references menu_sources(id) on delete set null,
  external_id text,
  item_kind text not null default 'fixed_product',
  name text not null,
  display_names jsonb not null default '{}'::jsonb,
  category text,
  description text,
  description_display_names jsonb not null default '{}'::jsonb,
  image_url text,
  base_price numeric(12, 2),
  variable_schema jsonb not null default '{}'::jsonb,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, store_id, item_kind, name)
);

create table if not exists menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  menu_catalog_item_id uuid references menu_catalog_items(id) on delete cascade,
  external_id text,
  group_key text not null,
  name text not null,
  display_names jsonb not null default '{}'::jsonb,
  selection_type text not null default 'single',
  affects_procedure boolean not null default true,
  rule_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, menu_catalog_item_id, group_key)
);

create table if not exists menu_options (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references menu_option_groups(id) on delete cascade,
  external_id text,
  option_key text not null,
  name text not null,
  display_names jsonb not null default '{}'::jsonb,
  price_delta numeric(12, 2),
  affects_procedure boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (option_group_id, option_key)
);

alter table menu_catalog_items add column if not exists display_names jsonb not null default '{}'::jsonb;
alter table menu_catalog_items add column if not exists description_display_names jsonb not null default '{}'::jsonb;
alter table menu_option_groups add column if not exists display_names jsonb not null default '{}'::jsonb;
alter table menu_options add column if not exists display_names jsonb not null default '{}'::jsonb;

create table if not exists store_operations (
  store_id uuid primary key references stores(id) on delete cascade,
  reservations_enabled boolean not null default true,
  minimum_pickup_minutes integer,
  minimum_pickup_reset_at timestamptz,
  status_note text not null default '',
  temporary_status_until timestamptz,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table store_operations add column if not exists temporary_status_until timestamptz;
alter table store_operations add column if not exists minimum_pickup_minutes integer;
alter table store_operations add column if not exists minimum_pickup_reset_at timestamptz;

create table if not exists store_temporary_closures (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  public_message text not null default '',
  status text not null default 'active',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_store_temporary_closures_store_time
  on store_temporary_closures(store_id, status, starts_at, ends_at);

create table if not exists pos_store_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  dine_in_enabled boolean not null default true,
  takeout_enabled boolean not null default true,
  dine_in_tax_rate numeric(5, 2) not null default 10,
  takeout_tax_rate numeric(5, 2) not null default 8,
  external_payment_terminal_brand text not null default 'PayCAS',
  price_tax_mode text not null default 'tax_included',
  discount_presets jsonb not null default '[]'::jsonb,
  customer_display_media_settings jsonb not null default '{}'::jsonb,
  printer_settings jsonb not null default '{}'::jsonb,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pos_store_settings add column if not exists dine_in_enabled boolean not null default true;
alter table pos_store_settings add column if not exists takeout_enabled boolean not null default true;
alter table pos_store_settings add column if not exists external_payment_terminal_brand text not null default 'PayCAS';
alter table pos_store_settings add column if not exists discount_presets jsonb not null default '[]'::jsonb;
alter table pos_store_settings add column if not exists customer_display_media_settings jsonb not null default '{}'::jsonb;
alter table pos_store_settings add column if not exists printer_settings jsonb not null default '{}'::jsonb;

create table if not exists pos_customer_display_states (
  store_id uuid primary key references stores(id) on delete cascade,
  display_state jsonb not null default '{}'::jsonb,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists store_tables (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  label text not null,
  display_name text not null default '',
  area_name text not null default '',
  seat_count integer not null default 0,
  qr_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'active',
  table_ordering_enabled boolean not null default true,
  checkout_exit_policy text not null default 'show_staff_screen_required',
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, label)
);

alter table store_tables add column if not exists brand_id uuid references brands(id) on delete set null;
alter table store_tables add column if not exists display_name text not null default '';
alter table store_tables add column if not exists area_name text not null default '';
alter table store_tables add column if not exists seat_count integer not null default 0;
alter table store_tables add column if not exists table_ordering_enabled boolean not null default true;
alter table store_tables add column if not exists checkout_exit_policy text not null default 'show_staff_screen_required';
alter table store_tables add column if not exists sort_order integer not null default 100;
alter table store_tables add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table store_tables add column if not exists created_by uuid references employees(id) on delete set null;
alter table store_tables add column if not exists updated_by uuid references employees(id) on delete set null;

create table if not exists menu_store_settings (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  menu_catalog_item_id uuid not null references menu_catalog_items(id) on delete cascade,
  website_enabled boolean not null default true,
  pos_enabled boolean not null default true,
  table_order_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  is_available boolean not null default true,
  price_override numeric(12, 2),
  status_note text not null default '',
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, menu_catalog_item_id)
);

alter table menu_store_settings add column if not exists table_order_enabled boolean not null default true;

create table if not exists menu_option_store_settings (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  menu_option_id uuid not null references menu_options(id) on delete cascade,
  is_available boolean not null default true,
  status_note text not null default '',
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, menu_option_id)
);

create table if not exists menu_external_platforms (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  platform_key text not null,
  name text not null,
  management_url text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, store_id, platform_key)
);

create table if not exists menu_change_sync_tasks (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  external_platform_id uuid not null references menu_external_platforms(id) on delete cascade,
  target_type text not null,
  target_id uuid,
  target_label text not null,
  change_kind text not null,
  change_summary text not null,
  status text not null default 'pending',
  created_by uuid references employees(id) on delete set null,
  completed_by uuid references employees(id) on delete set null,
  completion_note text not null default '',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists store_customer_orders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id) on delete set null,
  store_id uuid references stores(id) on delete set null,
  order_source text not null default 'nanacha_web',
  pickup_code text not null,
  status text not null default 'pending_payment',
  payment_status text not null default 'pending',
  payment_provider text not null default 'square',
  payment_account_id uuid references store_payment_accounts(id) on delete set null,
  payment_session_id text,
  payment_id text,
  payment_receipt_url text,
  payment_updated_at timestamptz,
  payment_refund_id text,
  payment_refund_status text not null default '',
  payment_refund_error text not null default '',
  payment_refunded_at timestamptz,
  receipt_download_count integer not null default 0,
  receipt_last_downloaded_at timestamptz,
  square_order_id text,
  square_payment_id text,
  square_receipt_url text,
  square_payment_updated_at timestamptz,
  pickup_date date not null,
  pickup_time text not null,
  amount integer not null default 0,
  currency text not null default 'JPY',
  customer_summary jsonb not null default '{}'::jsonb,
  drink text not null default '',
  size text not null default '',
  temperature text not null default '',
  sweetness text not null default '',
  ice text not null default '',
  option_text text not null default '',
  toppings text not null default '',
  paid_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table store_customer_orders add column if not exists preparing_at timestamptz;
alter table store_customer_orders add column if not exists ready_at timestamptz;
alter table store_customer_orders add column if not exists completed_at timestamptz;
alter table store_customer_orders add column if not exists cancelled_at timestamptz;
alter table store_customer_orders add column if not exists payment_provider text not null default 'square';
alter table store_customer_orders add column if not exists payment_account_id uuid references store_payment_accounts(id) on delete set null;
alter table store_customer_orders add column if not exists payment_session_id text;
alter table store_customer_orders add column if not exists payment_id text;
alter table store_customer_orders add column if not exists payment_receipt_url text;
alter table store_customer_orders add column if not exists payment_updated_at timestamptz;
alter table store_customer_orders add column if not exists payment_refund_id text;
alter table store_customer_orders add column if not exists payment_refund_status text not null default '';
alter table store_customer_orders add column if not exists payment_refund_error text not null default '';
alter table store_customer_orders add column if not exists payment_refunded_at timestamptz;
alter table store_customer_orders add column if not exists receipt_download_count integer not null default 0;
alter table store_customer_orders add column if not exists receipt_last_downloaded_at timestamptz;
alter table store_customer_orders add column if not exists store_table_id uuid references store_tables(id) on delete set null;
alter table store_customer_orders add column if not exists table_session_key text not null default '';

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  member_number text not null unique default ('M' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  public_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  display_name text not null default '',
  name_kana text not null default '',
  phone text not null default '',
  email text not null default '',
  birthday date,
  preferred_language text not null default 'ja',
  status text not null default 'active',
  note text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_members_phone_unique
  on members(phone)
  where phone <> '';

create unique index if not exists idx_members_email_unique
  on members(lower(email))
  where email <> '';

create index if not exists idx_members_status_created_at
  on members(status, created_at desc);

create table if not exists member_identity_links (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  identity_provider text not null,
  identity_subject text not null,
  identity_label text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(identity_provider, identity_subject)
);

create index if not exists idx_member_identity_links_member
  on member_identity_links(member_id);

create table if not exists member_brand_links (
  member_id uuid not null references members(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  first_store_id uuid references stores(id) on delete set null,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (member_id, brand_id)
);

create table if not exists member_accounts (
  member_id uuid primary key references members(id) on delete cascade,
  point_balance integer not null default 0,
  lifetime_points_earned integer not null default 0,
  lifetime_points_redeemed integer not null default 0,
  lifetime_spend_amount integer not null default 0,
  lifetime_visit_count integer not null default 0,
  last_purchase_at timestamptz,
  current_tier_key text not null default 'regular',
  updated_at timestamptz not null default now()
);

create table if not exists loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  tier_key text not null unique,
  name text not null,
  rank integer not null default 0,
  evaluation_window_days integer not null default 180,
  required_spend_amount integer not null default 0,
  required_visit_count integer not null default 0,
  point_multiplier numeric(6, 3) not null default 1,
  benefits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into loyalty_tiers (tier_key, name, rank, evaluation_window_days, required_spend_amount, required_visit_count, point_multiplier, benefits)
values
  ('regular', 'Regular', 10, 180, 0, 0, 1, '{"description":"100円で1ポイント"}'::jsonb),
  ('gold', 'Gold', 20, 180, 20000, 20, 1, '{"description":"誕生日券・会員限定キャンペーン対象"}'::jsonb),
  ('vip', 'VIP', 30, 180, 50000, 45, 1, '{"description":"特定日のポイント倍率・専用クーポン対象"}'::jsonb)
on conflict (tier_key) do nothing;

create table if not exists loyalty_reward_settings (
  scope_key text primary key default 'global',
  base_point_rate_basis integer not null default 100,
  birthday_coupon_enabled boolean not null default true,
  birthday_coupon_name text not null default '誕生日特典 500円OFF',
  birthday_coupon_discount_type text not null default 'amount',
  birthday_coupon_discount_value integer not null default 500,
  birthday_coupon_max_discount_amount integer,
  birthday_coupon_expires_in_days integer not null default 45,
  dormant_coupon_enabled boolean not null default true,
  dormant_days integer not null default 45,
  dormant_coupon_name text not null default 'お久しぶり 300円OFF',
  dormant_coupon_discount_type text not null default 'amount',
  dormant_coupon_discount_value integer not null default 300,
  dormant_coupon_max_discount_amount integer,
  dormant_coupon_expires_in_days integer not null default 30,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table loyalty_reward_settings add column if not exists base_point_rate_basis integer not null default 100;
alter table loyalty_reward_settings add column if not exists birthday_coupon_enabled boolean not null default true;
alter table loyalty_reward_settings add column if not exists birthday_coupon_name text not null default '誕生日特典 500円OFF';
alter table loyalty_reward_settings add column if not exists birthday_coupon_discount_type text not null default 'amount';
alter table loyalty_reward_settings add column if not exists birthday_coupon_discount_value integer not null default 500;
alter table loyalty_reward_settings add column if not exists birthday_coupon_max_discount_amount integer;
alter table loyalty_reward_settings add column if not exists birthday_coupon_expires_in_days integer not null default 45;
alter table loyalty_reward_settings add column if not exists dormant_coupon_enabled boolean not null default true;
alter table loyalty_reward_settings add column if not exists dormant_days integer not null default 45;
alter table loyalty_reward_settings add column if not exists dormant_coupon_name text not null default 'お久しぶり 300円OFF';
alter table loyalty_reward_settings add column if not exists dormant_coupon_discount_type text not null default 'amount';
alter table loyalty_reward_settings add column if not exists dormant_coupon_discount_value integer not null default 300;
alter table loyalty_reward_settings add column if not exists dormant_coupon_max_discount_amount integer;
alter table loyalty_reward_settings add column if not exists dormant_coupon_expires_in_days integer not null default 30;
alter table loyalty_reward_settings add column if not exists updated_by uuid references employees(id) on delete set null;

insert into loyalty_reward_settings (scope_key)
values ('global')
on conflict (scope_key) do nothing;

create table if not exists email_notification_templates (
  template_key text primary key,
  category text not null default 'member',
  name text not null,
  description text not null default '',
  subject text not null,
  body text not null,
  is_enabled boolean not null default true,
  require_opt_in boolean not null default true,
  send_rule jsonb not null default '{}'::jsonb,
  variables jsonb not null default '[]'::jsonb,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into email_notification_templates (
  template_key,
  category,
  name,
  description,
  subject,
  body,
  is_enabled,
  require_opt_in,
  send_rule,
  variables
) values
  (
    'order_confirmed',
    'order',
    '注文受付通知',
    '顧客がオンライン注文または予約注文を完了した後に送信します。',
    '【{{brandName}}】ご注文を受け付けました',
    '{{memberName}} 様\n\nご注文ありがとうございます。以下の内容でご注文を受け付けました。\n\n注文番号: {{orderNumber}}\n店舗: {{storeName}}\n受取予定: {{pickupTime}}\n合計金額: {{orderTotal}}\n\nご来店をお待ちしております。\n\n注文状況はこちら:\n{{orderUrl}}',
    true,
    false,
    '{"trigger":"order_paid"}'::jsonb,
    '["brandName","memberName","orderNumber","storeName","pickupTime","orderTotal","orderUrl"]'::jsonb
  ),
  (
    'order_refunded',
    'order',
    '返金完了通知',
    '注文をキャンセルし、返金が完了した後に送信します。',
    '【{{brandName}}】ご注文の返金が完了しました',
    '{{memberName}} 様\n\nご注文 {{orderNumber}} の返金が完了しました。\n\n返金金額: {{refundAmount}}\n返金日時: {{refundTime}}\n\nカード会社・決済サービス側の処理状況により、明細への反映まで数日かかる場合があります。\n\nご不明点がありましたら店舗までお問い合わせください。',
    true,
    false,
    '{"trigger":"payment_refunded"}'::jsonb,
    '["brandName","memberName","orderNumber","refundAmount","refundTime"]'::jsonb
  ),
  (
    'reservation_reminder',
    'reservation',
    '予約リマインダー',
    '予約時間または受け取り時間の前にリマインダーを送信します。',
    '【{{brandName}}】ご予約時間が近づいています',
    '{{memberName}} 様\n\nご予約時間が近づいています。\n\n店舗: {{storeName}}\n予約日時: {{reservationTime}}\n注文番号: {{orderNumber}}\n\n変更やキャンセルが必要な場合は、お早めに店舗までご連絡ください。\n\n詳細はこちら:\n{{orderUrl}}',
    true,
    false,
    '{"trigger":"reservation_reminder","minutesBefore":60}'::jsonb,
    '["brandName","memberName","storeName","reservationTime","orderNumber","orderUrl"]'::jsonb
  ),
  (
    'coupon_general',
    'member',
    'クーポン通知',
    '手動発行や再送時のクーポン通知に使用します。',
    '【{{brandName}}】クーポンをお届けしました',
    '{{memberName}} 様\n\nFoundr1 Members にクーポンをお届けしました。\n\nクーポン: {{couponName}}\nクーポンコード: {{couponCode}}\n有効期限: {{expiresAt}}\n\n会員ページはこちら:\n{{memberUrl}}',
    true,
    true,
    '{"trigger":"coupon_issued"}'::jsonb,
    '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
  ),
  (
    'coupon_birthday',
    'member',
    '誕生日クーポン通知',
    '毎月、誕生日月の会員へクーポンを一括発行した後に送信します。',
    '【{{brandName}}】お誕生日特典クーポンをお届けしました',
    '{{memberName}} 様\n\nお誕生日月おめでとうございます。Foundr1 Members に誕生日特典クーポンをお届けしました。\n\nクーポン: {{couponName}}\nクーポンコード: {{couponCode}}\n有効期限: {{expiresAt}}\n\n会員ページはこちら:\n{{memberUrl}}',
    true,
    true,
    '{"trigger":"monthly_birthday_coupon","dayOfMonth":1,"hour":10,"timezone":"Asia/Tokyo"}'::jsonb,
    '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
  ),
  (
    'member_signup',
    'member',
    '会員登録完了通知',
    '会員が初回登録またはアカウント連携を完了した後に送信します。',
    '【{{brandName}}】会員登録ありがとうございます',
    '{{memberName}} 様\n\nFoundr1 Members へのご登録ありがとうございます。\n\n会員番号: {{memberNumber}}\n現在のポイント: {{pointBalance}} pt\n\n会員ページはこちら:\n{{memberUrl}}',
    true,
    true,
    '{"trigger":"member_signup"}'::jsonb,
    '["brandName","memberName","memberNumber","pointBalance","memberUrl"]'::jsonb
  ),
  (
    'dormant_reactivation_coupon',
    'member',
    '再来店促進クーポン通知',
    '長期間購入がない会員へ再来店促進クーポンを発行した後に送信します。',
    '【{{brandName}}】お久しぶり特典をお届けしました',
    '{{memberName}} 様\n\nまたのご利用をお待ちして、特典クーポンをお届けしました。\n\nクーポン: {{couponName}}\nクーポンコード: {{couponCode}}\n有効期限: {{expiresAt}}\n\n会員ページはこちら:\n{{memberUrl}}',
    true,
    true,
    '{"trigger":"dormant_coupon_issued"}'::jsonb,
    '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
  ),
  (
    'coupon_expiring_soon',
    'member',
    'クーポン期限前通知',
    'クーポンの有効期限前に利用を促す通知を送信します。',
    '【{{brandName}}】クーポンの有効期限が近づいています',
    '{{memberName}} 様\n\nお持ちのクーポンの有効期限が近づいています。\n\nクーポン: {{couponName}}\nクーポンコード: {{couponCode}}\n有効期限: {{expiresAt}}\n\n会員ページはこちら:\n{{memberUrl}}',
    false,
    true,
    '{"trigger":"coupon_expiring_soon","daysBefore":3,"hour":10,"timezone":"Asia/Tokyo"}'::jsonb,
    '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
  ),
  (
    'pickup_ready',
    'order',
    '受け取り準備完了通知',
    'キッチンまたは作業画面で商品準備完了にした後に送信します。',
    '【{{brandName}}】ご注文商品の準備ができました',
    '{{memberName}} 様\n\nご注文商品の準備ができました。\n\n注文番号: {{orderNumber}}\n店舗: {{storeName}}\n\nご来店の際は注文番号をスタッフにお伝えください。',
    false,
    false,
    '{"trigger":"pickup_ready"}'::jsonb,
    '["brandName","memberName","orderNumber","storeName"]'::jsonb
  ),
  (
    'payment_failed',
    'order',
    '決済失敗通知',
    'オンライン決済に失敗した、または注文が成立しなかった場合に送信します。',
    '【{{brandName}}】お支払いを完了できませんでした',
    '{{memberName}} 様\n\nお支払いを完了できなかったため、ご注文は確定していません。\n\n再度ご注文いただくか、店舗までお問い合わせください。\n\n注文番号: {{orderNumber}}',
    false,
    false,
    '{"trigger":"payment_failed"}'::jsonb,
    '["brandName","memberName","orderNumber"]'::jsonb
  )
on conflict (template_key) do nothing;

update email_notification_templates
set body = replace(body, chr(92) || 'n', chr(10))
where body like '%' || chr(92) || 'n' || '%';

update email_notification_templates
set
  subject = case template_key
    when 'order_confirmed' then '【{{brandName}}】ご注文を受け付けました'
    when 'order_refunded' then '【{{brandName}}】ご注文の返金が完了しました'
    when 'reservation_reminder' then '【{{brandName}}】ご予約時間が近づいています'
    when 'coupon_general' then '【{{brandName}}】クーポンをお届けしました'
    when 'coupon_birthday' then '【{{brandName}}】お誕生日特典クーポンをお届けしました'
    when 'member_signup' then '【{{brandName}}】会員登録ありがとうございます'
    when 'dormant_reactivation_coupon' then '【{{brandName}}】お久しぶり特典をお届けしました'
    when 'coupon_expiring_soon' then '【{{brandName}}】クーポンの有効期限が近づいています'
    when 'pickup_ready' then '【{{brandName}}】ご注文商品の準備ができました'
    when 'payment_failed' then '【{{brandName}}】お支払いを完了できませんでした'
    else subject
  end,
  variables = case template_key
    when 'order_confirmed' then '["brandName","memberName","orderNumber","storeName","pickupTime","orderTotal","orderUrl"]'::jsonb
    when 'order_refunded' then '["brandName","memberName","orderNumber","refundAmount","refundTime"]'::jsonb
    when 'reservation_reminder' then '["brandName","memberName","storeName","reservationTime","orderNumber","orderUrl"]'::jsonb
    when 'coupon_general' then '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
    when 'coupon_birthday' then '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
    when 'member_signup' then '["brandName","memberName","memberNumber","pointBalance","memberUrl"]'::jsonb
    when 'dormant_reactivation_coupon' then '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
    when 'coupon_expiring_soon' then '["brandName","memberName","couponName","couponCode","expiresAt","memberUrl"]'::jsonb
    when 'pickup_ready' then '["brandName","memberName","orderNumber","storeName"]'::jsonb
    when 'payment_failed' then '["brandName","memberName","orderNumber"]'::jsonb
    else variables
  end,
  name = case template_key
    when 'order_confirmed' then '注文受付通知'
    when 'order_refunded' then '返金完了通知'
    when 'reservation_reminder' then '予約リマインダー'
    when 'coupon_general' then 'クーポン通知'
    when 'coupon_birthday' then '誕生日クーポン通知'
    when 'member_signup' then '会員登録完了通知'
    when 'dormant_reactivation_coupon' then '再来店促進クーポン通知'
    when 'coupon_expiring_soon' then 'クーポン期限前通知'
    when 'pickup_ready' then '受け取り準備完了通知'
    when 'payment_failed' then '決済失敗通知'
    else name
  end,
  description = case template_key
    when 'order_confirmed' then '顧客がオンライン注文または予約注文を完了した後に送信します。'
    when 'order_refunded' then '注文をキャンセルし、返金が完了した後に送信します。'
    when 'reservation_reminder' then '予約時間または受け取り時間の前にリマインダーを送信します。'
    when 'coupon_general' then '手動発行や再送時のクーポン通知に使用します。'
    when 'coupon_birthday' then '毎月、誕生日月の会員へクーポンを一括発行した後に送信します。'
    when 'member_signup' then '会員が初回登録またはアカウント連携を完了した後に送信します。'
    when 'dormant_reactivation_coupon' then '長期間購入がない会員へ再来店促進クーポンを発行した後に送信します。'
    when 'coupon_expiring_soon' then 'クーポンの有効期限前に利用を促す通知を送信します。'
    when 'pickup_ready' then 'キッチンまたは作業画面で商品準備完了にした後に送信します。'
    when 'payment_failed' then 'オンライン決済に失敗した、または注文が成立しなかった場合に送信します。'
    else description
  end,
  updated_at = now()
where template_key in (
  'order_confirmed',
  'order_refunded',
  'reservation_reminder',
  'coupon_general',
  'coupon_birthday',
  'member_signup',
  'dormant_reactivation_coupon',
  'coupon_expiring_soon',
  'pickup_ready',
  'payment_failed'
);

create table if not exists loyalty_point_ledger (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  order_id uuid references store_customer_orders(id) on delete set null,
  brand_id uuid references brands(id) on delete set null,
  store_id uuid references stores(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  movement_type text not null,
  points integer not null,
  eligible_amount integer not null default 0,
  point_rate_basis integer not null default 100,
  source text not null default 'system',
  note text not null default '',
  expires_at timestamptz,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_loyalty_point_ledger_order_movement
  on loyalty_point_ledger(order_id, movement_type)
  where order_id is not null and movement_type in ('earn', 'refund_reversal');

create index if not exists idx_loyalty_point_ledger_member_created
  on loyalty_point_ledger(member_id, created_at desc);

create table if not exists loyalty_stamp_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id) on delete cascade,
  campaign_key text not null unique,
  name text not null,
  display_names jsonb not null default '{}'::jsonb,
  earn_rule text not null default 'per_item',
  stamps_required integer not null default 5,
  reward_coupon_name text not null default '',
  reward_coupon_display_names jsonb not null default '{}'::jsonb,
  reward_value_amount integer not null default 0,
  valid_from date,
  valid_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table loyalty_stamp_campaigns add column if not exists display_names jsonb not null default '{}'::jsonb;
alter table loyalty_stamp_campaigns add column if not exists reward_coupon_display_names jsonb not null default '{}'::jsonb;

create table if not exists loyalty_stamp_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references loyalty_stamp_campaigns(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  order_id uuid references store_customer_orders(id) on delete set null,
  brand_id uuid references brands(id) on delete set null,
  store_id uuid references stores(id) on delete set null,
  stamps integer not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_loyalty_stamp_ledger_order_campaign
  on loyalty_stamp_ledger(order_id, campaign_id)
  where order_id is not null;

create index if not exists idx_loyalty_stamp_ledger_member_created
  on loyalty_stamp_ledger(member_id, created_at desc);

create table if not exists member_coupons (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  coupon_code text not null unique default ('C' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  name text not null,
  display_names jsonb not null default '{}'::jsonb,
  discount_type text not null default 'amount',
  discount_value integer not null default 0,
  max_discount_amount integer,
  status text not null default 'available',
  issued_source text not null default 'system',
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  used_order_id uuid references store_customer_orders(id) on delete set null,
  used_store_id uuid references stores(id) on delete set null,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table member_coupons add column if not exists display_names jsonb not null default '{}'::jsonb;

create index if not exists idx_member_coupons_member_status
  on member_coupons(member_id, status, expires_at);

create table if not exists member_app_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  display_titles jsonb not null default '{}'::jsonb,
  display_bodies jsonb not null default '{}'::jsonb,
  kind text not null default 'campaign',
  cta_label text not null default '',
  cta_url text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_member_app_announcements_active
  on member_app_announcements(status, starts_at, ends_at, created_at desc);

insert into loyalty_stamp_campaigns (
  brand_id,
  campaign_key,
  name,
  display_names,
  earn_rule,
  stamps_required,
  reward_coupon_name,
  reward_coupon_display_names,
  reward_value_amount,
  valid_from,
  valid_until,
  is_active,
  updated_at
)
select
  brands.id,
  'nanacha_buy_5_get_1',
  'nanachaスタンプカード',
  '{"en":"nanacha Stamp Card","zh":"nanacha印章卡","zh-Hant":"nanacha印章卡","ko":"nanacha 스탬프 카드","vi":"Thẻ tích dấu nanacha","ne":"nanacha स्ट्याम्प कार्ड"}'::jsonb,
  'per_item',
  5,
  'ドリンク無料券',
  '{"en":"Free drink coupon","zh":"饮品免费券","zh-Hant":"飲品免費券","ko":"음료 무료 쿠폰","vi":"Phiếu đồ uống miễn phí","ne":"निःशुल्क पेय कुपन"}'::jsonb,
  600,
  current_date,
  null,
  true,
  now()
from brands
where lower(brands.name) = lower('nanacha')
on conflict (campaign_key)
do update set
  brand_id = excluded.brand_id,
  name = excluded.name,
  display_names = loyalty_stamp_campaigns.display_names || excluded.display_names,
  earn_rule = excluded.earn_rule,
  stamps_required = excluded.stamps_required,
  reward_coupon_name = excluded.reward_coupon_name,
  reward_coupon_display_names = loyalty_stamp_campaigns.reward_coupon_display_names || excluded.reward_coupon_display_names,
  reward_value_amount = excluded.reward_value_amount,
  valid_until = excluded.valid_until,
  is_active = excluded.is_active,
  updated_at = now();

create table if not exists loyalty_settlement_entries (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid references loyalty_point_ledger(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  order_id uuid references store_customer_orders(id) on delete set null,
  issuing_store_id uuid references stores(id) on delete set null,
  issuing_company_id uuid references companies(id) on delete set null,
  redeeming_store_id uuid references stores(id) on delete set null,
  redeeming_company_id uuid references companies(id) on delete set null,
  settlement_type text not null,
  points integer not null default 0,
  amount integer not null default 0,
  status text not null default 'pending',
  settlement_month date not null default date_trunc('month', now())::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_loyalty_settlement_entries_month
  on loyalty_settlement_entries(settlement_month, status);

alter table store_customer_orders add column if not exists member_id uuid references members(id) on delete set null;
create index if not exists idx_store_customer_orders_member
  on store_customer_orders(member_id, created_at desc);

create table if not exists pos_cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  register_name text not null default 'POS',
  status text not null default 'open',
  opening_amount integer not null default 0,
  opening_cash_breakdown jsonb not null default '{}'::jsonb,
  opening_note text not null default '',
  expected_cash_amount integer not null default 0,
  counted_cash_amount integer,
  counted_cash_breakdown jsonb not null default '{}'::jsonb,
  difference_amount integer,
  closing_note text not null default '',
  source text not null default 'manual',
  device_id text not null default '',
  hardware_result text not null default '',
  opened_by uuid references employees(id) on delete set null,
  closed_by uuid references employees(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pos_cash_sessions add column if not exists opening_cash_breakdown jsonb not null default '{}'::jsonb;
alter table pos_cash_sessions add column if not exists counted_cash_breakdown jsonb not null default '{}'::jsonb;

create table if not exists pos_cash_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pos_cash_sessions(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  movement_type text not null,
  amount integer not null default 0,
  reason text not null default '',
  source text not null default 'manual',
  device_id text not null default '',
  hardware_result text not null default '',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table store_customer_orders add column if not exists pos_cash_session_id uuid references pos_cash_sessions(id) on delete set null;

create table if not exists pos_order_corrections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references store_customer_orders(id) on delete cascade,
  cash_session_id uuid references pos_cash_sessions(id) on delete set null,
  business_date date not null,
  correction_type text not null,
  amount integer not null default 0,
  reason text not null default '',
  before_status text not null default '',
  before_payment_status text not null default '',
  after_status text not null default '',
  after_payment_status text not null default '',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists store_customer_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references store_customer_orders(id) on delete cascade,
  menu_catalog_item_id uuid references menu_catalog_items(id) on delete set null,
  item_name text not null,
  size_key text not null default '',
  size_label text not null default '',
  temperature text not null default '',
  sweetness text not null default '',
  ice text not null default '',
  option_key text not null default '',
  option_label text not null default '',
  topping_keys text[] not null default '{}',
  topping_labels text[] not null default '{}',
  quantity integer not null default 1,
  measured_quantity numeric(12, 3),
  measured_unit text not null default '',
  measured_unit_price numeric(12, 3),
  amount integer not null default 0,
  gross_amount integer not null default 0,
  discount_amount integer not null default 0,
  coupon_discount_amount integer not null default 0,
  paid_amount integer not null default 0,
  coupon_id uuid references member_coupons(id) on delete set null,
  refund_status text not null default '',
  refunded_quantity integer not null default 0,
  refunded_amount integer not null default 0,
  refund_reason text not null default '',
  external_refund_confirmed_at timestamptz,
  refunded_at timestamptz,
  refunded_by uuid references employees(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table store_customer_order_items add column if not exists quantity integer not null default 1;
alter table store_customer_order_items add column if not exists measured_quantity numeric(12, 3);
alter table store_customer_order_items add column if not exists measured_unit text not null default '';
alter table store_customer_order_items add column if not exists measured_unit_price numeric(12, 3);
alter table store_customer_order_items add column if not exists gross_amount integer not null default 0;
alter table store_customer_order_items add column if not exists discount_amount integer not null default 0;
alter table store_customer_order_items add column if not exists coupon_discount_amount integer not null default 0;
alter table store_customer_order_items add column if not exists paid_amount integer not null default 0;
alter table store_customer_order_items add column if not exists coupon_id uuid references member_coupons(id) on delete set null;
alter table store_customer_order_items add column if not exists refund_status text not null default '';
alter table store_customer_order_items add column if not exists refunded_quantity integer not null default 0;
alter table store_customer_order_items add column if not exists refunded_amount integer not null default 0;
alter table store_customer_order_items add column if not exists refund_reason text not null default '';
alter table store_customer_order_items add column if not exists external_refund_confirmed_at timestamptz;
alter table store_customer_order_items add column if not exists refunded_at timestamptz;
alter table store_customer_order_items add column if not exists refunded_by uuid references employees(id) on delete set null;

create table if not exists order_production_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references store_customer_orders(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  production_area text not null default 'general',
  production_area_label text not null default '制作',
  status text not null default 'new',
  print_status text not null default 'pending',
  item_summary text not null default '',
  started_at timestamptz,
  ready_at timestamptz,
  completed_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales_orders (
  id uuid primary key default gen_random_uuid(),
  source_order_id uuid unique,
  source_external_id text,
  brand_id uuid references brands(id) on delete set null,
  store_id uuid references stores(id) on delete set null,
  channel text not null,
  source_platform text not null,
  order_no text not null,
  pickup_code text,
  status text not null default 'pending_payment',
  payment_status text not null default 'pending',
  ordered_at timestamptz not null default now(),
  paid_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  subtotal integer not null default 0,
  discount integer not null default 0,
  tax integer not null default 0,
  service_fee integer not null default 0,
  delivery_fee integer not null default 0,
  total integer not null default 0,
  currency text not null default 'JPY',
  payment_provider text,
  payment_reference text,
  receipt_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sales_orders add column if not exists source_external_id text;

create table if not exists sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders(id) on delete cascade,
  source_item_id uuid unique,
  menu_catalog_item_id uuid references menu_catalog_items(id) on delete set null,
  product_name_snapshot text not null,
  category_snapshot text,
  quantity numeric(12, 3) not null default 1,
  unit_price integer not null default 0,
  option_total integer not null default 0,
  line_total integer not null default 0,
  modifiers_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists sales_import_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete set null,
  sales_source_id uuid,
  source_platform text not null,
  import_month text not null,
  file_name text not null default '',
  raw_row_count integer not null default 0,
  imported_order_count integer not null default 0,
  skipped_row_count integer not null default 0,
  status text not null default 'completed',
  imported_by uuid references employees(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists store_sales_sources (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  source_platform text not null,
  source_label text not null,
  source_type text not null default 'delivery',
  brand_name text not null default '',
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, source_platform, source_label, brand_name)
);

alter table sales_import_batches
  add column if not exists sales_source_id uuid;

create table if not exists sales_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references sales_import_batches(id) on delete cascade,
  source_platform text not null,
  source_external_id text,
  order_no text,
  ordered_at timestamptz,
  row_index integer not null default 0,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table menu_sources add column if not exists store_id uuid references stores(id) on delete cascade;
alter table menu_sources add column if not exists source_url text;
alter table menu_sources add column if not exists status text not null default 'active';
alter table menu_sources add column if not exists last_synced_at timestamptz;
alter table menu_categories add column if not exists external_id text;
alter table menu_categories add column if not exists note text not null default '';
alter table menu_categories add column if not exists is_tapioca_free boolean not null default false;
alter table menu_categories add column if not exists has_whip_by_default boolean not null default false;
alter table menu_catalog_items add column if not exists store_id uuid references stores(id) on delete cascade;
alter table menu_catalog_items add column if not exists menu_source_id uuid references menu_sources(id) on delete set null;
alter table menu_catalog_items add column if not exists external_id text;
alter table menu_catalog_items add column if not exists item_kind text not null default 'fixed_product';
alter table menu_catalog_items add column if not exists category text;
alter table menu_catalog_items add column if not exists description text;
alter table menu_catalog_items add column if not exists description_display_names jsonb not null default '{}'::jsonb;
alter table menu_catalog_items add column if not exists image_url text;
alter table menu_catalog_items add column if not exists base_price numeric(12, 2);
alter table menu_catalog_items add column if not exists variable_schema jsonb not null default '{}'::jsonb;
alter table menu_catalog_items add column if not exists sort_order integer not null default 100;
alter table menu_catalog_items add column if not exists is_active boolean not null default true;
alter table menu_option_groups add column if not exists affects_procedure boolean not null default true;
alter table menu_option_groups add column if not exists rule_json jsonb not null default '{}'::jsonb;
alter table menu_options add column if not exists affects_procedure boolean not null default true;

alter table procedure_books add column if not exists procedure_type text not null default 'product';
alter table procedure_books add column if not exists menu_catalog_item_id uuid references menu_catalog_items(id) on delete set null;

create table if not exists procedure_book_stores (
  procedure_book_id uuid not null references procedure_books(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  primary key (procedure_book_id, store_id)
);

create table if not exists procedure_steps (
  id uuid primary key default gen_random_uuid(),
  procedure_book_id uuid not null references procedure_books(id) on delete cascade,
  sort_order integer not null default 0,
  title text not null,
  instruction text not null default '',
  caution text,
  estimated_minutes integer,
  media_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table procedure_steps add column if not exists caution text;
alter table procedure_steps add column if not exists estimated_minutes integer;
alter table procedure_steps add column if not exists media_url text;

create table if not exists procedure_step_products (
  id uuid primary key default gen_random_uuid(),
  procedure_step_id uuid not null references procedure_steps(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  quantity numeric(12, 3),
  unit text,
  note text,
  sort_order integer not null default 0
);

create table if not exists procedure_action_types (
  id uuid primary key default gen_random_uuid(),
  action_key text not null unique,
  label text not null,
  field_config jsonb not null default '{}'::jsonb,
  sentence_template text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists procedure_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists procedure_equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists procedure_containers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists procedure_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  material_type text not null default 'utility',
  category text,
  subcategory text,
  unit text,
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table procedure_materials add column if not exists material_type text not null default 'utility';
alter table procedure_materials add column if not exists category text;
alter table procedure_materials add column if not exists subcategory text;
alter table procedure_materials add column if not exists unit text;
alter table procedure_materials add column if not exists note text;
alter table procedure_materials add column if not exists is_active boolean not null default true;
alter table procedure_materials add column if not exists sort_order integer not null default 0;
alter table procedure_materials add column if not exists updated_at timestamptz not null default now();

create table if not exists procedure_variants (
  id uuid primary key default gen_random_uuid(),
  procedure_book_id uuid not null references procedure_books(id) on delete cascade,
  variant_type text not null,
  name text not null,
  condition_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  unique (procedure_book_id, variant_type)
);

alter table procedure_variants add column if not exists condition_json jsonb not null default '{}'::jsonb;

create table if not exists procedure_step_actions (
  id uuid primary key default gen_random_uuid(),
  procedure_step_id uuid not null references procedure_steps(id) on delete cascade,
  procedure_variant_id uuid references procedure_variants(id) on delete cascade,
  action_type_id uuid references procedure_action_types(id) on delete set null,
  product_id uuid references products(id) on delete restrict,
  material_id uuid references procedure_materials(id) on delete restrict,
  equipment_product_id uuid references products(id) on delete restrict,
  container_product_id uuid references products(id) on delete restrict,
  location_id uuid references procedure_locations(id) on delete set null,
  equipment_id uuid references procedure_equipment(id) on delete set null,
  container_id uuid references procedure_containers(id) on delete set null,
  quantity numeric(12, 3),
  unit text,
  target_text text,
  standard_text text,
  condition_json jsonb not null default '{}'::jsonb,
  note text,
  sort_order integer not null default 0
);

alter table procedure_step_actions add column if not exists material_id uuid references procedure_materials(id) on delete restrict;
alter table procedure_step_actions add column if not exists equipment_product_id uuid references products(id) on delete restrict;
alter table procedure_step_actions add column if not exists container_product_id uuid references products(id) on delete restrict;
alter table procedure_step_actions add column if not exists condition_json jsonb not null default '{}'::jsonb;

insert into procedure_materials (name, material_type, category, subcategory, unit, note, sort_order)
values
  ('氷', 'utility', '手順書素材', '水・氷', 'g', '発注商品ではなく、店舗内で使用する素材。', 10),
  ('冷水', 'utility', '手順書素材', '水・氷', 'ml', '発注商品ではなく、店舗内で使用する素材。', 20),
  ('お湯', 'utility', '手順書素材', '水・氷', 'ml', '発注商品ではなく、店舗内で使用する素材。', 30),
  ('抽出済み茶', 'intermediate', '中間製品', '茶湯', 'ml', '茶葉などの発注商品から作る中間製品。', 40)
on conflict (name)
do update set
  material_type = excluded.material_type,
  category = excluded.category,
  subcategory = excluded.subcategory,
  unit = excluded.unit,
  note = excluded.note,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into procedure_action_types (action_key, label, sentence_template, sort_order)
values
  ('take', '取り出す', '{location}から{product}{quantity}{unit}を取り出す', 10),
  ('measure', '計量', '{product}を{quantity}{unit}計量する', 20),
  ('add', '入れる', '{container}に{product}{quantity}{unit}を入れる', 30),
  ('mix', '混ぜる', '{equipment}で{target}まで混ぜる', 40),
  ('heat', '加熱', '{equipment}で{target}まで加熱する', 50),
  ('check', '確認', '{standard}を確認する', 60),
  ('wash', '洗浄', '{equipment}を洗浄する', 70),
  ('cut', 'カット', '{product}を{target}にカットする', 80),
  ('discard', '廃棄', '{product}{quantity}{unit}を廃棄する', 90),
  ('serve', '提供', '{container}で提供する', 100)
on conflict (action_key)
do update set
  label = excluded.label,
  sentence_template = excluded.sentence_template,
  sort_order = excluded.sort_order;

insert into procedure_locations (name, category, sort_order)
values
  ('冷蔵庫', '保管', 10),
  ('冷凍庫', '保管', 20),
  ('常温棚', '保管', 30),
  ('調理台', '作業場', 40),
  ('ドリンクバー', '作業場', 50),
  ('展示ケース', '売場', 60)
on conflict (name) do nothing;

insert into procedure_equipment (name, category, sort_order)
values
  ('電子秤', '計量', 10),
  ('計量カップ', '計量', 20),
  ('鍋', '加熱', 30),
  ('ゆでざる', '加熱', 40),
  ('シェーカー', 'ドリンク', 50),
  ('シーラー', '包装', 60),
  ('レードル', '調理', 70)
on conflict (name) do nothing;

insert into procedure_containers (name, category, sort_order)
values
  ('店内用ボウル', '店内', 10),
  ('テイクアウト容器', 'テイクアウト', 20),
  ('Mカップ', 'ドリンク', 30),
  ('Lカップ', 'ドリンク', 40),
  ('シェーカー', 'ドリンク', 50),
  ('テイクアウト袋', 'テイクアウト', 60)
on conflict (name) do nothing;

insert into procedure_books (
  title,
  category,
  procedure_type,
  summary,
  status,
  published_at,
  updated_at
)
select
  '社員入社手続きチェックリスト',
  '人事手続き',
  'hr_onboarding',
  '入社前の条件確認、本人情報・必要書類の回収、社会保険・雇用保険・税務、Foundr1 OS設定、初回勤務準備までを確認します。',
  'published',
  now(),
  now()
where not exists (
  select 1
  from procedure_books
  where title = '社員入社手続きチェックリスト'
    and category = '人事手続き'
);

update procedure_books
set
  procedure_type = 'hr_onboarding',
  summary = '入社前の条件確認、本人情報・必要書類の回収、社会保険・雇用保険・税務、Foundr1 OS設定、初回勤務準備までを確認します。',
  status = 'published',
  published_at = coalesce(published_at, now()),
  updated_at = now()
where title = '社員入社手続きチェックリスト'
  and category = '人事手続き';

delete from procedure_steps
where procedure_book_id in (
  select id
  from procedure_books
  where title = '社員入社手続きチェックリスト'
    and category = '人事手続き'
);

insert into procedure_steps (procedure_book_id, sort_order, title, instruction, caution, estimated_minutes, updated_at)
with book as (
  select id
  from procedure_books
  where title = '社員入社手続きチェックリスト'
    and category = '人事手続き'
  order by created_at
  limit 1
),
steps(sort_order, title, instruction, caution, estimated_minutes) as (
  values
    (
      10,
      '採用条件と勤務区分を確定する',
      '雇用形態、所属店舗、入社日、勤務時間、時給または月給、交通費、雇用保険・社会保険の加入見込み、給与対象区分を確定する。Foundr1 OSのスタッフ管理で同じ内容を登録できる状態にする。',
      '労働条件通知書または雇用契約書で、勤務場所・業務内容・契約期間・更新有無・賃金・締日支払日・休日・退職事項を本人に明示する。',
      20
    ),
    (
      20,
      '本人情報と必要書類を回収する',
      '氏名、フリガナ、生年月日、住所、連絡先、緊急連絡先、給与振込口座、マイナンバー取扱対象情報、雇用保険被保険者番号、基礎年金番号またはマイナンバー、扶養情報を回収する。中途入社で同年に前職給与がある場合は前職の給与所得の源泉徴収票も回収する。',
      '個人番号、在留カード、本人確認書類はアクセス権限と保管場所を限定する。Foundr1 OSには必要最小限の業務情報だけを入力する。',
      30
    ),
    (
      30,
      '外国籍スタッフの就労可否を確認する',
      '外国籍の場合は在留カード、在留資格、在留期間、資格外活動許可、在留カード番号を確認し、仕事内容・勤務時間が在留資格の範囲内か確認する。',
      '在留資格が外交・公用または特別永住者を除き、外国人雇用状況の届出が必要。雇用保険対象者は雇用保険資格取得届の期限と同じ翌月10日まで、雇用保険対象外は原則翌月末までに対応する。',
      15
    ),
    (
      40,
      '税務・給与控除の初期設定をする',
      '給与所得者の扶養控除等申告書を回収し、所得税区分、扶養人数、住民税の普通徴収・特別徴収切替の要否、交通費、給与締日支払日を確認する。Foundr1 OSのスタッフ管理とタイムカード給与設定に反映する。',
      '扶養控除等申告書がない場合は源泉徴収税額表の乙欄扱いになるため、初回給与前に未回収を残さない。',
      20
    ),
    (
      50,
      '社会保険の資格取得を判定・届出する',
      '健康保険・厚生年金の加入対象か判定し、対象者は健康保険・厚生年金保険被保険者資格取得届を作成する。扶養家族がいる場合は被扶養者異動届も確認する。',
      '提出期限は事実発生から5日以内。短時間労働者の加入要件、複数事業所勤務、70歳以上被用者、同月得喪に注意する。',
      25
    ),
    (
      60,
      '雇用保険の資格取得を判定・届出する',
      '雇用保険の加入対象か判定し、対象者は雇用保険被保険者資格取得届をハローワークへ提出する。賃金台帳、労働者名簿、出勤簿、雇用契約書など確認資料をそろえる。',
      '提出期限は被保険者となった日の属する月の翌月10日まで。外国籍スタッフで雇用保険対象者の場合は外国人雇用状況届出もこの届出に含めて確認する。',
      25
    ),
    (
      70,
      'Foundr1 OSアカウントと権限を設定する',
      'スタッフ管理で従業員を作成し、役割、所属店舗、勤務店舗、社員番号、入社日、給与対象区分、雇用形態、時給または月給、保険・税設定を登録する。初回パスワード変更とプライバシー同意が必要な場合は有効にする。',
      '加盟店オーナー・店長は担当店舗の通常スタッフと店舗Padだけを作成し、本部権限を付与しない。',
      20
    ),
    (
      80,
      '初回勤務前の受け入れ準備を完了する',
      '制服、名札、衛生ルール、勤怠打刻、POS権限、Lark連絡先、研修手順書、初回シフト、緊急時連絡ルートを確認する。初回勤務後に打刻・給与設定・勤務店舗が正しく反映されているか確認する。',
      '飲食店では食品衛生、アレルゲン、現金・個人情報・会員情報の取扱いを初回勤務前に説明する。',
      20
    )
)
select book.id, steps.sort_order, steps.title, steps.instruction, steps.caution, steps.estimated_minutes, now()
from book
cross join steps;

insert into procedure_books (
  title,
  category,
  procedure_type,
  summary,
  status,
  published_at,
  updated_at
)
select
  '社員退社手続きチェックリスト',
  '人事手続き',
  'hr_offboarding',
  '退職日確定、最終勤務・貸与物回収、社会保険・雇用保険・税務、Foundr1 OS停止、最終給与までを確認します。',
  'published',
  now(),
  now()
where not exists (
  select 1
  from procedure_books
  where title = '社員退社手続きチェックリスト'
    and category = '人事手続き'
);

update procedure_books
set
  procedure_type = 'hr_offboarding',
  summary = '退職日確定、最終勤務・貸与物回収、社会保険・雇用保険・税務、Foundr1 OS停止、最終給与までを確認します。',
  status = 'published',
  published_at = coalesce(published_at, now()),
  updated_at = now()
where title = '社員退社手続きチェックリスト'
  and category = '人事手続き';

delete from procedure_steps
where procedure_book_id in (
  select id
  from procedure_books
  where title = '社員退社手続きチェックリスト'
    and category = '人事手続き'
);

insert into procedure_steps (procedure_book_id, sort_order, title, instruction, caution, estimated_minutes, updated_at)
with book as (
  select id
  from procedure_books
  where title = '社員退社手続きチェックリスト'
    and category = '人事手続き'
  order by created_at
  limit 1
),
steps(sort_order, title, instruction, caution, estimated_minutes) as (
  values
    (
      10,
      '退職日と退職理由を確定する',
      '本人の退職申出、合意退職、契約満了、解雇などの区分を確認し、最終出勤日、退職日、有給残、貸与物、最終給与対象期間を確定する。Foundr1 OSのスタッフ管理に退職予定日と理由を記録する。',
      '雇用保険の離職理由に影響するため、退職願、契約満了通知、解雇予告通知など根拠資料を保管する。',
      20
    ),
    (
      20,
      '最終勤務・勤怠・給与データを締める',
      '最終出勤日の打刻、シフト、休憩、有給、控除、交通費、立替精算、未返却品を確認する。タイムカードと給与設定の退職日、給与対象区分、勤務店舗を更新する。',
      '退職日以降のシフト投入、打刻、POS担当者選択、発注・購入操作が残らないよう確認する。',
      25
    ),
    (
      30,
      '貸与物とアクセス権限を回収・停止する',
      '制服、名札、鍵、ICカード、店舗Pad、マニュアル、Larkグループ、メール、POS、決済端末、Foundr1 OSアカウントを確認し、最終勤務後に不要な権限を停止する。',
      '退職前に必要な引き継ぎと連絡先変更を済ませ、個人情報・会員情報・売上情報へ退職者がアクセスできない状態にする。',
      20
    ),
    (
      40,
      '社会保険の資格喪失を届出する',
      '健康保険・厚生年金の対象者は健康保険・厚生年金保険被保険者資格喪失届を作成し、資格確認書など交付物がある場合は回収する。退職による資格喪失日は退職日の翌日として確認する。',
      '提出期限は事実発生から5日以内。退職日が3月31日の場合、資格喪失日は4月1日になる。',
      25
    ),
    (
      50,
      '雇用保険の資格喪失と離職票要否を処理する',
      '雇用保険対象者は雇用保険被保険者資格喪失届を提出する。本人が離職票を希望する、または不要申出がない場合は雇用保険被保険者離職証明書も作成し、賃金台帳、労働者名簿、出勤簿、退職理由確認資料をそろえる。',
      '提出期限は被保険者でなくなった事実があった日の翌日から10日以内。離職票不要としても、後日本人から請求があれば作成・交付が必要。',
      30
    ),
    (
      60,
      '外国籍スタッフの離職届出を確認する',
      '外国籍の場合は在留資格、在留期間、在留カード番号を確認し、外国人雇用状況の離職届出を行う。雇用保険対象者は資格喪失届の届出内容で対応し、対象外の場合は様式第3号または外国人雇用状況届出システムで処理する。',
      '雇用保険対象者は喪失届と同じ翌日から10日以内、雇用保険対象外は原則翌月末までに対応する。',
      15
    ),
    (
      70,
      '税務・住民税・退職書類を交付する',
      '給与所得の源泉徴収票、退職証明書の要否、住民税の特別徴収継続・普通徴収切替、退職所得がある場合の退職所得申告書と退職所得源泉徴収票を確認する。',
      '給与所得の源泉徴収票は退職者本人に交付する。転職先の年末調整や本人の確定申告で必要になるため、最終給与後に遅れないようにする。',
      25
    ),
    (
      80,
      '最終確認と履歴保存を完了する',
      'Foundr1 OSのスタッフ状態を退職済みまたは停止にし、退職日、退職理由、保険・雇用保険・税務届出の完了日、貸与物回収、最終給与、書類交付を記録する。',
      '労働者名簿、賃金台帳、出勤簿、雇用契約書、各種申告書は法定保存期間と社内ルールに従って保管する。',
      20
    )
)
select book.id, steps.sort_order, steps.title, steps.instruction, steps.caution, steps.estimated_minutes, now()
from book
cross join steps;

create index if not exists idx_purchase_orders_store_status on purchase_orders(store_id, status);
create index if not exists idx_purchase_orders_deadline on purchase_orders(deadline_at);
create index if not exists idx_procurement_staff_unavailable_slots_staff_date on procurement_staff_unavailable_slots(employee_id, unavailable_date);
create index if not exists idx_purchase_order_supplier_fulfillments_order on purchase_order_supplier_fulfillments(purchase_order_id);
create index if not exists idx_delivery_batches_order_status on delivery_batches(purchase_order_id, status);
create index if not exists idx_purchase_exceptions_status on purchase_exceptions(status);
create index if not exists idx_price_records_product_recorded on price_records(product_id, recorded_at desc);
create index if not exists idx_os_notifications_recipient_read on os_notifications(recipient_employee_id, read_at, created_at desc);
create index if not exists idx_external_service_usage_events_metric_recorded
  on external_service_usage_events(service_key, metric_key, recorded_at desc);
create index if not exists idx_external_service_alert_events_period
  on external_service_alert_events(period_key, alert_level, created_at desc);
create index if not exists idx_web_push_subscriptions_employee on web_push_subscriptions(employee_id, revoked_at, updated_at desc);
create index if not exists idx_timecard_punches_employee_punched on timecard_punches(employee_id, punched_at desc);
create index if not exists idx_timecard_punches_store_punched on timecard_punches(store_id, punched_at desc);
create index if not exists idx_timecard_shifts_store_date on timecard_shifts(store_id, work_date);
create index if not exists idx_timecard_shifts_employee_store_date on timecard_shifts(employee_id, store_id, work_date);
alter table timecard_shifts drop constraint if exists timecard_shifts_employee_id_store_id_work_date_key;
create index if not exists idx_timecard_shift_requests_store_date on timecard_shift_requests(store_id, work_date, created_at desc);
create index if not exists idx_timecard_shift_requests_employee on timecard_shift_requests(employee_id, created_at desc);
create index if not exists idx_timecard_shift_request_candidates_request on timecard_shift_request_candidates(request_id, created_at desc);
create index if not exists idx_timecard_employee_settings_employee on timecard_employee_settings(employee_id, valid_from desc);
create index if not exists idx_timecard_workload_settings_store on timecard_workload_settings(store_id);
create index if not exists idx_procedure_books_status_updated on procedure_books(status, updated_at desc);
create index if not exists idx_procedure_books_brand on procedure_books(brand_id);
create index if not exists idx_menu_sources_brand on menu_sources(brand_id, status);
create index if not exists idx_store_tables_store on store_tables(store_id, status, sort_order);
create index if not exists idx_store_tables_token on store_tables(qr_token);
create index if not exists idx_menu_categories_brand_store on menu_categories(brand_id, store_id, sort_order);
create index if not exists idx_menu_catalog_items_brand_store on menu_catalog_items(brand_id, store_id, is_active);
create index if not exists idx_menu_option_groups_item on menu_option_groups(menu_catalog_item_id, sort_order);
create index if not exists idx_menu_options_group on menu_options(option_group_id, sort_order);
create index if not exists idx_menu_store_settings_brand_store on menu_store_settings(brand_id, store_id);
create index if not exists idx_menu_option_store_settings_brand_store on menu_option_store_settings(brand_id, store_id);
create index if not exists idx_menu_external_platforms_brand_store on menu_external_platforms(brand_id, store_id, is_active);
create unique index if not exists idx_menu_external_platforms_unique_scope
  on menu_external_platforms (
    brand_id,
    coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    platform_key
  );
create index if not exists idx_menu_change_sync_tasks_brand_status on menu_change_sync_tasks(brand_id, status, created_at desc);
create unique index if not exists idx_menu_change_sync_tasks_pending_unique
  on menu_change_sync_tasks (
    external_platform_id,
    target_type,
    coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    change_kind
  )
  where status = 'pending';
create index if not exists idx_stores_external_id on stores(external_id);
create index if not exists idx_stores_company_id on stores(company_id);
create index if not exists idx_store_customer_orders_store_status on store_customer_orders(store_id, status, created_at desc);
create index if not exists idx_store_customer_orders_pickup on store_customer_orders(pickup_code, pickup_date);
create index if not exists idx_store_customer_orders_square_order on store_customer_orders(square_order_id);
create index if not exists idx_store_customer_orders_payment_account on store_customer_orders(payment_account_id, created_at desc);
create index if not exists idx_store_customer_orders_payment_session on store_customer_orders(payment_provider, payment_session_id);
create index if not exists idx_store_customer_orders_payment_id on store_customer_orders(payment_provider, payment_id);
create index if not exists idx_store_customer_orders_pos_cash_session on store_customer_orders(pos_cash_session_id, created_at desc);
create index if not exists idx_store_customer_order_items_order on store_customer_order_items(order_id, sort_order);
create index if not exists idx_order_production_tasks_order on order_production_tasks(order_id, production_area);
create unique index if not exists idx_order_production_tasks_unique_area on order_production_tasks(order_id, production_area, production_area_label);
create index if not exists idx_order_production_tasks_store_status on order_production_tasks(store_id, status, created_at desc);

update order_production_tasks
set production_area_label = 'ドリンク'
where production_area = 'drink'
  and production_area_label = '奶茶';

update order_production_tasks
set production_area = 'cooking',
  production_area_label = '調理'
where production_area = 'malatang'
  and production_area_label = '麻辣烫';
create index if not exists idx_pos_cash_sessions_store_date on pos_cash_sessions(store_id, business_date desc, status);
create unique index if not exists idx_pos_cash_sessions_one_open_per_store
  on pos_cash_sessions(store_id)
  where status = 'open';
create index if not exists idx_pos_cash_movements_session on pos_cash_movements(session_id, created_at desc);
create index if not exists idx_pos_order_corrections_store_date on pos_order_corrections(store_id, business_date, created_at desc);
create index if not exists idx_pos_order_corrections_order on pos_order_corrections(order_id, created_at desc);
create index if not exists idx_sales_orders_store_channel_paid on sales_orders(store_id, channel, paid_at desc);
create index if not exists idx_sales_orders_ordered_at on sales_orders(ordered_at desc);
create index if not exists idx_sales_orders_channel_status on sales_orders(channel, status);
create unique index if not exists idx_sales_orders_source_external
  on sales_orders(source_platform, source_external_id)
  where source_external_id is not null;
create index if not exists idx_sales_order_items_order on sales_order_items(sales_order_id, sort_order);
create index if not exists idx_sales_import_batches_store_month
  on sales_import_batches(store_id, source_platform, import_month, created_at desc);
create index if not exists idx_sales_import_batches_source_month
  on sales_import_batches(store_id, sales_source_id, import_month, created_at desc);

create table if not exists local_bridge_events (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'uber_eats',
  kind text not null,
  package_name text not null default '',
  device_name text not null default '',
  store_external_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  parse_status text not null default 'raw',
  parse_error text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_local_bridge_events_platform_created
  on local_bridge_events(platform, created_at desc);

create index if not exists idx_local_bridge_events_store_created
  on local_bridge_events(store_external_id, created_at desc);
create index if not exists idx_sales_import_rows_batch
  on sales_import_rows(batch_id, row_index);
create index if not exists idx_procedure_books_menu_catalog_item on procedure_books(menu_catalog_item_id);
create index if not exists idx_procedure_book_stores_store on procedure_book_stores(store_id);
create index if not exists idx_procedure_steps_book_order on procedure_steps(procedure_book_id, sort_order);
create index if not exists idx_procedure_step_products_step on procedure_step_products(procedure_step_id, sort_order);
create index if not exists idx_procedure_variants_book on procedure_variants(procedure_book_id, sort_order);
create index if not exists idx_procedure_step_actions_step on procedure_step_actions(procedure_step_id, sort_order);
create index if not exists idx_procedure_step_actions_variant on procedure_step_actions(procedure_variant_id);
