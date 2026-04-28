CREATE OR REPLACE FUNCTION upsert_profile(
  p_user_id uuid,
  p_email text,
  p_name text,
  p_role text,
  p_coach_id text
)
RETURNS void AS $$
BEGIN
  INSERT INTO profiles (user_id, email, name, role, coach_id)
  VALUES (p_user_id, p_email, p_name, p_role, p_coach_id)
  ON CONFLICT (user_id) DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    coach_id = EXCLUDED.coach_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION upsert_profile(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_profile(uuid, text, text, text, text) TO service_role;
