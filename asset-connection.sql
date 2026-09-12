-- The connection is provisioned separately into encrypted Supabase Vault.
CREATE OR REPLACE FUNCTION public.get_hyperframes_flow_connection()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT decrypted_secret::jsonb FROM vault.decrypted_secrets
  WHERE name = 'peptiking_hyperframes_flow' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_hyperframes_flow_connection() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hyperframes_flow_connection() TO service_role;
