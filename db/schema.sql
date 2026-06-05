create extension if not exists pgcrypto;

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  external_id text,
  company_id uuid,
  address text,
  owner_name text,
  business_hours jsonb not null default '{}'::jsonb,
  reservation_note text not null default '',
  payroll_cycle_type text not null default 'month_end',
  payroll_closing_day integer not null default 31,
  social_insurance_prefecture text not null default '福岡県',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table stores add column if not exists external_id text;
alter table stores add column if not exists company_id uuid;
alter table stores add column if not exists business_hours jsonb not null default '{}'::jsonb;
alter table stores add column if not exists reservation_note text not null default '';
alter table stores add column if not exists payroll_cycle_type text not null default 'month_end';
alter table stores add column if not exists payroll_closing_day integer not null default 31;
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
  invoice_registration_number text,
  address text,
  phone text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists store_brands (
  store_id uuid not null references stores(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  primary key (store_id, brand_id)
);

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
alter table employees add column if not exists session_version integer not null default 1;
alter table employees add column if not exists staff_category text not null default 'working';
alter table employees add column if not exists payroll_subject text not null default 'none';
alter table employees add column if not exists gender text not null default 'unspecified';
alter table employees add column if not exists name_kana text;
alter table employees add column if not exists address text;
alter table employees add column if not exists birth_date date;
alter table employees add column if not exists employee_number text;
alter table employees add column if not exists hire_date date;
alter table employees add column if not exists resignation_date date;
alter table employees add column if not exists resignation_reason text;
alter table employees add column if not exists business_type text;
alter table employees add column if not exists is_foreign_national boolean not null default false;
alter table employees add column if not exists employee_type text not null default 'part_time';

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

update employee_work_stores
set
  payroll_enabled = coalesce(latest_settings.payroll_enabled, employee_work_stores.payroll_enabled),
  employment_type = coalesce(latest_settings.employment_type, employee_work_stores.employment_type),
  hourly_wage = coalesce(employee_work_stores.hourly_wage, latest_settings.hourly_wage),
  monthly_salary = coalesce(employee_work_stores.monthly_salary, latest_settings.monthly_salary),
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
  updated_at timestamptz not null default now(),
  unique (employee_id, store_id, work_date)
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
  name text not null default '',
  amount numeric(12, 2) not null default 0,
  start_month text not null default '2026-01',
  end_month text,
  note text not null default '',
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table analytics_expenses add column if not exists category text not null default 'misc';
alter table analytics_expenses add column if not exists name text not null default '';
alter table analytics_expenses add column if not exists amount numeric(12, 2) not null default 0;
alter table analytics_expenses add column if not exists start_month text not null default '2026-01';
alter table analytics_expenses add column if not exists end_month text;
alter table analytics_expenses add column if not exists note text not null default '';
alter table analytics_expenses add column if not exists created_by uuid references employees(id) on delete set null;
alter table analytics_expenses add column if not exists updated_by uuid references employees(id) on delete set null;
create index if not exists analytics_expenses_store_month_idx on analytics_expenses (store_id, start_month, end_month);

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
  package_spec text,
  spec_note text,
  japanese_note text,
  photo_url text,
  brand_scope text not null default 'unset',
  is_key_item boolean not null default false,
  is_price_sensitive boolean not null default false,
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
alter table products add column if not exists package_spec text;
alter table products add column if not exists product_brand_name text;
alter table products add column if not exists manufacturer text;
alter table products add column if not exists japanese_note text;
alter table products add column if not exists brand_scope text not null default 'unset';
alter table products add column if not exists usage_type text not null default 'ingredient';
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
  product_id uuid not null references products(id),
  brand_id uuid references brands(id),
  requested_quantity numeric(12, 2) not null,
  requested_unit text not null,
  note text,
  status text not null default 'requested'
);

alter table purchase_order_items add column if not exists brand_id uuid references brands(id);
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
alter table suppliers add column if not exists order_url text;

create table if not exists purchase_order_supplier_fulfillments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text not null,
  expected_arrival_date date,
  online_order_status text not null default 'not_started',
  receipt_photo_url text,
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
  category text,
  description text,
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
  price_delta numeric(12, 2),
  affects_procedure boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (option_group_id, option_key)
);

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

create table if not exists pos_store_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  dine_in_enabled boolean not null default true,
  dine_in_tax_rate numeric(5, 2) not null default 10,
  takeout_tax_rate numeric(5, 2) not null default 8,
  external_payment_terminal_brand text not null default 'PayCAS',
  price_tax_mode text not null default 'tax_included',
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pos_store_settings add column if not exists dine_in_enabled boolean not null default true;
alter table pos_store_settings add column if not exists external_payment_terminal_brand text not null default 'PayCAS';

create table if not exists pos_customer_display_states (
  store_id uuid primary key references stores(id) on delete cascade,
  display_state jsonb not null default '{}'::jsonb,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists menu_store_settings (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  menu_catalog_item_id uuid not null references menu_catalog_items(id) on delete cascade,
  website_enabled boolean not null default true,
  pos_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  is_available boolean not null default true,
  price_override numeric(12, 2),
  status_note text not null default '',
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, menu_catalog_item_id)
);

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
  amount integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table store_customer_order_items add column if not exists quantity integer not null default 1;

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

create index if not exists idx_purchase_orders_store_status on purchase_orders(store_id, status);
create index if not exists idx_purchase_orders_deadline on purchase_orders(deadline_at);
create index if not exists idx_purchase_order_supplier_fulfillments_order on purchase_order_supplier_fulfillments(purchase_order_id);
create index if not exists idx_delivery_batches_order_status on delivery_batches(purchase_order_id, status);
create index if not exists idx_purchase_exceptions_status on purchase_exceptions(status);
create index if not exists idx_price_records_product_recorded on price_records(product_id, recorded_at desc);
create index if not exists idx_os_notifications_recipient_read on os_notifications(recipient_employee_id, read_at, created_at desc);
create index if not exists idx_web_push_subscriptions_employee on web_push_subscriptions(employee_id, revoked_at, updated_at desc);
create index if not exists idx_timecard_punches_employee_punched on timecard_punches(employee_id, punched_at desc);
create index if not exists idx_timecard_punches_store_punched on timecard_punches(store_id, punched_at desc);
create index if not exists idx_timecard_shifts_store_date on timecard_shifts(store_id, work_date);
create index if not exists idx_timecard_shift_requests_store_date on timecard_shift_requests(store_id, work_date, created_at desc);
create index if not exists idx_timecard_shift_requests_employee on timecard_shift_requests(employee_id, created_at desc);
create index if not exists idx_timecard_shift_request_candidates_request on timecard_shift_request_candidates(request_id, created_at desc);
create index if not exists idx_timecard_employee_settings_employee on timecard_employee_settings(employee_id, valid_from desc);
create index if not exists idx_timecard_workload_settings_store on timecard_workload_settings(store_id);
create index if not exists idx_procedure_books_status_updated on procedure_books(status, updated_at desc);
create index if not exists idx_procedure_books_brand on procedure_books(brand_id);
create index if not exists idx_menu_sources_brand on menu_sources(brand_id, status);
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
create index if not exists idx_sales_import_rows_batch
  on sales_import_rows(batch_id, row_index);
create index if not exists idx_procedure_books_menu_catalog_item on procedure_books(menu_catalog_item_id);
create index if not exists idx_procedure_book_stores_store on procedure_book_stores(store_id);
create index if not exists idx_procedure_steps_book_order on procedure_steps(procedure_book_id, sort_order);
create index if not exists idx_procedure_step_products_step on procedure_step_products(procedure_step_id, sort_order);
create index if not exists idx_procedure_variants_book on procedure_variants(procedure_book_id, sort_order);
create index if not exists idx_procedure_step_actions_step on procedure_step_actions(procedure_step_id, sort_order);
create index if not exists idx_procedure_step_actions_variant on procedure_step_actions(procedure_variant_id);
