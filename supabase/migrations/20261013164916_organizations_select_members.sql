-- organizations had RLS enabled with no policy, so no client could read an org's name: the admin
-- portfolio header was blank and its exports were named "_Portfolio_Summary" (AUDIT_REPORT 4.7,
-- found again by the Phase 3 live tests). Members of the org (any user_roles row carrying its
-- organization_id) and super_admins may read it. There is still no INSERT/UPDATE/DELETE policy,
-- so client writes stay denied.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'organizations' and policyname = 'organizations_select_members'
  ) then
    create policy organizations_select_members on public.organizations
      for select to authenticated
      using (
        id in (select ur.organization_id from public.user_roles ur where ur.user_id = (select auth.uid()))
        or exists (
          select 1 from public.user_roles ur
          where ur.user_id = (select auth.uid()) and ur.role = 'super_admin'
        )
      );
  end if;
end
$$;
