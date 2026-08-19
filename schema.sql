PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  guest_name TEXT NOT NULL,
  company_name TEXT,
  room_no TEXT NOT NULL,
  room_type TEXT,
  check_in_date TEXT NOT NULL,
  expected_check_out_date TEXT,
  actual_check_out_date TEXT,
  pricing_plan TEXT NOT NULL DEFAULT 'monthly', -- daily | monthly | yearly
  contract_rate REAL NOT NULL DEFAULT 0,
  allocation_method TEXT NOT NULL DEFAULT 'actual_month_days', -- actual_month_days | fixed_30 | fixed_365
  fallback_daily_rate REAL NOT NULL DEFAULT 0,
  breakfast_guests INTEGER NOT NULL DEFAULT 0,
  breakfast_rate REAL NOT NULL DEFAULT 100000,
  payment_method TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | checked_out | cancelled
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stays_room ON stays(room_no);
CREATE INDEX IF NOT EXISTS idx_stays_status ON stays(status);
CREATE INDEX IF NOT EXISTS idx_stays_dates ON stays(check_in_date, actual_check_out_date);

CREATE TABLE IF NOT EXISTS daily_room_revenue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stay_id INTEGER NOT NULL,
  revenue_date TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'accrual', -- accrual | adjustment
  amount REAL NOT NULL DEFAULT 0, -- gross allocation incl. breakfast split
  breakfast_amount REAL NOT NULL DEFAULT 0,
  net_room_amount REAL NOT NULL DEFAULT 0,
  base_daily_rate REAL NOT NULL DEFAULT 0,
  pricing_plan TEXT,
  allocation_method TEXT,
  description TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(stay_id, revenue_date, source_kind),
  FOREIGN KEY(stay_id) REFERENCES stays(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_room_date ON daily_room_revenue(revenue_date);
CREATE INDEX IF NOT EXISTS idx_daily_room_stay ON daily_room_revenue(stay_id);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stay_id INTEGER,
  service_date TEXT NOT NULL,
  room_no TEXT,
  category TEXT NOT NULL, -- pool_vbn | pool_vbl | pool_vbt_large | pool_vbt_small | golf_ticket | swim_lesson | gym_month | tennis_day | minibar | laundry | restaurant | extra_bed | others
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  note TEXT,
  payment_method TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(stay_id) REFERENCES stays(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_services_date ON services(service_date);
CREATE INDEX IF NOT EXISTS idx_services_stay ON services(stay_id);

CREATE TABLE IF NOT EXISTS day_closings (
  report_date TEXT PRIMARY KEY,
  room_revenue REAL NOT NULL DEFAULT 0,
  adjustment REAL NOT NULL DEFAULT 0,
  service_revenue REAL NOT NULL DEFAULT 0,
  total_revenue REAL NOT NULL DEFAULT 0,
  closed_by TEXT,
  closed_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stay_id INTEGER NOT NULL,
  payment_date TEXT NOT NULL,
  payment_kind TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(stay_id) REFERENCES stays(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payments_stay ON payments(stay_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
