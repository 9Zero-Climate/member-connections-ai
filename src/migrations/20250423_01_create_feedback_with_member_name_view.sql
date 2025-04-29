create or replace view public.feedback_with_member_name as
select f.*,
    m.name as member_name
from public.feedback f
    left join public.members m on f.submitted_by_user_id = m.slack_id;