-- Apply before deploying the shift-request default settings runtime.
alter table stores add column if not exists shift_request_start_offset_minutes integer not null default 0 check (shift_request_start_offset_minutes between -720 and 720);
alter table stores add column if not exists shift_request_end_offset_minutes integer not null default 0 check (shift_request_end_offset_minutes between -720 and 720);
