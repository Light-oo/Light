INSERT INTO markets (id, name, is_active, sort_order)
VALUES ('00000000-0000-0000-0000-000000000001', 'Pilot Market', true, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO item_types (id, market_id, key, label_es, is_active, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'bumper',
  'Bumper',
  true,
  1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO item_type_rules (item_type_id, requires_side, requires_position, allowed_sides, allowed_positions)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  true,
  true,
  ARRAY['left', 'right'],
  ARRAY['front', 'rear']
)
ON CONFLICT (item_type_id) DO NOTHING;
