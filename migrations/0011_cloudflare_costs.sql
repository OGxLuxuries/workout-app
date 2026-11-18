CREATE TABLE cloudflare_costs (
  month TEXT NOT NULL,
  product TEXT NOT NULL CHECK (product IN ('Workers','D1','R2','Observability')),
  cents INTEGER NOT NULL CHECK (cents >= 0),
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (month, product)
);
