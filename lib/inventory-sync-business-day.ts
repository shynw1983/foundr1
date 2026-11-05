// Timed days use the shared Tokyo business date, including preparation and
// post-close work. Explicit 24-hour days use a rolling 24-hour operation window.
// Callers pass trusted SQL range aliases, never request-controlled identifiers.
export function inventorySyncCurrentBusinessDaySql(commandAlias: string, storeAlias: string) {
  if (![commandAlias, storeAlias].every(alias => /^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))) {
    throw new Error("Invalid inventory business-day SQL alias");
  }
  return `exists (
    select 1 from (
      select case when jsonb_typeof(${storeAlias}.business_hours->'weekly') in ('object', 'array')
        then ${storeAlias}.business_hours->'weekly' else coalesce(${storeAlias}.business_hours, '{}'::jsonb) end as weekly
    ) settings
    cross join lateral (
      select settings.weekly -> (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[
        extract(isodow from (CURRENT_TIMESTAMP at time zone 'Asia/Tokyo'))::integer
      ] as today
    ) current_hours
    where case when coalesce(current_hours.today->'open24Hours' = 'true'::jsonb, false)
        and not coalesce(current_hours.today->'closed' = 'true'::jsonb, false)
      then ${commandAlias}.created_at >= CURRENT_TIMESTAMP - interval '24 hours'
        and ${commandAlias}.created_at <= CURRENT_TIMESTAMP
      else exists (
        select 1 from (
          select case when not coalesce(hours.current_day->'open24Hours' = 'true'::jsonb
                and not coalesce(hours.current_day->'closed' = 'true'::jsonb, false), false)
              and not coalesce(hours.previous_day->'closed' = 'true'::jsonb, false)
              and not coalesce(hours.previous_day->'open24Hours' = 'true'::jsonb, false)
              and clock.close_minutes <= clock.open_minutes
              and extract(hour from point.local_at) * 60 + extract(minute from point.local_at) <= clock.close_minutes
            then point.local_at::date - 1 else point.local_at::date end as business_date
          from (values
            (${commandAlias}.created_at at time zone 'Asia/Tokyo'),
            (CURRENT_TIMESTAMP at time zone 'Asia/Tokyo')
          ) point(local_at)
          cross join lateral (
            select settings.weekly -> (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[
              extract(isodow from (point.local_at::date - 1))::integer
            ] as previous_day,
            settings.weekly -> (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[
              extract(isodow from point.local_at)::integer
            ] as current_day
          ) hours
          cross join lateral (
            select btrim(coalesce(hours.previous_day->>'open', '')) as open_text,
              btrim(coalesce(hours.previous_day->>'close', '')) as close_text
          ) text_hours
          cross join lateral (
            select case when text_hours.open_text ~ '^[0-9]{2}:[0-9]{2}$'
              then split_part(text_hours.open_text, ':', 1)::integer * 60 + split_part(text_hours.open_text, ':', 2)::integer
              else 11 * 60 end as open_minutes,
              case when text_hours.close_text ~ '^[0-9]{2}:[0-9]{2}$'
              then split_part(text_hours.close_text, ':', 1)::integer * 60 + split_part(text_hours.close_text, ':', 2)::integer
              else 20 * 60 end as close_minutes
          ) clock
        ) inventory_days
        having count(inventory_days.business_date) = 2
          and min(inventory_days.business_date) = max(inventory_days.business_date)
      ) end
  )`;
}
