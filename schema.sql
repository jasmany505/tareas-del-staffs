-- KRONIX NETWORK Staff Tasks
-- Ejecuta este archivo en Supabase > SQL Editor, en un proyecto nuevo.
create extension if not exists pgcrypto;

create type public.staff_role as enum ('owner','staff');
create type public.task_status as enum ('pending','submitted','approved','rejected');
create type public.submission_status as enum ('submitted','approved','rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role public.staff_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 3000),
  assignee_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('normal','alta','urgente')),
  status public.task_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  evidence_path text not null,
  note text not null default '' check (char_length(note) <= 1500),
  review_status public.submission_status not null default 'submitted',
  review_note text not null default '' check (char_length(review_note) <= 1500),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_assignee_created_idx on public.tasks(assignee_id,created_at desc);
create index submissions_task_created_idx on public.task_submissions(task_id,created_at desc);
create index submissions_staff_created_idx on public.task_submissions(staff_id,created_at desc);

-- A new auth user gets a profile only when an Owner/admin explicitly provisions it
-- using the create-staff Edge Function. Do not let users self-assign their role.
create or replace function public.is_active_owner()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner' and p.active = true);
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.active = true);
$$;

create or replace function public.sync_task_status_from_submission()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  update public.tasks
    set status = new.review_status::text::public.task_status, updated_at = now()
    where id = new.task_id;
  return new;
end;
$$;
create trigger task_submission_sync_status
after insert or update of review_status on public.task_submissions
for each row execute function public.sync_task_status_from_submission();

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_submissions enable row level security;

-- Profiles: active users can see names/roles; only Owners can edit profiles.
create policy "active users read profiles" on public.profiles
for select to authenticated using (public.is_active_user());
create policy "owners update profiles" on public.profiles
for update to authenticated using (public.is_active_owner()) with check (public.is_active_owner());

-- Tasks: Owners see/manage all; staff can see assigned tasks.
create policy "owners read all tasks" on public.tasks
for select to authenticated using (public.is_active_owner());
create policy "staff read assigned tasks" on public.tasks
for select to authenticated using (public.is_active_user() and assignee_id = auth.uid());
create policy "owners create tasks" on public.tasks
for insert to authenticated with check (public.is_active_owner() and created_by = auth.uid());
create policy "owners update tasks" on public.tasks
for update to authenticated using (public.is_active_owner()) with check (public.is_active_owner());
create policy "owners delete tasks" on public.tasks
for delete to authenticated using (public.is_active_owner());

-- Submissions: staff can insert for their own assigned task, read their own history;
-- Owners can review and view all evidence metadata. Staff cannot approve/reject.
create policy "staff read own submissions" on public.task_submissions
for select to authenticated using (public.is_active_user() and staff_id = auth.uid());
create policy "owners read submissions" on public.task_submissions
for select to authenticated using (public.is_active_owner());
create policy "staff submit for assigned task" on public.task_submissions
for insert to authenticated with check (
  public.is_active_user()
  and staff_id = auth.uid()
  and review_status = 'submitted'
  and reviewed_by is null
  and exists(select 1 from public.tasks t where t.id = task_id and t.assignee_id = auth.uid() and t.status in ('pending','rejected'))
);
create policy "owners review submissions" on public.task_submissions
for update to authenticated
using (public.is_active_owner())
with check (public.is_active_owner() and reviewed_by = auth.uid());

-- Private evidence storage. Object path is <auth.uid>/<task-id>/<random-name>.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('task-evidence','task-evidence',false,8388608,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

create policy "staff upload own task evidence" on storage.objects
for insert to authenticated with check (
  bucket_id = 'task-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists(
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[2]
      and t.assignee_id = auth.uid()
      and t.status in ('pending','rejected')
  )
);
create policy "owners read evidence objects" on storage.objects
for select to authenticated using (bucket_id='task-evidence' and public.is_active_owner());
create policy "staff read own evidence objects" on storage.objects
for select to authenticated using (bucket_id='task-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners delete evidence objects" on storage.objects
for delete to authenticated using (bucket_id='task-evidence' and public.is_active_owner());

-- Important: don't create a public bucket or expose service_role key in GitHub.
